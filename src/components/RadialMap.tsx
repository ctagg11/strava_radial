import { useEffect, useMemo, useRef, useCallback } from 'react';
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
  const lastDrawTimeRef = useRef(0);
  const currentTimeRef = useRef(scrubTimeSec ?? 0);
  const rafRef = useRef<number | null>(null);

  // Initialize canvas with high DPI
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
  }, [routes.length]);

  // Precompute world-space coordinates (in meters) once for all routes
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

  // Precompute max world distance and scale once
  const sceneMetrics = useMemo(() => {
    if (!canvasRef.current || worldRoutes.length === 0) return { maxDistance: 1, scale: 1 };
    
    let maxD = 1;
    for (const r of worldRoutes) {
      for (const p of r.points) {
        const d = Math.hypot(p.x, p.y);
        if (d > maxD) maxD = d;
      }
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const halfMin = Math.min(rect.width, rect.height) * 0.45;
    const scale = halfMin / maxD;

    return { maxDistance: maxD, scale };
  }, [worldRoutes]);

  // Optimized draw function with no state updates - reads from ref for instant response
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const scale = sceneMetrics.scale;

    // Clear
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Calculate progress per route based on currentTimeRef (instant)
    const time = currentTimeRef.current;
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw routes
    for (const route of worldRoutes) {
      const routeProgress = Math.min(Math.max(time / route.duration, 0), 1);
      const numPointsToDraw = Math.max(2, Math.ceil(route.points.length * routeProgress));
      
      if (numPointsToDraw < 2) continue;

      ctx.strokeStyle = route.color;
      ctx.lineWidth = 0.8;

      // Draw as single path for better performance
      ctx.beginPath();
      for (let i = 0; i < numPointsToDraw; i++) {
        const p = route.points[i];
        const x = centerX + p.x * scale;
        const y = centerY + p.y * scale;
        
        // Gradient opacity
        const opacity = 0.25 + (i / Math.max(1, numPointsToDraw - 1)) * 0.75;
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          // Draw segment with gradient
          if (i > 1) {
            ctx.stroke();
            ctx.beginPath();
            const prevP = route.points[i - 1];
            const prevX = centerX + prevP.x * scale;
            const prevY = centerY + prevP.y * scale;
            ctx.moveTo(prevX, prevY);
          }
          ctx.globalAlpha = opacity;
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Draw center point
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Draw distance circles
    const distanceMiles = [5, 10, 20, 50];
    const metersPerMile = 1609.34;
    
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 0.6;
    
    for (const miles of distanceMiles) {
      const radius = (miles * metersPerMile) * scale;
      if (radius > 0 && radius < Math.max(rect.width, rect.height)) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    
    // Draw distance labels
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#aaa';
    ctx.font = '12px system-ui, -apple-system';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    for (const miles of distanceMiles) {
      const radius = (miles * metersPerMile) * scale;
      if (radius > 0 && radius < rect.width * 0.9) {
        ctx.fillText(`${miles}mi`, centerX + radius + 8, centerY);
      }
    }

  }, [worldRoutes, sceneMetrics]);

  // Continuous RAF loop for instant response to currentTimeRef changes
  useEffect(() => {
    if (!canvasRef.current || worldRoutes.length === 0) return;
    
    const animate = () => {
      draw();
      rafRef.current = requestAnimationFrame(animate);
    };
    
    rafRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [draw, worldRoutes]);

  // Update currentTimeRef immediately when scrubTimeSec changes
  useEffect(() => {
    currentTimeRef.current = scrubTimeSec ?? 0;
  }, [scrubTimeSec]);

  return (
    <div className="radial-map-container">
      <canvas 
        ref={canvasRef} 
        className="radial-map-canvas"
        style={{ touchAction: 'none', userSelect: 'none' }}
      />
    </div>
  );
}
