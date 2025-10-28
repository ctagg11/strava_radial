# Strava Radial Map

Visualize all your Strava activities radiating from a single center point. Watch routes animate based on their actual timing, scrub through the timeline, and explore your training history in a new way.

## Features

- **Radial visualization** – All routes start from the same point and branch outward
- **Timeline animation** – Routes draw progressively at their actual speed (adjustable 1–1000x)
- **Timeline scrubbing** – Drag the timeline to jump to any moment
- **K-Means clustering** – Group similar rides by distance, speed, elevation, and more
- **Clustering visualization** – 2D scatter plot with silhouette scores to understand cluster quality
- **Activity coloring** – Blue for cycling, red for running, or multi-color for clusters
- **Interactive hover** – Mouse over any route to see activity details
- **WebGL rendering** – Smooth 60fps animation with GPU acceleration
- **Compass overlay** – N/S/E/W reference lines for orientation
- **Auto-zoom** – Viewport adjusts as longer routes extend outward
- **Strava OAuth** – Secure authentication with your Strava account

## Setup

### Prerequisites

- Node.js 18+ and npm
- A Strava API application ([create one here](https://www.strava.com/settings/api))

### Installation

1. Clone the repo:
   ```bash
   git clone https://github.com/yourusername/strava-radial-map.git
   cd strava-radial-map
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env` in the project root:
   ```env
   VITE_STRAVA_CLIENT_ID=your_client_id
   VITE_STRAVA_CLIENT_SECRET=your_client_secret
   VITE_REDIRECT_URI=http://localhost:5173
   ```
   (Get your credentials from [Strava API Settings](https://www.strava.com/settings/api); set the **Authorization Callback Domain** to `localhost` for local development.)

4. Start the dev server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173](http://localhost:5173).

## Usage

1. **Login** with your Strava account.
2. **Load Activities** to fetch your data (cached locally to respect API limits).
3. **Play** to animate all routes; adjust speed (1-1000x) or scrub the timeline to explore.
4. **Enable Clustering** to group similar rides:
   - Select 2+ features (distance, speed, elevation, moving time, max speed)
   - Click "Apply Clustering" to run K-Means algorithm
   - View clustering visualization in bottom-right corner showing:
     - 2D scatter plot of first two features
     - Cluster centroids (red stars)
     - Silhouette scores for k=2 through k=6 (selected k highlighted)
5. **Hover** over any route to see activity name, type, and distance.

## Tech Stack

- React 18 + TypeScript
- Vite
- Three.js (WebGL rendering for GPU-accelerated graphics)
- Canvas API (2D overlay for labels and clustering charts)
- K-Means clustering with silhouette score optimization
- Strava API v3
- Axios

## Project Structure

```
strava-radial-map/
├── src/
│   ├── components/
│   │   ├── RadialMapWebGL.tsx    # WebGL radial visualization (Three.js)
│   │   ├── ClusteringChart.tsx   # 2D clustering visualization
│   │   └── Controls.tsx          # Sidebar UI, timeline, and clustering controls
│   ├── utils/
│   │   ├── polyline.ts           # Polyline decoder for Strava routes
│   │   └── clustering.ts         # K-Means algorithm and utilities
│   ├── App.tsx                   # Main app logic
│   ├── stravaService.ts          # Strava OAuth and API calls
│   ├── types.ts
│   └── index.css
├── .env                          # Your API keys (not committed)
├── package.json
└── vite.config.ts
```

## How It Works

### Visualization
1. Fetch all your Strava activities and their GPS polylines.
2. Decode polylines to lat/lng coordinates.
3. Convert to meters relative to each activity's start point.
4. Render using Three.js WebGL with all starts centered at origin.
5. Animate based on each activity's `moving_time`; adjust with the speed slider or timeline scrubber.

### Clustering Algorithm
1. Extract selected features from activities (distance, speed, elevation, etc.).
2. Standardize features using Z-score normalization for fair comparison.
3. Run K-Means clustering for k=2 through k=6:
   - Uses k-means++ initialization for better convergence
   - Iterates until cluster assignments stabilize
4. Calculate silhouette score for each k:
   - Measures cluster cohesion (how close points are within clusters)
   - Measures cluster separation (how far apart different clusters are)
   - Score ranges from -1 to 1 (higher is better)
5. Select k with highest silhouette score as optimal.
6. Color routes based on cluster assignment.

## Troubleshooting

- **"Failed to authenticate"**: Check your Client ID/Secret and redirect URI match exactly (including port).
- **No routes visible**: Ensure your activities have GPS data. Virtual or indoor activities may lack polylines.
- **Slow loading**: Large activity counts (1000+) take time; data is cached after the first fetch.

## Building for Production

```bash
npm run build
```
Output is in `dist/`.

## License

MIT

## Acknowledgments

Built for the Strava community.
