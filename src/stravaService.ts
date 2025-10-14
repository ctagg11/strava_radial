import axios from 'axios';
import { StravaActivity, StravaTokenResponse, ActivityStream } from './types';

// Strava API configuration
const STRAVA_CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID || '';
const STRAVA_CLIENT_SECRET = import.meta.env.VITE_STRAVA_CLIENT_SECRET || '';
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI || window.location.origin;

export class StravaService {
  private static readonly STORAGE_KEY = 'strava_access_token';
  private static readonly REFRESH_KEY = 'strava_refresh_token';
  private static readonly EXPIRES_KEY = 'strava_expires_at';

  // Get authorization URL
  static getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: STRAVA_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'activity:read_all',
      approval_prompt: 'force',
    });
    return `https://www.strava.com/oauth/authorize?${params.toString()}`;
  }

  // Exchange authorization code for access token
  static async exchangeCodeForToken(code: string): Promise<StravaTokenResponse> {
    try {
      const response = await axios.post('https://www.strava.com/oauth/token', {
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      });

      const { access_token, refresh_token, expires_at } = response.data;
      this.saveTokens(access_token, refresh_token, expires_at);

      return { access_token, refresh_token, expires_at };
    } catch (error) {
      console.error('Error exchanging code for token:', error);
      throw error;
    }
  }

  // Get stored access token
  static getAccessToken(): string | null {
    return localStorage.getItem(this.STORAGE_KEY);
  }

  // Save tokens to localStorage
  private static saveTokens(
    accessToken: string,
    refreshToken: string,
    expiresAt: number
  ): void {
    localStorage.setItem(this.STORAGE_KEY, accessToken);
    localStorage.setItem(this.REFRESH_KEY, refreshToken);
    localStorage.setItem(this.EXPIRES_KEY, expiresAt.toString());
  }

  // Check if token is expired
  static isTokenExpired(): boolean {
    const expiresAt = localStorage.getItem(this.EXPIRES_KEY);
    if (!expiresAt) return true;
    return Date.now() / 1000 >= parseInt(expiresAt);
  }

  // Refresh access token
  static async refreshAccessToken(): Promise<string> {
    const refreshToken = localStorage.getItem(this.REFRESH_KEY);
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await axios.post('https://www.strava.com/oauth/token', {
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });

      const { access_token, refresh_token, expires_at } = response.data;
      this.saveTokens(access_token, refresh_token, expires_at);

      return access_token;
    } catch (error) {
      console.error('Error refreshing token:', error);
      this.logout();
      throw error;
    }
  }

  // Get valid access token (refresh if needed)
  static async getValidToken(): Promise<string> {
    if (this.isTokenExpired()) {
      return await this.refreshAccessToken();
    }
    return this.getAccessToken()!;
  }

  // Fetch all activities
  static async fetchActivities(page: number = 1, perPage: number = 100): Promise<StravaActivity[]> {
    try {
      const token = await this.getValidToken();
      const response = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          page,
          per_page: perPage,
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching activities:', error);
      throw error;
    }
  }

  // Fetch all activities (with pagination)
  static async fetchAllActivities(): Promise<StravaActivity[]> {
    const allActivities: StravaActivity[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const activities = await this.fetchActivities(page);
      if (activities.length === 0) {
        hasMore = false;
      } else {
        allActivities.push(...activities);
        page++;
        // Rate limit: Strava allows 600 requests per 15 minutes
        // Adding small delay to be safe
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return allActivities;
  }

  // Fetch altitude/time streams for an activity
  static async fetchActivityStreams(activityId: number): Promise<ActivityStream | null> {
    try {
      const token = await this.getValidToken();
      const response = await axios.get(`https://www.strava.com/api/v3/activities/${activityId}/streams`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { keys: 'time,altitude,distance', key_by_type: true },
      });

      const data = response.data || {};
      const time = data.time?.data as number[] | undefined;
      const altitude = data.altitude?.data as number[] | undefined;
      const distance = data.distance?.data as number[] | undefined;
      if (!time || !altitude || time.length !== altitude.length) return null;
      const stream: ActivityStream = { activityId, time, altitude };
      if (distance && distance.length === time.length) stream.distance = distance;
      return stream;
    } catch (e) {
      console.error('Error fetching activity streams', activityId, e);
      return null;
    }
  }

  // Batched streams fetch with small concurrency and simple backoff for 429
  static async fetchStreamsBatch(
    activityIds: number[],
    onProgress?: (id: number, stream: ActivityStream | null) => void,
    concurrency: number = 4,
  ): Promise<Record<number, ActivityStream | undefined>> {
    const result: Record<number, ActivityStream | undefined> = {};
    const queue = [...activityIds];
    let active = 0;

    return await new Promise(resolve => {
      const next = async () => {
        if (queue.length === 0 && active === 0) return resolve(result);
        while (active < concurrency && queue.length) {
          const id = queue.shift()!;
          active++;
          (async () => {
            try {
              const stream = await this.fetchActivityStreams(id);
              if (stream) result[id] = stream;
              onProgress?.(id, stream);
            } catch (err: any) {
              // If rate limited, simple wait and requeue once
              if (axios.isAxiosError(err) && err.response?.status === 429) {
                await new Promise(r => setTimeout(r, 1500));
                queue.push(id);
              } else {
                onProgress?.(id, null);
              }
            } finally {
              active--;
              next();
            }
          })();
        }
      };
      next();
    });
  }

  // Logout
  static logout(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    localStorage.removeItem(this.REFRESH_KEY);
    localStorage.removeItem(this.EXPIRES_KEY);
  }

  // Check if user is authenticated
  static isAuthenticated(): boolean {
    return this.getAccessToken() !== null && !this.isTokenExpired();
  }
}

