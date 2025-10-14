export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  start_date: string;
  start_latitude: number;
  start_longitude: number;
  map?: {
    polyline?: string;
    summary_polyline: string;
  };
  distance: number;
  moving_time: number;
  total_elevation_gain: number;
}

export interface ActivityPoint {
  lat: number;
  lng: number;
}

export interface RouteData {
  activity: StravaActivity;
  points: ActivityPoint[];
  color: string;
}

export interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface ActivityStream {
  activityId: number;
  time: number[]; // seconds from start
  altitude: number[]; // meters
  distance?: number[]; // meters from start
}

