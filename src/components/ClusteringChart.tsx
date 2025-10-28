import { useRef, useEffect, useState } from 'react';
import { getClusterColor } from '../utils/clustering';

interface ClusteringChartProps {
  features: string[];
  data: number[][]; // Raw feature data (already filtered/normalized)
  labels: number[];
  centroids: number[][];
  silhouetteScores: { k: number; score: number }[];
  selectedK: number;
}

export default function ClusteringChart({
  features,
  data,
  labels,
  centroids,
  silhouetteScores,
  selectedK,
}: ClusteringChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 300 });
  const [isResizing, setIsResizing] = useState(false);

  // Handle resize dragging
  const startPosRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startPosRef.current.x;
      const deltaY = e.clientY - startPosRef.current.y;
      
      const newWidth = Math.max(300, Math.min(800, startPosRef.current.width + deltaX));
      const newHeight = Math.max(250, Math.min(600, startPosRef.current.height + deltaY));
      
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
    if (!canvas || data.length === 0 || features.length < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = size.width;
    const height = size.height - 80; // Reserve space for silhouette chart
    const padding = 40;
    const plotWidth = width - 2 * padding;
    const plotHeight = height - 2 * padding;

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Get feature indices (use first two features for 2D plot)
    const xFeatureIdx = 0;
    const yFeatureIdx = 1;

    // Find min/max for scaling
    const xValues = data.map(d => d[xFeatureIdx]);
    const yValues = data.map(d => d[yFeatureIdx]);
    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues);
    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);

    // Add some padding to the ranges
    const xRange = xMax - xMin;
    const yRange = yMax - yMin;
    const xPadding = xRange * 0.1;
    const yPadding = yRange * 0.1;

    const scaleX = (val: number) => 
      padding + ((val - xMin + xPadding) / (xRange + 2 * xPadding)) * plotWidth;
    const scaleY = (val: number) => 
      height - padding - ((val - yMin + yPadding) / (yRange + 2 * yPadding)) * plotHeight;

    // Draw axes
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.stroke();

    // Draw axis labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '11px system-ui, -apple-system';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    // X-axis label
    const xLabel = features[xFeatureIdx].replace(/_/g, ' ');
    ctx.fillText(xLabel, width / 2, height - 15);
    
    // Y-axis label (rotated)
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    const yLabel = features[yFeatureIdx].replace(/_/g, ' ');
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const x = padding + (plotWidth / 5) * i;
      const y = height - padding - (plotHeight / 5) * i;
      
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, height - padding);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Draw data points
    const pointRadius = 4;
    const numClusters = Math.max(...labels) + 1;
    
    for (let i = 0; i < data.length; i++) {
      const x = scaleX(data[i][xFeatureIdx]);
      const y = scaleY(data[i][yFeatureIdx]);
      const cluster = labels[i];
      
      ctx.fillStyle = getClusterColor(cluster, numClusters);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 1;
      
      ctx.beginPath();
      ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Centroids removed per user request

    // Title
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = 'bold 12px system-ui, -apple-system';
    ctx.textAlign = 'center';
    ctx.fillText(`${xLabel} vs ${yLabel}`, width / 2, 15);

    // Show k and silhouette score
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '10px system-ui, -apple-system';
    ctx.textAlign = 'right';
    const bestScore = silhouetteScores.find(s => s.k === selectedK);
    if (bestScore) {
      ctx.fillText(`k=${selectedK}, score=${bestScore.score.toFixed(3)}`, width - padding - 5, padding + 5);
    }

  }, [data, labels, centroids, features, silhouetteScores, selectedK, size]);

  if (data.length === 0 || features.length < 2) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '340px', // 320px controls width + 20px margin
        width: `${size.width}px`,
        height: `${size.height}px`,
        background: 'rgba(26, 26, 46, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        padding: '12px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        zIndex: 1000,
        cursor: isResizing ? 'nwse-resize' : 'default',
      }}
    >
      <canvas
        ref={canvasRef}
        width={size.width}
        height={size.height - 80}
        style={{
          display: 'block',
          borderRadius: '4px',
        }}
      />
      
      {/* Silhouette scores chart */}
      <div style={{
        marginTop: '12px',
        padding: '8px',
        background: 'rgba(0, 0, 0, 0.3)',
        borderRadius: '4px',
      }}>
        <div style={{
          fontSize: '11px',
          color: 'rgba(255, 255, 255, 0.8)',
          marginBottom: '6px',
          fontWeight: 'bold',
        }}>
          Silhouette Score by k
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '50px' }}>
          {silhouetteScores.map(({ k, score }) => {
            const maxScore = Math.max(...silhouetteScores.map(s => s.score));
            const height = (score / maxScore) * 40;
            const isSelected = k === selectedK;
            
            return (
              <div key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div
                  style={{
                    width: '100%',
                    height: `${height}px`,
                    background: isSelected ? '#FF6B6B' : 'rgba(69, 183, 209, 0.7)',
                    borderRadius: '2px',
                    transition: 'all 0.2s',
                    border: isSelected ? '2px solid #FF0000' : 'none',
                  }}
                  title={`k=${k}, score=${score.toFixed(3)}`}
                />
                <div style={{
                  fontSize: '9px',
                  color: isSelected ? '#FF6B6B' : 'rgba(255, 255, 255, 0.6)',
                  marginTop: '4px',
                  fontWeight: isSelected ? 'bold' : 'normal',
                }}>
                  {k}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{
          fontSize: '9px',
          color: 'rgba(255, 255, 255, 0.5)',
          marginTop: '4px',
          textAlign: 'center',
        }}>
          Number of clusters (k)
        </div>
      </div>
      
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

