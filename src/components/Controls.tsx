interface ControlsProps {
  onLogin: () => void;
  onLogout: () => void;
  onFetchData: () => void;
  onStartAnimation: () => void;
  onPauseAnimation: () => void;
  onResetAnimation: () => void;
  onSpeedChange: (speed: number) => void;
  onScrubChange?: (seconds: number) => void;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAnimating: boolean;
  animationSpeed: number;
  activityCount: number;
  maxDurationSec?: number;
  scrubTimeSec?: number | null;
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
  isAuthenticated,
  isLoading,
  isAnimating,
  animationSpeed,
  activityCount,
  maxDurationSec,
  scrubTimeSec,
}: ControlsProps) {
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
              max="10"
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
                type="range"
                min={0}
                max={Math.max(1, Math.floor(maxDurationSec))}
                step={1}
                value={Math.floor(scrubTimeSec ?? 0)}
                onChange={(e) => onScrubChange(Number(e.target.value))}
                className="speed-slider"
              />
              <div className="speed-value">{Math.floor(scrubTimeSec ?? 0)}s</div>
            </div>
          )}
        </div>
      )}

      <div className="controls-section">
        <div className="section-label">Activity Types</div>
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
      </div>
    </div>
  );
}

