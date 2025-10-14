import { useEffect, useMemo, useRef, useState } from 'react';
import { RouteData } from '../types';

interface RadialMapProps {
  routes: RouteData[];
  isAnimating: boolean;
  animationSpeed: number;
  scrubTimeSec?: number | null;
  onAnimationComplete?: () => void;
}

export default function RadialMap({ routes, isAnimating, animationSpeed, scrubTimeSec, onAnimationComplete }: RadialMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [animationProgress, setAnimationProgress] = useState<Map<number, number>>(new Map());
  const unifiedProgressRef = useRef(0);
  const effectiveScrubRef = useRef(0);
  
  // Pan and zoom state
  // View transform (screen space): translate by offset (px), then scale by zoom
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 });
  
  // Touch state for mobile
  const [touchDistance, setTouchDistance] = useState(0);
  const [lastTouchCenter, setLastTouchCenter] = useState({ x: 0, y: 0 });

  // Disable interactions for a cleaner experience
  const INTERACTIVE = false;

  // Initialize canvas
  useEffect(() => {
    if (!canvasRef.current || routes.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

  }, [routes]);

  // Precompute world-space coordinates (in meters) once for all routes
  const worldRoutes = useMemo(() => {
    if (routes.length === 0) return [] as { color: string; points: { x: number; y: number }[]; id: number; duration: number }[];
    const mPerDegLat = 111320; // approx meters per degree latitude

    return routes.map(route => {
      const start = route.points[0];
      const meanLatRad = (start.lat * Math.PI) / 180;
      const mPerDegLon = Math.cos(meanLatRad) * mPerDegLat;
      const pts = route.points.map(p => ({
        x: (p.lng - start.lng) * mPerDegLon,
        y: (p.lat - start.lat) * mPerDegLat,
      }));
      return { color: route.color, points: pts, id: route.activity.id, duration: route.activity.moving_time || route.activity.distance / 100 };
    });
  }, [routes]);

  // Precompute a max world distance once (for stable scaling & less per-frame work)
  const maxWorldDistance = useMemo(() => {
    let maxD = 1;
    worldRoutes.forEach(r => {
      r.points.forEach(p => {
        const d = Math.hypot(p.x, p.y);
        if (d > maxD) maxD = d;
      });
    });
    return maxD;
  }, [worldRoutes]);

  // Smooth scrubbing: snap quickly to scrub target
  useEffect(() => {
    if (scrubTimeSec === null || isAnimating || !canvasRef.current || routes.length === 0) return;
    // Snap immediately to scrub position for responsiveness
    effectiveScrubRef.current = Math.max(0, scrubTimeSec);
    const progress = new Map<number, number>();
    routes.forEach(route => {
      const dur = route.activity.moving_time || route.activity.distance / 100;
      const p = Math.min(Math.max(effectiveScrubRef.current / dur, 0), 1);
      progress.set(route.activity.id, p);
    });
    setAnimationProgress(progress);
    drawRoutes(canvasRef.current!, routes, progress);
  }, [scrubTimeSec, isAnimating, routes]);

  // Animation loop - only restart when isAnimating or routes change
  useEffect(() => {
    if (!canvasRef.current || routes.length === 0) return;

    // If scrubbing, the separate tween effect handles drawing
    if (!isAnimating && scrubTimeSec !== null) return;

    if (!isAnimating) {
      // Draw static
      drawRoutes(canvasRef.current, routes, new Map());
      return;
    }

    // Unified timeline: make every route finish in TARGET_SECONDS
    const TARGET_SECONDS = 60; // default when not scrubbing
    let startTime = performance.now();
    const progress = new Map<number, number>();

    const animate = (currentTime: number) => {
      const elapsed = (currentTime - startTime) / 1000; // seconds
      const targetProgress = Math.min(elapsed / TARGET_SECONDS, 1);
      // Exponential smoothing for less choppiness
      const smoothed = unifiedProgressRef.current + (targetProgress - unifiedProgressRef.current) * 0.25;
      unifiedProgressRef.current = smoothed;
      // Same fraction applied to all routes
      routes.forEach(route => {
        progress.set(route.activity.id, smoothed);
      });

      setAnimationProgress(new Map(progress));
      drawRoutes(canvasRef.current!, routes, progress);

      // Check if all routes are complete
      const allComplete = unifiedProgressRef.current >= 1 - 1e-4;
      
      if (allComplete) {
        if (onAnimationComplete) {
          onAnimationComplete();
        }
      } else {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isAnimating, routes, onAnimationComplete, animationSpeed]);

  // Redraw when pan/zoom changes (without restarting animation)
  useEffect(() => {
    if (!canvasRef.current || routes.length === 0) return;
    
    if (isAnimating) {
      // Just redraw with current progress
      drawRoutes(canvasRef.current, routes, animationProgress);
    } else {
      // Draw static
      drawRoutes(canvasRef.current, routes, new Map());
    }
  }, [offset, zoom, routes, isAnimating, animationProgress]);

  // Mouse wheel zoom - use refs to avoid stale closures
  const panRef = useRef(offset);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    panRef.current = offset;
  }, [offset]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!INTERACTIVE) return; // interactions disabled

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Current view params
      const currentZoom = zoomRef.current;
      const currentOffset = panRef.current; // px

      // Compute meters->px scale for current frame using current canvas size
      const { scaleMetersToPx } = computeSceneScale(canvas, worldRoutes);
      const currentScale = scaleMetersToPx * currentZoom; // px per meter

      // World under cursor BEFORE zoom
      const worldX = (mouseX - (rect.width / 2 + currentOffset.x)) / currentScale;
      const worldY = (mouseY - (rect.height / 2 + currentOffset.y)) / currentScale;

      // Apply zoom
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.05, Math.min(12, currentZoom * zoomFactor));
      const newScale = scaleMetersToPx * newZoom;

      // Keep world point under cursor fixed: solve for new offset
      const newTranslateX = mouseX - worldX * newScale;
      const newTranslateY = mouseY - worldY * newScale;
      const newOffset = {
        x: newTranslateX - rect.width / 2,
        y: newTranslateY - rect.height / 2,
      };

      setOffset(newOffset);
      setZoom(newZoom);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // Mouse drag - use refs to avoid stale closures
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!INTERACTIVE) return; // interactions disabled

    let isDraggingLocal = false;
    let lastPanPointLocal = { x: 0, y: 0 };

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingLocal = true;
      lastPanPointLocal = { x: e.clientX, y: e.clientY };
      setIsDragging(true);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingLocal) return;
      setOffset(prev => ({
        x: prev.x + (e.clientX - lastPanPointLocal.x),
        y: prev.y + (e.clientY - lastPanPointLocal.y)
      }));
      lastPanPointLocal = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isDraggingLocal = false;
      setIsDragging(false);
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Touch events for mobile - use refs to avoid stale closures
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!INTERACTIVE) return; // interactions disabled

    let isDraggingLocal = false;
    let lastPanPointLocal = { x: 0, y: 0 };
    let touchDistanceLocal = 0;
    let lastTouchCenterLocal = { x: 0, y: 0 };

    const getDistance = (touches: TouchList) => {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const getCenter = (touches: TouchList) => {
      if (touches.length === 0) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      let x = 0, y = 0;
      for (let i = 0; i < touches.length; i++) {
        x += touches[i].clientX - rect.left;
        y += touches[i].clientY - rect.top;
      }
      return { x: x / touches.length, y: y / touches.length };
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isDraggingLocal = true;
        setIsDragging(true);
        const center = getCenter(e.touches);
        lastPanPointLocal = center;
      } else if (e.touches.length === 2) {
        isDraggingLocal = false;
        setIsDragging(false);
        touchDistanceLocal = getDistance(e.touches);
        lastTouchCenterLocal = getCenter(e.touches);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      
      if (e.touches.length === 1 && isDraggingLocal) {
        const center = getCenter(e.touches);
        setOffset(prev => ({
          x: prev.x + (center.x - lastPanPointLocal.x),
          y: prev.y + (center.y - lastPanPointLocal.y)
        }));
        lastPanPointLocal = center;
      } else if (e.touches.length === 2) {
        const newDistance = getDistance(e.touches);
        const newCenter = getCenter(e.touches);
        
        if (touchDistanceLocal > 0) {
          setZoom(currentZoom => {
            const zoomFactor = newDistance / touchDistanceLocal;
            const newZoom = Math.max(0.5, Math.min(5, currentZoom * zoomFactor));
            
            // Zoom towards center of pinch
            const zoomRatio = newZoom / currentZoom;
            setOffset(currentPan => ({
              x: newCenter.x - (newCenter.x - currentPan.x) * zoomRatio,
              y: newCenter.y - (newCenter.y - currentPan.y) * zoomRatio
            }));
            
            return newZoom;
          });
        }
        
        touchDistanceLocal = newDistance;
        lastTouchCenterLocal = newCenter;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        isDraggingLocal = false;
        setIsDragging(false);
        touchDistanceLocal = 0;
      }
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  const drawRoutes = (canvas: HTMLCanvasElement, routes: RouteData[], progress: Map<number, number>) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));

    const rect = canvas.getBoundingClientRect();
    const centerX = rect.width / 2; // no panning
    const centerY = rect.height / 2; // no panning

    // Scale factor to fit all routes on screen
    const { scaleMetersToPx } = computeSceneScale(canvas, worldRoutes, maxWorldDistance);
    const scale = scaleMetersToPx; // fixed zoom

    // Draw routes based on progress with gradient (no phantom: only up to progress)
    worldRoutes.forEach(route => {
      const routeProgress = progress.get(route.id) ?? 1;
      const numPointsToDraw = Math.ceil(route.points.length * routeProgress);
      
      if (numPointsToDraw === 0) return;

      const start = { x: 0, y: 0 };
      // Keep strokes crisp at all zooms
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const lineWidth = 0.8;
      
      // Draw route in segments with gradient from light to dark
      for (let i = 1; i < numPointsToDraw; i++) {
        const prevPoint = route.points[i - 1];
        const currPoint = route.points[i];
        
        // Apply zoom to coordinates (pan already in centerX/centerY)
        const x1 = centerX + (prevPoint.x - start.x) * scale;
        const y1 = centerY + (prevPoint.y - start.y) * scale;
        const x2 = centerX + (currPoint.x - start.x) * scale;
        const y2 = centerY + (currPoint.y - start.y) * scale;
        
        // Calculate opacity based on position in route (0.2 to 1.0)
        const opacity = 0.25 + (i / Math.max(1, numPointsToDraw - 1)) * 0.75;
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = route.color;
        ctx.lineWidth = lineWidth;
        ctx.globalAlpha = opacity;
        ctx.stroke();
      }
    });

    // Draw center point
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Draw distance circles (concentric circles)
    const distanceMiles = [5, 10, 20, 50]; // miles
    const metersPerMile = 1609.34;
    
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 0.6;
    
    distanceMiles.forEach(miles => {
      const radius = (miles * metersPerMile) * scale; // meters -> px
      if (radius > 0) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    
    // Draw distance labels
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#aaa';
    ctx.font = `${Math.max(11, 14 / zoom)}px system-ui, -apple-system`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    distanceMiles.forEach(miles => {
      const radius = (miles * metersPerMile) * scale;
      if (radius > 0) {
        ctx.fillText(`${miles}mi`, centerX + radius + 8, centerY);
      }
    });
  };

  const handleReset = () => {
    setOffset({ x: 0, y: 0 });
    setZoom(1);
  };

  // Compute a stable meters->pixels scale (fit to viewport). If maxDistance is provided,
  // use it; otherwise derive it from the world routes.
  function computeSceneScale(
    canvas: HTMLCanvasElement,
    world: { color: string; points: { x: number; y: number }[] }[],
    precomputedMax?: number,
  ) {
    const rect = canvas.getBoundingClientRect();
    const halfMin = Math.min(rect.width, rect.height) * 0.45; // leave margins

    let maxDist = precomputedMax ?? 0;
    if (maxDist === 0) {
      world.forEach(r => {
        r.points.forEach(p => {
          const d = Math.sqrt(p.x * p.x + p.y * p.y);
          if (d > maxDist) maxDist = d;
        });
      });
      if (maxDist === 0) maxDist = 1;
    }

    // meters -> px
    const scaleMetersToPx = halfMin / maxDist;
    return { scaleMetersToPx };
  }

  return (
    <div className="radial-map-container">
      <canvas 
        ref={canvasRef} 
        className="radial-map-canvas"
        style={{ touchAction: 'none', userSelect: 'none' }}
      />
      <button 
        onClick={handleReset}
        className="reset-button"
        title="Reset view"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 10a7 7 0 0 1 14 0" />
          <path d="M10 3v7l7-7" />
          <path d="M10 3l-7 7" />
        </svg>
      </button>
    </div>
  );
}

