import { useState, useEffect, useRef, useCallback } from 'react';
import RadialMapWebGL from './components/RadialMapWebGL';
import RadialMap3D from './components/RadialMap3D';
import Controls from './components/Controls';
import ClusteringChart from './components/ClusteringChart';
import ElevationProfile from './components/ElevationProfile';
import { StravaService } from './stravaService';
import { StravaActivity, RouteData } from './types';
import { decodePolyline } from './utils/polyline';
import { clusterActivities, getClusterColor, ClusterResult } from './utils/clustering';
import { findSimilarRoutes, getRouteMatchColor, RouteMatchResult } from './utils/routeMatching';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activities, setActivities] = useState<StravaActivity[]>([]);
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [elevationStreams, setElevationStreams] = useState<Record<number, { time: number[]; altitude: number[] }>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState(20);
  const [scrubTimeSec, setScrubTimeSec] = useState<number | null>(null);
  const scrubTimeRef = useRef<number | null>(null);
  
  // View toggle state
  const [view3D, setView3D] = useState(false);
  
  // Clustering state
  const [clusteringEnabled, setClusteringEnabled] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(['distance_miles', 'average_speed_mph']);
  const [clusterCount, setClusterCount] = useState<number>(0);
  const [clusterColors, setClusterColors] = useState<string[]>([]);
  const [clusterResult, setClusterResult] = useState<ClusterResult | null>(null);
  
  // Route matching state
  const [routeMatchingEnabled, setRouteMatchingEnabled] = useState(false);
  const [matchThreshold, setMatchThreshold] = useState<number>(0.25); // 0-1, lower = stricter
  const [matchResult, setMatchResult] = useState<RouteMatchResult | null>(null);

  useEffect(() => {
    // Check if user is already authenticated
    const authenticated = StravaService.isAuthenticated();
    setIsAuthenticated(authenticated);

    // Check for authorization code in URL
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const error = urlParams.get('error');

    if (code) {
      handleAuthCallback(code);
    } else if (error) {
      console.error('Strava authorization error:', error);
      alert('Failed to authenticate with Strava');
    }

    // Clean up URL
    if (code || error) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleAuthCallback = async (code: string) => {
    try {
      await StravaService.exchangeCodeForToken(code);
      setIsAuthenticated(true);
    } catch (error) {
      console.error('Error during authentication:', error);
      alert('Failed to authenticate with Strava');
    }
  };

  const handleLogin = () => {
    const authUrl = StravaService.getAuthUrl();
    window.location.href = authUrl;
  };

  const handleLogout = () => {
    StravaService.logout();
    setIsAuthenticated(false);
    setActivities([]);
    setRoutes([]);
  };

  const handleFetchData = async () => {
    setIsLoading(true);
    try {
      const fetchedActivities = await StravaService.fetchAllActivities();
      console.log('Fetched activities:', fetchedActivities.length);
      setActivities(fetchedActivities);
      
      // Process activities into routes (initial, without elevation)
      const processedRoutes = processActivitiesToRoutes(fetchedActivities);
      console.log('Processed routes:', processedRoutes.length);
      console.log('First route sample:', processedRoutes[0]);
      setRoutes(processedRoutes);

      // Fetch elevation streams in background
      setLoadingStreams(true);
      const ids = processedRoutes.map(r => r.activity.id);
      const streams: Record<number, { time: number[]; altitude: number[] }> = {};
      
      console.log('Fetching elevation data for', ids.length, 'activities...');
      let streamsAttached = 0;
      await StravaService.fetchStreamsBatch(ids, (id, stream) => {
        if (stream) {
          streams[id] = { time: stream.time, altitude: stream.altitude };
          // Attach streams to the activity object for 3D view
          const activity = fetchedActivities.find((a: StravaActivity) => a.id === id);
          if (activity) {
            activity.streams = {
              time: stream.time,
              altitude: stream.altitude,
              distance: stream.distance
            };
            streamsAttached++;
            if (streamsAttached <= 3) {
              console.log(`Attached streams to activity ${activity.name}:`, {
                altitudeLength: stream.altitude.length,
                firstAltitudes: stream.altitude.slice(0, 5)
              });
            }
          } else {
            console.warn(`Could not find activity with id ${id} in fetchedActivities`);
          }
        } else {
          console.warn(`No stream data returned for activity id ${id}`);
        }
      });
      
      setElevationStreams(streams);
      setLoadingStreams(false);
      console.log(`Loaded elevation data for ${Object.keys(streams).length} activities`);
      console.log(`Successfully attached streams to ${streamsAttached} activities`);
      
      // Reprocess routes with elevation data attached
      const routesWithElevation = processActivitiesToRoutes(fetchedActivities);
      setRoutes(routesWithElevation);
      console.log('Reprocessed routes with elevation data');
      
      // Verify streams are in the routes
      if (routesWithElevation.length > 0) {
        console.log('First route after reprocessing has streams:', !!routesWithElevation[0].activity.streams);
      }
    } catch (error) {
      console.error('Error fetching activities:', error);
      alert('Failed to fetch activities. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const processActivitiesToRoutes = (activities: StravaActivity[], clusterLabels?: number[], matchLabels?: number[]): RouteData[] => {
    console.log('Sample activity structure:', activities[0]);
    
    // Filter activities: only cycling, with polyline data, and not virtual
    const filtered = activities.filter(activity => {
      const hasPolyline = activity.map?.summary_polyline || activity.map?.polyline;
      
      if (!hasPolyline) {
        console.log('Activity missing polyline:', activity.name);
        return false;
      }
      
      // Only include cycling activities
      const isCycling = activity.type && (
        activity.type.toLowerCase().includes('ride') || 
        activity.type.toLowerCase().includes('bike') ||
        activity.type.toLowerCase() === 'virtualride' ||
        activity.type.toLowerCase() === 'ebikeride'
      );
      
      if (!isCycling) {
        console.log('Skipping non-cycling activity:', activity.name, activity.type);
        return false;
      }
      
      // Exclude virtual rides (VirtualRide, indoor trainer, etc.)
      const isVirtual = activity.trainer === true || 
                       activity.type?.toLowerCase() === 'virtualride';
      
      if (isVirtual) {
        console.log('Skipping virtual activity:', activity.name);
        return false;
      }
      
      return true;
    });
    
    console.log(`Processing ${filtered.length} activities with valid polyline data out of ${activities.length} total`);
    
    if (filtered.length === 0) {
      console.error('No activities with valid polyline data!');
      return [];
    }
    
    // Process activities and extract coordinates from polylines
    const routes: RouteData[] = [];
    
    for (let i = 0; i < filtered.length; i++) {
      const activity = filtered[i];
      const polyline = activity.map?.summary_polyline || activity.map?.polyline || '';
      const points = decodePolyline(polyline);
      
      // If no points decoded, skip this activity
      if (points.length === 0) {
        console.warn('No points decoded for activity:', activity.name);
        continue;
      }
      
      // Use the first point as the start coordinates
      const startPoint = points[0];
      
      console.log(`Activity: ${activity.name}, Points: ${points.length}, Start: [${startPoint.lat}, ${startPoint.lng}]`);
      
      // Determine color based on: route matching > clustering > activity type
      let color: string;
      if (matchLabels && matchLabels[i] !== undefined) {
        // Use route matching color (priority - shows repeated routes)
        color = getRouteMatchColor(matchLabels[i]);
      } else if (clusterLabels && clusterLabels[i] !== undefined) {
        // Use cluster color
        color = getClusterColor(clusterLabels[i], clusterCount);
      } else {
        // Default: color by activity type
        color = activity.type.toLowerCase().includes('ride') || 
                activity.type.toLowerCase().includes('bike') 
          ? '#4285f4' // Blue for cycling
          : '#ea4335'; // Red for running
      }

      routes.push({
        activity: {
          ...activity,
          start_latitude: startPoint.lat,
          start_longitude: startPoint.lng,
        },
        points,
        color,
      });
    }
    
    console.log(`Successfully processed ${routes.length} routes`);
    return routes;
  };

  const handleApplyClustering = useCallback(() => {
    if (selectedFeatures.length < 2 || activities.length === 0) {
      alert('Please select at least 2 features and load activities first.');
      return;
    }

    try {
      // Filter to only cycling activities (same as processActivitiesToRoutes)
      const filtered = activities.filter(activity => {
        const hasPolyline = activity.map?.summary_polyline || activity.map?.polyline;
        const isCycling = activity.type && (
          activity.type.toLowerCase().includes('ride') || 
          activity.type.toLowerCase().includes('bike') ||
          activity.type.toLowerCase() === 'virtualride' ||
          activity.type.toLowerCase() === 'ebikeride'
        );
        const isVirtual = activity.trainer === true || activity.type?.toLowerCase() === 'virtualride';
        return hasPolyline && isCycling && !isVirtual;
      });

      console.log(`Clustering ${filtered.length} activities on features:`, selectedFeatures);
      
      // Run clustering
      const result = clusterActivities(filtered, selectedFeatures);
      
      console.log(`Clustering complete: ${result.k} clusters, silhouette score: ${result.silhouetteScore.toFixed(3)}`);
      console.log('All silhouette scores:', result.silhouetteScores);
      
      // Update state
      setClusterCount(result.k);
      setClusterResult(result);
      
      // Generate colors for clusters
      const colors = Array.from({ length: result.k }, (_, i) => getClusterColor(i, result.k));
      setClusterColors(colors);
      
      // Reprocess routes with cluster colors
      const newRoutes = processActivitiesToRoutes(activities, result.labels);
      setRoutes(newRoutes);
      
      alert(`Successfully clustered into ${result.k} groups (quality: ${result.silhouetteScore.toFixed(2)})`);
    } catch (error) {
      console.error('Clustering error:', error);
      alert('Failed to apply clustering. Please try different features.');
    }
  }, [selectedFeatures, activities, clusterCount]);

  const handleClusteringToggle = useCallback((enabled: boolean) => {
    setClusteringEnabled(enabled);
    if (!enabled) {
      // Reset to default colors (unless route matching is enabled)
      if (!routeMatchingEnabled) {
        const newRoutes = processActivitiesToRoutes(activities);
        setRoutes(newRoutes);
      }
      setClusterCount(0);
      setClusterColors([]);
      setClusterResult(null);
    }
  }, [activities, routeMatchingEnabled]);

  const handleApplyRouteMatching = useCallback(() => {
    if (routes.length === 0) {
      alert('Please load activities first.');
      return;
    }

    try {
      console.log(`Finding similar routes with threshold ${matchThreshold}...`);
      
      // Extract GPS points from routes
      const gpsPoints = routes.map(route => route.points);
      
      // Run route matching
      const result = findSimilarRoutes(gpsPoints, matchThreshold, 2);
      
      console.log(`Route matching complete: ${result.patterns} patterns, ${result.uniqueRoutes} unique routes`);
      
      // Update state
      setMatchResult(result);
      
      // Reprocess routes with match colors
      const newRoutes = processActivitiesToRoutes(activities, undefined, result.labels);
      setRoutes(newRoutes);
      
      alert(`Found ${result.patterns} repeated route patterns!\n${result.uniqueRoutes} unique routes`);
    } catch (error) {
      console.error('Route matching error:', error);
      alert('Failed to find similar routes. Please try again.');
    }
  }, [routes, activities, matchThreshold]);

  const handleRouteMatchingToggle = useCallback((enabled: boolean) => {
    setRouteMatchingEnabled(enabled);
    if (!enabled) {
      // Reset to default colors (unless clustering is enabled)
      if (!clusteringEnabled) {
        const newRoutes = processActivitiesToRoutes(activities);
        setRoutes(newRoutes);
      }
      setMatchResult(null);
    }
  }, [activities, clusteringEnabled]);

  // Continuous timeline: unify play and scrub into a single time state that advances at animationSpeed
  // Optimized: only update React state every 50ms (20fps) to reduce renders
  useEffect(() => {
    if (!isAnimating || routes.length === 0) return;
    const maxDur = Math.max(...routes.map(r => r.activity.moving_time || r.activity.distance / 100));
    let startWall = performance.now();
    let startTime = scrubTimeSec ?? 0;
    let lastUpdate = startWall;
    scrubTimeRef.current = startTime;
    let raf: number | null = null;

    const tick = (now: number) => {
      const elapsed = (now - startWall) / 1000; // real seconds
      const simTime = startTime + elapsed * animationSpeed;
      if (simTime >= maxDur) {
        setScrubTimeSec(maxDur);
        setIsAnimating(false);
        return;
      }
      scrubTimeRef.current = simTime;
      // Throttle React updates to ~20fps to reduce render overhead
      if (now - lastUpdate > 50) {
        setScrubTimeSec(simTime);
        lastUpdate = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [isAnimating, routes, animationSpeed]);

  const handleStartAnimation = () => {
    setIsAnimating(true);
  };

  const handlePauseAnimation = () => {
    setIsAnimating(false);
  };

  const handleResetAnimation = () => {
    setIsAnimating(false);
    setScrubTimeSec(0);
  };

  const handleAnimationComplete = () => {
    setIsAnimating(false);
  };

  const handleScrubDirect = useCallback((time: number) => {
    // Update React state for slider visual feedback
    setScrubTimeSec(time);
    setIsAnimating(false);
  }, []);

  return (
    <div className="app">
      <Controls
        onLogin={handleLogin}
        onLogout={handleLogout}
        onFetchData={handleFetchData}
        onStartAnimation={handleStartAnimation}
        onPauseAnimation={handlePauseAnimation}
        onResetAnimation={handleResetAnimation}
        onSpeedChange={setAnimationSpeed}
        onScrubChange={(s) => { setScrubTimeSec(s); setIsAnimating(false); }}
        onScrubDirect={handleScrubDirect}
        isAuthenticated={isAuthenticated}
        isLoading={isLoading || loadingStreams}
        isAnimating={isAnimating}
        animationSpeed={animationSpeed}
        activityCount={activities.length}
        maxDurationSec={routes.length ? Math.max(...routes.map(r => r.activity.moving_time || r.activity.distance / 100)) : 0}
        scrubTimeSec={scrubTimeSec}
        clusteringEnabled={clusteringEnabled}
        onClusteringToggle={handleClusteringToggle}
        selectedFeatures={selectedFeatures}
        onFeaturesChange={setSelectedFeatures}
        onApplyClustering={handleApplyClustering}
        clusterCount={clusterCount}
        clusterColors={clusterColors}
        routeMatchingEnabled={routeMatchingEnabled}
        onRouteMatchingToggle={handleRouteMatchingToggle}
        matchThreshold={matchThreshold}
        onMatchThresholdChange={setMatchThreshold}
        onApplyRouteMatching={handleApplyRouteMatching}
        matchResult={matchResult}
        view3D={view3D}
        onViewToggle={setView3D}
      />
      
      {/* View Toggle - conditionally render 2D or 3D view */}
      {view3D ? (
        <RadialMap3D
          routes={routes}
          isAnimating={isAnimating}
          animationSpeed={animationSpeed}
          scrubTimeSec={scrubTimeSec}
          onAnimationComplete={handleAnimationComplete}
          clusterFeatures={selectedFeatures}
          clusterEnabled={clusteringEnabled}
        />
      ) : (
        <>
          <RadialMapWebGL
            routes={routes}
            isAnimating={isAnimating}
            animationSpeed={animationSpeed}
            scrubTimeSec={scrubTimeSec}
            onAnimationComplete={handleAnimationComplete}
            clusterFeatures={selectedFeatures}
            clusterEnabled={clusteringEnabled}
          />
          {/* Elevation Profile - only show in 2D view */}
          {routes.length > 0 && (
            <ElevationProfile
              routes={routes}
              currentTime={scrubTimeSec ?? 0}
              maxDuration={routes.length ? Math.max(...routes.map(r => r.activity.moving_time || r.activity.distance / 100)) : 0}
              elevationData={elevationStreams}
            />
          )}
          
          {/* Clustering Chart - only show in 2D view */}
          {clusteringEnabled && clusterResult && clusterResult.rawData && clusterResult.silhouetteScores && (
            <ClusteringChart
              features={selectedFeatures}
              data={clusterResult.rawData}
              labels={clusterResult.labels}
              centroids={clusterResult.centroids}
              silhouetteScores={clusterResult.silhouetteScores}
              selectedK={clusterResult.k}
            />
          )}
        </>
      )}
    </div>
  );
}

export default App;

