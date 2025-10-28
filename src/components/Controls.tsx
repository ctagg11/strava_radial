import { useRef, useEffect } from 'react';

interface ControlsProps {
  onLogin: () => void;
  onLogout: () => void;
  onFetchData: () => void;
  onStartAnimation: () => void;
  onPauseAnimation: () => void;
  onResetAnimation: () => void;
  onSpeedChange: (speed: number) => void;
  onScrubChange?: (seconds: number) => void;
  onScrubDirect?: (seconds: number) => void; // For immediate ref updates
  isAuthenticated: boolean;
  isLoading: boolean;
  isAnimating: boolean;
  animationSpeed: number;
  activityCount: number;
  maxDurationSec?: number;
  scrubTimeSec?: number | null;
  clusteringEnabled: boolean;
  onClusteringToggle: (enabled: boolean) => void;
  selectedFeatures: string[];
  onFeaturesChange: (features: string[]) => void;
  onApplyClustering: () => void;
  clusterCount?: number;
  clusterColors?: string[];
}

export default function Controls({
  onLogin,
  onLogout,
  onFetchData,
  onStartAnimation,
  onPauseAnimation,
  onResetAnimation,
  onSpeedChange,
  onScrubChange,
  onScrubDirect,
  isAuthenticated,
  isLoading,
  isAnimating,
  animationSpeed,
  activityCount,
  maxDurationSec,
  scrubTimeSec,
  clusteringEnabled,
  onClusteringToggle,
  selectedFeatures,
  onFeaturesChange,
  onApplyClustering,
  clusterCount,
  clusterColors,
}: ControlsProps) {
  const timelineSliderRef = useRef<HTMLInputElement>(null);

  // Add direct event listener for instant scrubbing (bypasses React)
  useEffect(() => {
    const slider = timelineSliderRef.current;
    if (!slider || !onScrubDirect) return;

    const handleInput = (e: Event) => {
      const value = Number((e.target as HTMLInputElement).value);
      onScrubDirect(value); // Update ref immediately
    };

    slider.addEventListener('input', handleInput);
    return () => slider.removeEventListener('input', handleInput);
  }, [onScrubDirect]);

  return (
    <div className="controls">
      <div className="controls-header">
        <h1>Radial Map</h1>
        <p className="subtitle">Strava activity visualization</p>
      </div>

      <div className="controls-section">
        {!isAuthenticated ? (
          <button onClick={onLogin} className="btn btn-primary">
            Connect Strava
          </button>
        ) : (
          <div className="auth-section">
            <button onClick={onFetchData} disabled={isLoading} className="btn btn-primary">
              {isLoading ? 'Loading...' : `Load Activities (${activityCount})`}
            </button>
            <button onClick={onLogout} className="btn btn-ghost">
              Disconnect
            </button>
          </div>
        )}
      </div>

      {isAuthenticated && activityCount > 0 && (
        <div className="controls-section">
          <div className="section-label">Animation</div>
          <div className="button-group">
            <button onClick={onStartAnimation} disabled={isAnimating} className="btn btn-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 2v12l10-6z"/>
              </svg>
            </button>
            <button onClick={onPauseAnimation} disabled={!isAnimating} className="btn btn-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6 2h2v12H6V2zm4 0h2v12h-2V2z"/>
              </svg>
            </button>
            <button onClick={onResetAnimation} className="btn btn-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2a6 6 0 0 0-6 6h2a4 4 0 1 1 4 4v2a6 6 0 0 0 6-6h-2a4 4 0 0 1-4-4V2z"/>
              </svg>
            </button>
          </div>
          <div className="speed-control">
            <div className="speed-label">Speed</div>
            <input
              type="range"
              min="1"
              max="1000"
              value={animationSpeed}
              onChange={(e) => onSpeedChange(Number(e.target.value))}
              className="speed-slider"
            />
            <div className="speed-value">{animationSpeed}x</div>
          </div>
          {maxDurationSec && onScrubChange && (
            <div className="speed-control" style={{ marginTop: '0.5rem' }}>
              <div className="speed-label">Timeline</div>
              <input
                ref={timelineSliderRef}
                type="range"
                min={0}
                max={Math.max(1, Math.floor(maxDurationSec))}
                step={0.1}
                value={scrubTimeSec ?? 0}
                onChange={(e) => onScrubChange(Number(e.target.value))}
                className="speed-slider"
              />
              <div className="speed-value">{Math.floor(scrubTimeSec ?? 0)}s</div>
            </div>
          )}
        </div>
      )}

      <div className="controls-section">
        <div className="section-label">Coloring</div>
        <div className="clustering-toggle">
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={clusteringEnabled}
              onChange={(e) => onClusteringToggle(e.target.checked)}
            />
            <span>Enable Clustering</span>
          </label>
        </div>
        
        {!clusteringEnabled && (
          <div className="legend">
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#4285f4' }}></span>
              <span>Cycling</span>
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#ea4335' }}></span>
              <span>Running</span>
            </div>
          </div>
        )}

        {clusteringEnabled && (
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ marginBottom: '0.5rem', fontSize: '0.85rem', opacity: 0.8 }}>
              Select Features
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {[
                { value: 'distance_km', label: 'Distance (km)' },
                { value: 'average_speed_kph', label: 'Average Speed (km/h)' },
                { value: 'total_elevation_gain', label: 'Elevation Gain (m)' },
                { value: 'moving_time_hours', label: 'Moving Time (hrs)' },
                { value: 'max_speed_kph', label: 'Max Speed (km/h)' },
              ].map(({ value, label }) => (
                <label key={value} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={selectedFeatures.includes(value)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onFeaturesChange([...selectedFeatures, value]);
                      } else {
                        onFeaturesChange(selectedFeatures.filter(f => f !== value));
                      }
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <button
              onClick={onApplyClustering}
              disabled={selectedFeatures.length < 2}
              className="btn btn-primary"
              style={{ marginTop: '0.75rem', width: '100%' }}
            >
              Apply Clustering
            </button>
            {clusterCount && clusterColors && (
              <div className="legend" style={{ marginTop: '0.75rem' }}>
                <div style={{ marginBottom: '0.35rem', fontSize: '0.85rem', opacity: 0.8 }}>
                  {clusterCount} Clusters Found
                </div>
                {clusterColors.map((color, i) => (
                  <div key={i} className="legend-item">
                    <span className="legend-color" style={{ backgroundColor: color }}></span>
                    <span>Cluster {i + 1}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

