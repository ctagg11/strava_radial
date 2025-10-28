import { useRef, useEffect, useState } from 'react';
import { RouteData } from '../types';

interface ElevationProfileProps {
  routes: RouteData[];
  currentTime: number;
  maxDuration: number;
}

export default function ElevationProfile({ routes, currentTime, maxDuration }: ElevationProfileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 200 });
  const [isResizing, setIsResizing] = useState(false);
  const startPosRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Handle resize dragging
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startPosRef.current.x;
      const deltaY = e.clientY - startPosRef.current.y;
      
      const newWidth = Math.max(300, Math.min(800, startPosRef.current.width + deltaX));
      const newHeight = Math.max(150, Math.min(400, startPosRef.current.height + deltaY));
      
      setSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || routes.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = size.width;
    const height = size.height;
    const padding = 40;
    const plotWidth = width - 2 * padding;
    const plotHeight = height - 2 * padding;

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Calculate elevation profiles for each route
    const profiles: Array<{ 
      route: RouteData; 
      points: Array<{ time: number; elevation: number }>;
      color: string;
    }> = [];

    routes.forEach(route => {
      const activity = route.activity;
      const duration = activity.moving_time || (activity.distance / 100);
      
      // Use simplified elevation calculation based on elevation gain
      // We'll interpolate assuming linear elevation change (can be improved with actual stream data)
      const elevGain = activity.total_elevation_gain || 0;
      const numPoints = Math.min(100, route.points.length);
      const points: Array<{ time: number; elevation: number }> = [];
      
      // Simple model: assume elevation changes happen throughout the ride
      // Start at 0, end at net elevation gain
      for (let i = 0; i <= numPoints; i++) {
        const t = (i / numPoints) * duration;
        // Simple sine wave approximation for ups and downs
        const progress = i / numPoints;
        const elevation = elevGain * progress + Math.sin(progress * Math.PI * 4) * (elevGain * 0.2);
        points.push({ time: t, elevation });
      }
      
      profiles.push({
        route,
        points,
        color: route.color
      });
    });

    // Find elevation range
    let minElev = 0;
    let maxElev = 100; // Default range
    
    profiles.forEach(profile => {
      profile.points.forEach(p => {
        minElev = Math.min(minElev, p.elevation);
        maxElev = Math.max(maxElev, p.elevation);
      });
    });

    // Add padding to range
    const elevRange = maxElev - minElev;
    minElev -= elevRange * 0.1;
    maxElev += elevRange * 0.1;

    // Scale functions
    const scaleX = (time: number) => padding + (time / maxDuration) * plotWidth;
    const scaleY = (elev: number) => height - padding - ((elev - minElev) / (maxElev - minElev)) * plotHeight;

    // Draw axes
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.stroke();

    // Draw zero line
    const zeroY = scaleY(0);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(padding, zeroY);
    ctx.lineTo(width - padding, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const y = height - padding - (plotHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Draw elevation profiles
    profiles.forEach(profile => {
      const { points, color } = profile;
      
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;

      ctx.beginPath();
      let started = false;
      
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        
        // Only draw up to current time
        if (point.time > currentTime) break;
        
        const x = scaleX(point.time);
        const y = scaleY(point.elevation);
        
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    });

    // Draw current time indicator
    const currentX = scaleX(currentTime);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(currentX, padding);
    ctx.lineTo(currentX, height - padding);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw axis labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '11px system-ui, -apple-system';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Time', width / 2, height - 15);

    // Y-axis label
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Elevation (ft)', 0, 0);
    ctx.restore();

    // Draw elevation tick marks
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = '10px system-ui, -apple-system';
    for (let i = 0; i <= 4; i++) {
      const elev = minElev + (maxElev - minElev) * (i / 4);
      const y = scaleY(elev);
      ctx.fillText(Math.round(elev * 3.28084) + 'ft', padding - 8, y); // Convert meters to feet
    }

    // Title
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = 'bold 12px system-ui, -apple-system';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Elevation Profile', width / 2, 8);

  }, [routes, currentTime, maxDuration, size]);

  if (routes.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        width: `${size.width}px`,
        height: `${size.height}px`,
        background: 'rgba(26, 26, 46, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        padding: '12px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        zIndex: 999,
        cursor: isResizing ? 'nwse-resize' : 'default',
      }}
    >
      <canvas
        ref={canvasRef}
        width={size.width}
        height={size.height}
        style={{
          display: 'block',
          borderRadius: '4px',
        }}
      />
      
      {/* Resize handle */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          startPosRef.current = {
            x: e.clientX,
            y: e.clientY,
            width: size.width,
            height: size.height,
          };
          setIsResizing(true);
        }}
        style={{
          position: 'absolute',
          bottom: '0',
          right: '0',
          width: '24px',
          height: '24px',
          cursor: 'nwse-resize',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'flex-end',
          padding: '4px',
        }}
      >
        <div style={{
          width: '12px',
          height: '12px',
          borderRight: '2px solid rgba(255, 255, 255, 0.4)',
          borderBottom: '2px solid rgba(255, 255, 255, 0.4)',
          borderBottomRightRadius: '2px',
        }} />
      </div>
    </div>
  );
}

