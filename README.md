# Strava Radial Map

Visualize all your Strava activities radiating from a single center point. Watch routes animate based on their actual timing, scrub through the timeline, and explore your training history in a new way.

## Features

- **Radial visualization** – All routes start from the same point and branch outward
- **Timeline animation** – Routes draw progressively at their actual speed (adjustable 1–10x)
- **Timeline scrubbing** – Drag the timeline to jump to any moment
- **Activity coloring** – Blue for cycling, red for running
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
3. **Play** to animate all routes; adjust speed or scrub the timeline to explore.

## Tech Stack

- React 18 + TypeScript
- Vite
- Canvas API (custom radial rendering)
- Strava API v3
- Axios

## Project Structure

```
strava-radial-map/
├── src/
│   ├── components/
│   │   ├── RadialMap.tsx     # Canvas-based radial visualization
│   │   └── Controls.tsx      # Sidebar UI and timeline
│   ├── utils/
│   │   └── polyline.ts       # Polyline decoder for Strava routes
│   ├── App.tsx               # Main app logic
│   ├── stravaService.ts      # Strava OAuth and API calls
│   ├── types.ts
│   └── index.css
├── .env                      # Your API keys (not committed)
├── package.json
└── vite.config.ts
```

## How It Works

1. Fetch all your Strava activities and their GPS polylines.
2. Decode polylines to lat/lng coordinates.
3. Convert to meters relative to each activity's start point.
4. Render on a canvas with all starts centered.
5. Animate based on each activity's `moving_time`; adjust with the speed slider or timeline scrubber.

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
