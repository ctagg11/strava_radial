import { useEffect, useMemo, useRef } from 'react';
import { ActivityStream, RouteData } from '../types';

interface ElevationChartProps {
  routes: RouteData[];
  streams: Record<number, ActivityStream | undefined>;
  scrubTimeSec: number | null;
  isAnimating: boolean;
  loadedCount?: number;
  totalCount?: number;
}

export default function ElevationChart({ routes, streams, scrubTimeSec, isAnimating, loadedCount = 0, totalCount = 0 }: ElevationChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const series = useMemo(() => {
    return routes.map(r => {
      const s = streams[r.activity.id];
      if (!s) return null;
      const base = s.altitude[0] ?? 0;
      const rel = s.altitude.map(a => (a - base));
      const dist = s.distance ?? s.time.map((t, i) => i === 0 ? 0 : (i / (s.time.length - 1)) * (s.distance?.[s.distance.length - 1] || 0));
      return { id: r.activity.id, color: r.color, time: s.time, alt: rel, dist };
    }).filter(Boolean) as { id: number; color: string; time: number[]; alt: number[]; dist: number[] }[];
  }, [routes, streams]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (series.length === 0) return;

    // Determine time range (max of last time among series) safely
    // Global max distance for X-axis (absolute option B)
    let maxDist = 0;
    for (const s of series) {
      const lastD = s.dist[s.dist.length - 1] || 0;
      if (lastD > maxDist) maxDist = lastD;
    }
    // Determine elevation range around zero (use symmetric range for clarity) without spreading huge arrays
    let maxAbsAlt = 1;
    for (const s of series) {
      for (let i = 0; i < s.alt.length; i++) {
        const v = Math.abs(s.alt[i]);
        if (v > maxAbsAlt) maxAbsAlt = v;
      }
    }

    const left = 40, right = 10, top = 10, bottom = 24;
    const w = rect.width - left - right;
    const h = rect.height - top - bottom;
    const midY = top + h / 2;

    // Axes baseline at zero
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, midY);
    ctx.lineTo(left + w, midY);
    ctx.stroke();

    const xOfDist = (d: number) => left + (maxDist > 0 ? (d / maxDist) * w : 0);
    const yOf = (alt: number) => midY - (alt / maxAbsAlt) * (h / 2);

    // Draw each series
    series.forEach(s => {
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      // Determine how much to draw: if scrubbing, only up to current time; otherwise full
      let count = s.time.length;
      if (scrubTimeSec !== null) {
        const t = Math.max(0, scrubTimeSec);
        // find last index with time <= t
        let idx = 0;
        while (idx + 1 < s.time.length && s.time[idx + 1] <= t) idx++;
        count = Math.max(2, idx + 1);
      }

      for (let i = 0; i < count; i++) {
        const x = xOfDist(s.dist[i]);
        const y = yOf(s.alt[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    // Scrub cursor
    if (scrubTimeSec !== null) {
      // Convert scrubbed time to distance per series; show cursor at max of those distances
      let cursorDist = 0;
      for (const s of series) {
        // find nearest time index
        const t = Math.max(0, scrubTimeSec);
        let idx = 0;
        while (idx + 1 < s.time.length && s.time[idx + 1] <= t) idx++;
        cursorDist = Math.max(cursorDist, s.dist[idx] || 0);
      }
      const x = xOfDist(cursorDist);
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#888';
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + h);
      ctx.stroke();
    }
  }, [series, scrubTimeSec, isAnimating]);

  const isLoading = totalCount > 0 && loadedCount === 0;
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', borderTop: '1px solid #1a1a1a' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      {routes.length > 0 && (
        <div style={{ position: 'absolute', top: 8, right: 12, color: '#888', fontSize: 12 }}>
          {loadedCount}/{totalCount} streams
        </div>
      )}
      {routes.length > 0 && !series.length && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 14 }}>
          {isLoading ? 'Loading elevation streams…' : 'No elevation streams available'}
        </div>
      )}
    </div>
  );
}


