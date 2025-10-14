import { useEffect, useRef, useMemo, useState } from 'react';
import * as THREE from 'three';
import { RouteData } from '../types';

interface RadialMapProps {
  routes: RouteData[];
  isAnimating: boolean;
  animationSpeed: number;
  scrubTimeSec?: number | null;
  onAnimationComplete?: () => void;
}

export default function RadialMapWebGL({ routes, isAnimating, animationSpeed, scrubTimeSec, onAnimationComplete }: RadialMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const routeLinesRef = useRef<THREE.LineSegments[]>([]);
  const currentTimeRef = useRef(scrubTimeSec ?? 0);
  
  // Pan and zoom state
  const [zoom, setZoom] = useState(2); // Start zoomed in tight
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const userInteractedRef = useRef(false); // Track if user manually zoomed/panned

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

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      userInteractedRef.current = true; // User took control
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      
      setPan(prev => ({
        x: prev.x + dx * 0.002 / zoom,
        y: prev.y - dy * 0.002 / zoom
      }));
      
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
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

    // Create line segments for each route
    worldRoutes.forEach(route => {
      const positions: number[] = [];
      for (let i = 0; i < route.points.length - 1; i++) {
        const p1 = route.points[i];
        const p2 = route.points[i + 1];
        positions.push(p1.x * sceneScale * 0.9, p1.y * sceneScale * 0.9, 0);
        positions.push(p2.x * sceneScale * 0.9, p2.y * sceneScale * 0.9, 0);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

      // Create alpha array for gradient (light to dark)
      const alphas: number[] = [];
      for (let i = 0; i < route.points.length - 1; i++) {
        const alpha = 0.25 + (i / Math.max(1, route.points.length - 2)) * 0.75;
        alphas.push(alpha, alpha);
      }
      geometry.setAttribute('alpha', new THREE.Float32BufferAttribute(alphas, 1));

      const color = new THREE.Color(route.color);
      const material = new THREE.LineBasicMaterial({ 
        color,
        transparent: true,
        opacity: 0.9
      });

      const line = new THREE.LineSegments(geometry, material);
      line.userData = { 
        routeId: route.id, 
        duration: route.duration,
        totalSegments: route.points.length - 1
      };
      scene.add(line);
      routeLinesRef.current.push(line);
    });
  }, [worldRoutes, sceneScale]);

  // Update currentTimeRef when scrubTimeSec changes
  useEffect(() => {
    currentTimeRef.current = scrubTimeSec ?? 0;
  }, [scrubTimeSec]);

  // Animation loop with zoom/pan
  useEffect(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;

    let animationId: number;

    const animate = () => {
      const time = currentTimeRef.current;

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
      routeLinesRef.current.forEach(line => {
        const { duration, totalSegments } = line.userData;
        const progress = Math.min(Math.max(time / duration, 0), 1);
        const visibleSegments = Math.ceil(totalSegments * progress);
        
        // Update drawRange to only show visible segments
        const geometry = line.geometry as THREE.BufferGeometry;
        geometry.setDrawRange(0, visibleSegments * 2); // *2 because LineSegments uses pairs
      });

      renderer.render(scene, camera);
      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [zoom, pan]);

  return (
    <div 
      ref={containerRef} 
      className="radial-map-container"
      style={{ width: '100%', height: '100%' }}
    />
  );
}

