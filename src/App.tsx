import { useState, useEffect, useRef, useCallback } from 'react';
import RadialMapWebGL from './components/RadialMapWebGL';
import Controls from './components/Controls';
import ClusteringChart from './components/ClusteringChart';
import { StravaService } from './stravaService';
import { StravaActivity, RouteData } from './types';
// import ElevationChart from './components/ElevationChart';
import { decodePolyline } from './utils/polyline';
import { clusterActivities, getClusterColor, ClusterResult } from './utils/clustering';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activities, setActivities] = useState<StravaActivity[]>([]);
  const [routes, setRoutes] = useState<RouteData[]>([]);
  // const [streams, setStreams] = useState<Record<number, ActivityStream | undefined>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState(20);
  const [scrubTimeSec, setScrubTimeSec] = useState<number | null>(null);
  const scrubTimeRef = useRef<number | null>(null);
  const radialMapTimeRef = useRef<{ updateTime: (time: number) => void } | null>(null);
  
  // Clustering state
  const [clusteringEnabled, setClusteringEnabled] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(['distance_km', 'average_speed_kph']);
  const [clusterLabels, setClusterLabels] = useState<number[]>([]);
  const [clusterCount, setClusterCount] = useState<number>(0);
  const [clusterColors, setClusterColors] = useState<string[]>([]);
  const [clusterResult, setClusterResult] = useState<ClusterResult | null>(null);

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
      
      // Process activities into routes
      const processedRoutes = processActivitiesToRoutes(fetchedActivities);
      console.log('Processed routes:', processedRoutes.length);
      console.log('First route sample:', processedRoutes[0]);
      setRoutes(processedRoutes);

      // Fetch altitude/time streams with batching and progress
      // const ids = fetchedActivities.map(a => a.id);
      // const collected: Record<number, ActivityStream | undefined> = {};
      // await StravaService.fetchStreamsBatch(ids, (id, stream) => {
      //   if (stream) collected[id] = stream;
      //   setStreams({ ...collected });
      // });
    } catch (error) {
      console.error('Error fetching activities:', error);
      alert('Failed to fetch activities. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const processActivitiesToRoutes = (activities: StravaActivity[], clusterLabels?: number[]): RouteData[] => {
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
      
      // Determine color based on clustering or activity type
      let color: string;
      if (clusterLabels && clusterLabels[i] !== undefined) {
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
      setClusterLabels(result.labels);
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
      // Reset to default colors
      const newRoutes = processActivitiesToRoutes(activities);
      setRoutes(newRoutes);
      setClusterLabels([]);
      setClusterCount(0);
      setClusterColors([]);
      setClusterResult(null);
    }
  }, [activities]);

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
        isLoading={isLoading}
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
      />
      <RadialMapWebGL
        routes={routes}
        isAnimating={isAnimating}
        animationSpeed={animationSpeed}
        scrubTimeSec={scrubTimeSec}
        onAnimationComplete={handleAnimationComplete}
      />
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
    </div>
  );
}

export default App;

