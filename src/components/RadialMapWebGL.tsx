import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import * as THREE from 'three';
import { RouteData } from '../types';

interface RadialMapProps {
  routes: RouteData[];
  isAnimating: boolean;
  animationSpeed: number;
  scrubTimeSec?: number | null;
  onAnimationComplete?: () => void;
  clusterFeatures?: string[];
  clusterEnabled?: boolean;
}

export default function RadialMapWebGL({ routes, isAnimating, animationSpeed, scrubTimeSec, onAnimationComplete, clusterFeatures, clusterEnabled }: RadialMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const routeLinesRef = useRef<THREE.LineSegments[]>([]);
  const currentTimeRef = useRef(scrubTimeSec ?? 0);
  const labelCanvasRef = useRef<HTMLCanvasElement>(null);
  const frontDotsRef = useRef<THREE.Mesh[]>([]);
  
  // Pan and zoom state
  const [zoom, setZoom] = useState(2); // Start zoomed in tight
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const userInteractedRef = useRef(false); // Track if user manually zoomed/panned
  
  // Tooltip state
  const [tooltip, setTooltip] = useState<{ 
    x: number; 
    y: number; 
    name: string; 
    type: string; 
    distance: string;
    clusterData?: { [key: string]: string };
  } | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  
  // Initialize raycaster line threshold
  useEffect(() => {
    if (raycasterRef.current.params.Line) {
      raycasterRef.current.params.Line.threshold = 0.01;
    }
  }, []);

  // Precompute world-space coordinates (in meters) once
  const worldRoutes = useMemo(() => {
    if (routes.length === 0) return [];
    const mPerDegLat = 111320;

    return routes.map(route => {
      const start = route.points[0];
      const meanLatRad = (start.lat * Math.PI) / 180;
      const mPerDegLon = Math.cos(meanLatRad) * mPerDegLat;
      const pts = route.points.map(p => ({
        x: (p.lng - start.lng) * mPerDegLon,
        y: (p.lat - start.lat) * mPerDegLat,
      }));
      return { 
        color: route.color, 
        points: pts, 
        id: route.activity.id, 
        duration: route.activity.moving_time || route.activity.distance / 100 
      };
    });
  }, [routes]);

  // Compute scale once
  const sceneScale = useMemo(() => {
    if (worldRoutes.length === 0) return 1;
    let maxD = 1;
    for (const r of worldRoutes) {
      for (const p of r.points) {
        const d = Math.hypot(p.x, p.y);
        if (d > maxD) maxD = d;
      }
    }
    return 1 / maxD; // Normalize to unit sphere
  }, [worldRoutes]);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    sceneRef.current = scene;

    // Camera (orthographic for 2D)
    const aspect = width / height;
    const frustumSize = 1.2; // Adjusted to fit normalized coords
    const camera = new THREE.OrthographicCamera(
      -frustumSize * aspect, frustumSize * aspect,
      frustumSize, -frustumSize,
      0.1, 100
    );
    camera.position.z = 10;
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Center point
    const centerGeometry = new THREE.CircleGeometry(0.005, 16);
    const centerMaterial = new THREE.MeshBasicMaterial({ color: 0xff6b6b });
    const centerMesh = new THREE.Mesh(centerGeometry, centerMaterial);
    scene.add(centerMesh);

    // Distance circles
    const distanceMiles = [5, 10, 20, 50];
    const metersPerMile = 1609.34;
    distanceMiles.forEach(miles => {
      const radius = (miles * metersPerMile) * sceneScale * 0.9;
      const circleGeometry = new THREE.RingGeometry(radius - 0.001, radius + 0.001, 64);
      const circleMaterial = new THREE.MeshBasicMaterial({ 
        color: 0x888888, 
        transparent: true, 
        opacity: 0.3,
        side: THREE.DoubleSide
      });
      const circle = new THREE.Mesh(circleGeometry, circleMaterial);
      scene.add(circle);
    });

    // Handle resize
    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const asp = w / h;
      if (cameraRef.current) {
        cameraRef.current.left = -frustumSize * asp;
        cameraRef.current.right = frustumSize * asp;
        cameraRef.current.top = frustumSize;
        cameraRef.current.bottom = -frustumSize;
        cameraRef.current.updateProjectionMatrix();
      }
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [sceneScale]);

  // Mouse/touch controls for pan and zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      userInteractedRef.current = true; // User took control
      const delta = e.deltaY;
      const zoomFactor = delta > 0 ? 0.9 : 1.1;
      setZoom(prev => Math.max(0.1, Math.min(10, prev * zoomFactor)));
    };

    const handleMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    };

    let lastRaycastTime = 0;
    
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      mouseRef.current.set(x, y);
      
      if (isDraggingRef.current) {
        userInteractedRef.current = true; // User took control
        const dx = e.clientX - lastMouseRef.current.x;
        const dy = e.clientY - lastMouseRef.current.y;
        
        setPan(prev => ({
          x: prev.x + dx * 0.002 / zoom,
          y: prev.y - dy * 0.002 / zoom
        }));
        
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        setTooltip(null); // Hide tooltip while dragging
      } else {
        // Throttle raycasting to every 50ms for performance
        const now = Date.now();
        if (now - lastRaycastTime < 50) return;
        lastRaycastTime = now;
        
        // Raycast to detect hover with zoom-adjusted threshold
        if (cameraRef.current && sceneRef.current && routeLinesRef.current.length > 0) {
          // Adjust threshold based on zoom level
          raycasterRef.current.params.Line = { threshold: 0.02 / zoom };
          raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
          
          // Get all intersections and find the closest one
          const intersects = raycasterRef.current.intersectObjects(routeLinesRef.current, false);
          
          if (intersects.length > 0) {
            // Sort by distance and get the closest
            intersects.sort((a, b) => a.distance - b.distance);
            const closestLine = intersects[0].object;
            const { activityName, activityType, distance, clusterData } = closestLine.userData;
            
            setTooltip({
              x: e.clientX,
              y: e.clientY,
              name: activityName,
              type: activityType,
              distance: distance + ' mi',
              clusterData: clusterData
            });
          } else {
            setTooltip(null);
          }
        }
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    // Touch support
    let lastTouchDistance = 0;
    let lastTouchCenter = { x: 0, y: 0 };

    const getTouchDistance = (touches: TouchList) => {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const getTouchCenter = (touches: TouchList) => {
      const x = (touches[0].clientX + touches[1].clientX) / 2;
      const y = (touches[0].clientY + touches[1].clientY) / 2;
      return { x, y };
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isDraggingRef.current = true;
        lastMouseRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        lastTouchDistance = getTouchDistance(e.touches);
        lastTouchCenter = getTouchCenter(e.touches);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      
      if (e.touches.length === 1 && isDraggingRef.current) {
        const dx = e.touches[0].clientX - lastMouseRef.current.x;
        const dy = e.touches[0].clientY - lastMouseRef.current.y;
        
        setPan(prev => ({
          x: prev.x + dx * 0.002 / zoom,
          y: prev.y - dy * 0.002 / zoom
        }));
        
        lastMouseRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        const newDistance = getTouchDistance(e.touches);
        const newCenter = getTouchCenter(e.touches);
        
        if (lastTouchDistance > 0) {
          const zoomFactor = newDistance / lastTouchDistance;
          setZoom(prev => Math.max(0.1, Math.min(10, prev * zoomFactor)));
        }
        
        lastTouchDistance = newDistance;
        lastTouchCenter = newCenter;
      }
    };

    const handleTouchEnd = () => {
      isDraggingRef.current = false;
      lastTouchDistance = 0;
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [zoom]);

  // Create route geometries when worldRoutes change
  useEffect(() => {
    if (!sceneRef.current || worldRoutes.length === 0) return;
    const scene = sceneRef.current;

    // Clear old routes
    routeLinesRef.current.forEach(line => scene.remove(line));
    routeLinesRef.current = [];
    frontDotsRef.current.forEach(dot => scene.remove(dot));
    frontDotsRef.current = [];

    // Create line segments for each route
    worldRoutes.forEach(route => {
      const positions: number[] = [];
      const colors: number[] = [];
      const baseColor = new THREE.Color(route.color);
      
      for (let i = 0; i < route.points.length - 1; i++) {
        const p1 = route.points[i];
        const p2 = route.points[i + 1];
        positions.push(p1.x * sceneScale * 0.9, p1.y * sceneScale * 0.9, 0);
        positions.push(p2.x * sceneScale * 0.9, p2.y * sceneScale * 0.9, 0);
        
        // Gradient from lighter (0.2) to darker (1.0) - more noticeable
        const t = i / Math.max(1, route.points.length - 2);
        const intensity = 0.2 + t * 0.8;
        
        // Both vertices of the segment get the same color
        colors.push(
          baseColor.r * intensity, baseColor.g * intensity, baseColor.b * intensity,
          baseColor.r * intensity, baseColor.g * intensity, baseColor.b * intensity
        );
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

      const material = new THREE.LineBasicMaterial({ 
        vertexColors: true,
        transparent: true,
        opacity: 0.9
      });

      const line = new THREE.LineSegments(geometry, material);
      
      // Find the original route data for tooltip info
      const originalRoute = routes.find(r => r.activity.id === route.id);
      
      // Build cluster data if enabled
      let clusterData: { [key: string]: string } | undefined;
      if (clusterEnabled && clusterFeatures && originalRoute) {
        clusterData = {};
        clusterFeatures.forEach(feature => {
          const activity = originalRoute.activity;
          let value = '';
          switch (feature) {
            case 'distance_km':
              value = (activity.distance / 1000).toFixed(1) + ' km';
              break;
            case 'average_speed_kph':
              value = activity.average_speed 
                ? (activity.average_speed * 3.6).toFixed(1) + ' km/h'
                : ((activity.distance / activity.moving_time) * 3.6).toFixed(1) + ' km/h';
              break;
            case 'total_elevation_gain':
              value = activity.total_elevation_gain.toFixed(0) + ' m';
              break;
            case 'moving_time_hours':
              value = (activity.moving_time / 3600).toFixed(2) + ' hrs';
              break;
            case 'max_speed_kph':
              value = activity.max_speed 
                ? (activity.max_speed * 3.6).toFixed(1) + ' km/h'
                : 'N/A';
              break;
          }
          clusterData![feature.replace(/_/g, ' ')] = value;
        });
      }
      
      line.userData = { 
        routeId: route.id, 
        duration: route.duration,
        totalSegments: route.points.length - 1,
        activityName: originalRoute?.activity.name || 'Unknown',
        activityType: originalRoute?.activity.type || 'Activity',
        distance: originalRoute ? (originalRoute.activity.distance / 1609.34).toFixed(1) : '0', // Convert to miles
        clusterData: clusterData
      };
      scene.add(line);
      routeLinesRef.current.push(line);
      
      // Create a white dot for the front of this route
      const dotGeometry = new THREE.CircleGeometry(0.002, 8);
      const dotMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xffffff,
        transparent: true,
        opacity: 0.9
      });
      const dot = new THREE.Mesh(dotGeometry, dotMaterial);
      dot.userData = { routeId: route.id };
      dot.visible = false; // Hidden until animation starts
      scene.add(dot);
      frontDotsRef.current.push(dot);
    });
  }, [worldRoutes, sceneScale, routes, clusterEnabled, clusterFeatures]);

  // Track animation timing locally for smooth playback
  const animationStartTimeRef = useRef<number | null>(null);
  const animationStartValueRef = useRef<number>(0);

  // Update currentTimeRef when scrubTimeSec changes (from manual scrubbing)
  useEffect(() => {
    currentTimeRef.current = scrubTimeSec ?? 0;
    // Reset animation timing when scrubbing
    if (!isAnimating) {
      animationStartTimeRef.current = null;
    }
  }, [scrubTimeSec, isAnimating]);

  // Draw distance labels on overlay canvas
  const drawLabels = useCallback(() => {
    const labelCanvas = labelCanvasRef.current;
    const container = containerRef.current;
    const camera = cameraRef.current;
    if (!labelCanvas || !container || !camera) return;

    const ctx = labelCanvas.getContext('2d');
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    labelCanvas.width = rect.width;
    labelCanvas.height = rect.height;

    ctx.clearRect(0, 0, rect.width, rect.height);

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const distanceMiles = [5, 10, 20, 50];
    const metersPerMile = 1609.34;

    ctx.font = '12px system-ui, -apple-system';
    ctx.fillStyle = '#aaa';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    distanceMiles.forEach(miles => {
      // Calculate radius in world space then convert to screen space
      const worldRadius = (miles * metersPerMile) * sceneScale * 0.9;
      const frustumSize = 1.2 / zoom;
      const screenRadius = (worldRadius / frustumSize) * (rect.height / 2);
      
      const labelX = centerX + screenRadius + 8;
      const labelY = centerY;

      // Only draw if visible
      if (screenRadius > 10 && screenRadius < rect.width * 0.9) {
        ctx.fillText(`${miles}mi`, labelX, labelY);
      }
    });

    // Draw compass lines (N, S, E, W)
    const compassOffset = 30; // Distance from edge
    ctx.strokeStyle = 'rgba(170, 170, 170, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]); // Dashed line

    // Vertical line (N-S)
    ctx.beginPath();
    ctx.moveTo(centerX, compassOffset);
    ctx.lineTo(centerX, rect.height - compassOffset);
    ctx.stroke();

    // Horizontal line (E-W)
    ctx.beginPath();
    ctx.moveTo(compassOffset, centerY);
    ctx.lineTo(rect.width - compassOffset, centerY);
    ctx.stroke();

    ctx.setLineDash([]); // Reset dash

    // Draw compass labels
    ctx.font = '14px system-ui, -apple-system';
    ctx.fillStyle = 'rgba(170, 170, 170, 0.6)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // North (top)
    ctx.fillText('N', centerX, compassOffset - 10);
    
    // South (bottom)
    ctx.fillText('S', centerX, rect.height - compassOffset + 10);
    
    // East (right)
    ctx.fillText('E', rect.width - compassOffset + 10, centerY);
    
    // West (left)
    ctx.fillText('W', compassOffset - 10, centerY);
  }, [zoom, sceneScale]);

  // Animation loop with zoom/pan
  useEffect(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;

    let animationId: number;

    const animate = (now: number) => {
      // If animating, calculate time based on performance.now() for smooth animation
      let time: number;
      if (isAnimating) {
        if (animationStartTimeRef.current === null) {
          animationStartTimeRef.current = now;
          animationStartValueRef.current = currentTimeRef.current;
        }
        const elapsed = (now - animationStartTimeRef.current) / 1000; // real seconds
        time = animationStartValueRef.current + elapsed * animationSpeed;
        currentTimeRef.current = time;
      } else {
        time = currentTimeRef.current;
        animationStartTimeRef.current = null;
      }

      // Calculate required zoom based on furthest visible point (auto-zoom)
      if (!userInteractedRef.current && time > 0) {
        let maxVisibleDistance = 0;
        routeLinesRef.current.forEach(line => {
          const { duration, totalSegments } = line.userData;
          const progress = Math.min(Math.max(time / duration, 0), 1);
          const visibleSegments = Math.ceil(totalSegments * progress);
          
          // Check furthest visible point
          const positions = (line.geometry as THREE.BufferGeometry).attributes.position.array;
          for (let i = 0; i < visibleSegments * 2; i++) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const dist = Math.sqrt(x * x + y * y);
            if (dist > maxVisibleDistance) maxVisibleDistance = dist;
          }
        });
        
        // Target zoom: fit furthest point with margin (0.8 = 80% of view)
        const targetZoom = maxVisibleDistance > 0 ? (0.8 / maxVisibleDistance) : 2;
        // Smoothly interpolate to target zoom
        const smoothZoom = zoom + (targetZoom - zoom) * 0.02;
        setZoom(Math.max(0.3, Math.min(3, smoothZoom)));
      }

      // Apply zoom and pan to camera
      const frustumSize = 1.2 / zoom;
      const aspect = camera.right / camera.top;
      camera.left = -frustumSize * aspect;
      camera.right = frustumSize * aspect;
      camera.top = frustumSize;
      camera.bottom = -frustumSize;
      camera.position.x = pan.x;
      camera.position.y = pan.y;
      camera.updateProjectionMatrix();

      // Update visibility of route segments based on progress
      routeLinesRef.current.forEach((line, idx) => {
        const { duration, totalSegments, routeId } = line.userData;
        const progress = Math.min(Math.max(time / duration, 0), 1);
        const visibleSegments = Math.ceil(totalSegments * progress);
        
        // Update drawRange to only show visible segments
        const geometry = line.geometry as THREE.BufferGeometry;
        geometry.setDrawRange(0, visibleSegments * 2); // *2 because LineSegments uses pairs
        
        // Update front dot position
        const dot = frontDotsRef.current[idx];
        if (dot && dot.userData.routeId === routeId) {
          if (progress > 0 && progress < 1) {
            dot.visible = true;
            // Get the position of the last visible vertex
            const positions = geometry.attributes.position.array;
            const lastIdx = Math.min(visibleSegments * 2 - 1, positions.length / 3 - 1);
            if (lastIdx >= 0) {
              dot.position.x = positions[lastIdx * 3];
              dot.position.y = positions[lastIdx * 3 + 1];
              dot.position.z = positions[lastIdx * 3 + 2];
            }
          } else {
            dot.visible = false;
          }
        }
      });

      renderer.render(scene, camera);
      drawLabels(); // Update labels every frame
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [zoom, pan, drawLabels, isAnimating, animationSpeed]);

  return (
    <div 
      ref={containerRef} 
      className="radial-map-container"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <canvas
        ref={labelCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1
        }}
      />
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x + 15,
            top: tooltip.y + 15,
            background: 'rgba(0, 0, 0, 0.95)',
            color: '#fff',
            padding: '10px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            pointerEvents: 'none',
            zIndex: 1000,
            border: '1px solid rgba(255, 255, 255, 0.2)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
            maxWidth: '300px',
          }}
        >
          <div style={{ fontWeight: '600', marginBottom: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {tooltip.name}
          </div>
          <div style={{ fontSize: '11px', color: '#aaa', marginBottom: tooltip.clusterData ? '8px' : 0 }}>
            {tooltip.type} • {tooltip.distance}
          </div>
          {tooltip.clusterData && (
            <div style={{ 
              borderTop: '1px solid rgba(255, 255, 255, 0.1)', 
              paddingTop: '6px',
              fontSize: '11px'
            }}>
              {Object.entries(tooltip.clusterData).map(([key, value]) => (
                <div key={key} style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  gap: '12px',
                  marginBottom: '3px',
                  color: '#ddd'
                }}>
                  <span style={{ color: '#999', textTransform: 'capitalize' }}>{key}:</span>
                  <span style={{ fontWeight: '500' }}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

