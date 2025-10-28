import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RouteData } from '../types';

interface RadialMap3DProps {
  routes: RouteData[];
  isAnimating: boolean;
  animationSpeed: number;
  scrubTimeSec: number | null;
  onAnimationComplete: () => void;
  clusterFeatures?: string[];
  clusterEnabled?: boolean;
}

export default function RadialMap3D({
  routes,
  // isAnimating,
  // animationSpeed,
  scrubTimeSec,
  // onAnimationComplete,
}: RadialMap3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const routeTubesRef = useRef<THREE.LineSegments[]>([]);
  const frontDotsRef = useRef<THREE.Mesh[]>([]);
  const currentTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    activityName: string;
    distance: string;
    elevation: string;
  } | null>(null);

  // Convert geographic routes to 3D world coordinates with elevation
  const worldRoutes = useRef<Array<{
    id: string;
    color: string;
    duration: number;
    points: Array<{ x: number; y: number; z: number }>; // x, y = position, z = elevation
    activity: RouteData['activity'];
  }>>([]);

  // Process routes into 3D world coordinates
  useEffect(() => {
    if (routes.length === 0) return;

    console.log('=== 3D VIEW: Processing routes ===');
    console.log('Total routes:', routes.length);
    
    // Check first route in detail
    if (routes.length > 0) {
      const firstRoute = routes[0];
      console.log('First route activity:', {
        name: firstRoute.activity.name,
        hasStreams: !!firstRoute.activity.streams,
        streamKeys: firstRoute.activity.streams ? Object.keys(firstRoute.activity.streams) : [],
        altitudeLength: firstRoute.activity.streams?.altitude?.length,
        firstAltitudes: firstRoute.activity.streams?.altitude?.slice(0, 10)
      });
    }
    
    const processed: typeof worldRoutes.current = [];

    routes.forEach((route) => {
      if (!route.points || route.points.length < 2) return;

      // Get start point as origin
      const startLat = route.points[0].lat;
      const startLng = route.points[0].lng;

      // Convert lat/lng to meters from start, and get elevation
      const points3D: Array<{ x: number; y: number; z: number }> = route.points.map((pt, idx) => {
        // Calculate distance from start in meters
        const dLat = pt.lat - startLat;
        const dLng = pt.lng - startLng;
        const avgLat = (pt.lat + startLat) / 2;

        const x = dLng * 111320 * Math.cos((avgLat * Math.PI) / 180); // meters east
        const y = dLat * 111320; // meters north

        // Get elevation from streams if available
        let elevation = 0;
        const streamData = route.activity.streams;
        if (streamData?.altitude && streamData.altitude.length > 0) {
          // Map point index to stream index (streams might have different sampling)
          const streamIdx = Math.floor((idx / route.points.length) * streamData.altitude.length);
          const startElevation = streamData.altitude[0] || 0;
          elevation = (streamData.altitude[streamIdx] || 0) - startElevation;
        }

        return { x, y, z: elevation };
      });

      // Debug: log elevation range for first few routes
      if (processed.length < 3) {
        const elevations = points3D.map(p => p.z);
        const minElev = Math.min(...elevations);
        const maxElev = Math.max(...elevations);
        console.log(`Route "${route.activity.name}": elevation range ${minElev.toFixed(1)}m to ${maxElev.toFixed(1)}m, has streams: ${!!route.activity.streams?.altitude}, stream length: ${route.activity.streams?.altitude?.length || 0}`);
      }

      processed.push({
        id: route.activity.id.toString(),
        color: route.color,
        duration: route.activity.moving_time || route.activity.distance / 100,
        points: points3D,
        activity: route.activity,
      });
    });

    worldRoutes.current = processed;
    console.log(`Processed ${processed.length} routes for 3D view`);
  }, [routes]);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0f);
    sceneRef.current = scene;

    // Camera - perspective for first-person feel
    const camera = new THREE.PerspectiveCamera(
      75, // FOV
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      50000 // Far plane for long routes
    );
    // Position camera: slightly elevated (Y=300) and pulled back (Z=-500)
    // This gives a good view of both horizontal extent and vertical elevation
    camera.position.set(0, 300, -500);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Orbit controls for looking around - LOCKED to center (origin)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0); // Look at origin
    controls.enablePan = false; // Disable panning - stay centered
    controls.minDistance = 100;
    controls.maxDistance = 10000;
    controlsRef.current = controls;

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // Add directional light
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 100, 100);
    scene.add(dirLight);

    // Add ground plane for reference - more visible
    const groundGeometry = new THREE.CircleGeometry(50000, 128);
    const groundMaterial = new THREE.MeshBasicMaterial({
      color: 0x2a2a3e,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6, // More opaque
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -5; // Slightly below zero to avoid z-fighting
    scene.add(ground);

    // Add grid helper for better depth perception
    const gridHelper = new THREE.GridHelper(50000, 50, 0x4a4a5e, 0x3a3a4e);
    gridHelper.position.y = -4; // Just above ground plane
    scene.add(gridHelper);

    // Add origin marker (you are here) - make it taller so it stands on the ground
    const originGeometry = new THREE.CylinderGeometry(30, 30, 100, 16);
    const originMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const origin = new THREE.Mesh(originGeometry, originMaterial);
    origin.position.y = -4; // Base sits on ground
    scene.add(origin);

    // Add compass axes - make them sit on the ground
    const axesHelper = new THREE.AxesHelper(1000);
    axesHelper.position.y = -4;
    scene.add(axesHelper);

    // Add distance circles on the ground
    for (let r of [1000, 5000, 10000, 20000]) {
      const circleGeometry = new THREE.RingGeometry(r - 10, r + 10, 64);
      const circleMaterial = new THREE.MeshBasicMaterial({
        color: 0x6a6a7e,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.4,
      });
      const circle = new THREE.Mesh(circleGeometry, circleMaterial);
      circle.rotation.x = -Math.PI / 2;
      circle.position.y = -3; // On the ground
      scene.add(circle);
    }

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current || !camera || !renderer) return;
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // Create 3D tubes for routes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || worldRoutes.current.length === 0) return;

    // Clear existing lines and dots
    routeTubesRef.current.forEach((line) => {
      scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    routeTubesRef.current = [];
    
    frontDotsRef.current.forEach((dot) => {
      scene.remove(dot);
      dot.geometry.dispose();
      (dot.material as THREE.Material).dispose();
    });
    frontDotsRef.current = [];

    console.log('Creating 3D tubes for routes...');

    worldRoutes.current.forEach((route) => {
      // Create curve from points with elevation exaggeration
      // Typical rides: 10-20km horizontal, 100-500m vertical, so we need some exaggeration
      const elevationScale = 5; // 5x exaggeration for good visibility without being cartoonish
      
      // Debug: log elevation data for first few routes
      if (routeTubesRef.current.length < 3) {
        const elevations = route.points.map(p => p.z);
        const minZ = Math.min(...elevations);
        const maxZ = Math.max(...elevations);
        const avgZ = elevations.reduce((a, b) => a + b, 0) / elevations.length;
        console.log(`Route "${route.activity.name}": min=${minZ.toFixed(1)}m, max=${maxZ.toFixed(1)}m, avg=${avgZ.toFixed(1)}m, non-zero: ${elevations.filter(e => e !== 0).length}/${elevations.length}`);
        console.log(`Sample elevations:`, elevations.slice(0, 10).map(e => e.toFixed(1)));
      }
      
      const points = route.points.map(
        (pt) => new THREE.Vector3(
          pt.x,              // X = East/West
          pt.z * elevationScale,  // Y = Up/Down (elevation) - THIS IS THE KEY FIX!
          pt.y               // Z = North/South (forward/back)
        )
      );

      if (points.length < 2) return;

      // Create line segments (not tubes) for better control over visibility and colors
      const positions: number[] = [];
      const colors: number[] = [];
      const baseColor = new THREE.Color(route.color); // This will use cluster colors if clustering is enabled
      
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        
        positions.push(p1.x, p1.y, p1.z);
        positions.push(p2.x, p2.y, p2.z);
        
        // Use only cluster/activity type color (no elevation-based coloring)
        colors.push(baseColor.r, baseColor.g, baseColor.b);
        colors.push(baseColor.r, baseColor.g, baseColor.b);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        linewidth: 4, // Thicker lines
        transparent: true,
        opacity: 0.8,
      });

      const line = new THREE.LineSegments(geometry, material);
      line.userData = {
        routeId: route.id,
        duration: route.duration,
        totalSegments: points.length - 1,
        activityName: route.activity.name || 'Unknown',
        distance: (route.activity.distance / 1609.34).toFixed(1),
        elevation: route.activity.total_elevation_gain
          ? (route.activity.total_elevation_gain * 3.28084).toFixed(0)
          : '0',
      };

      scene.add(line);
      routeTubesRef.current.push(line);
      
      // Create white dot for animation front (smaller)
      const dotGeometry = new THREE.SphereGeometry(10, 12, 12); // Reduced from 30 to 10
      const dotMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
      });
      const dot = new THREE.Mesh(dotGeometry, dotMaterial);
      dot.userData = { routeId: route.id };
      dot.visible = false;
      scene.add(dot);
      frontDotsRef.current.push(dot);
    });

    console.log(`Created ${routeTubesRef.current.length} 3D tubes`);
  }, [worldRoutes.current.length]);

  // Update currentTimeRef when scrubTimeSec changes
  useEffect(() => {
    currentTimeRef.current = scrubTimeSec ?? 0;
  }, [scrubTimeSec]);

  // Raycasting for hover detection
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!containerRef.current || !cameraRef.current || !sceneRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    const intersects = raycasterRef.current.intersectObjects(routeTubesRef.current);

    if (intersects.length > 0) {
      const tube = intersects[0].object;
      const { activityName, distance, elevation } = tube.userData;
      setTooltip({
        x: e.clientX,
        y: e.clientY,
        activityName,
        distance,
        elevation,
      });
    } else {
      setTooltip(null);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('mousemove', handleMouseMove);
    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
    };
  }, [handleMouseMove]);

  // Animation loop
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !renderer || !controls) return;

    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      const time = currentTimeRef.current;

      // Update line visibility and dots based on progress
      routeTubesRef.current.forEach((line, idx) => {
        const { duration, totalSegments, routeId } = line.userData;
        const progress = Math.min(Math.max(time / duration, 0), 1);
        const visibleSegments = Math.ceil(totalSegments * progress);
        
        // Update drawRange for progressive drawing
        line.geometry.setDrawRange(0, visibleSegments * 2); // 2 vertices per segment
        
        // Update front dot position
        const dot = frontDotsRef.current[idx];
        if (dot && dot.userData.routeId === routeId) {
          if (progress > 0 && progress < 1) {
            dot.visible = true;
            const positions = line.geometry.attributes.position.array;
            const vertexIndex = (visibleSegments - 1) * 6; // Each segment = 2 vertices = 6 floats
            if (vertexIndex >= 0 && vertexIndex + 5 < positions.length) {
              // Get the last visible point
              const x = positions[vertexIndex + 3];
              const y = positions[vertexIndex + 4];
              const z = positions[vertexIndex + 5];
              dot.position.set(x, y, z);
            }
          } else if (progress >= 1) {
            dot.visible = false; // Hide at completion
          } else {
            dot.visible = false;
          }
        }
      });

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x + 10,
            top: tooltip.y + 10,
            background: 'rgba(26, 26, 46, 0.95)',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            pointerEvents: 'none',
            zIndex: 1000,
            border: '1px solid rgba(255, 255, 255, 0.2)',
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{tooltip.activityName}</div>
          <div>Distance: {tooltip.distance} mi</div>
          <div>Elevation: {tooltip.elevation} ft</div>
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          color: 'rgba(255, 255, 255, 0.7)',
          fontSize: '14px',
          textAlign: 'center',
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        <div>3D First-Person View (Always Centered)</div>
        <div style={{ fontSize: '12px', marginTop: '4px' }}>
          Drag to rotate • Scroll to zoom in/out
        </div>
      </div>
    </div>
  );
}

