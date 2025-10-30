import { ActivityPoint } from '../types';

/**
 * Route Matching using Compass Signature Similarity
 * Similar to DTW but optimized for browser performance
 * Compares the "shape" of routes by analyzing bearing changes
 */

export interface RouteSignature {
  bearings: number[]; // Array of compass bearings along route
  distances: number[]; // Cumulative distances
  totalDistance: number;
  startPoint: { lat: number; lng: number };
  endPoint: { lat: number; lng: number };
}

export interface RouteMatchResult {
  labels: number[]; // -1 for unique, >= 0 for pattern groups
  patterns: number; // Number of distinct patterns found
  uniqueRoutes: number; // Number of one-off routes
  patternColors: string[];
  similarityMatrix?: number[][]; // Optional: for debugging
}

/**
 * Calculate bearing between two lat/lng points (in degrees, 0-360)
 */
function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;

  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

  let bearing = Math.atan2(y, x) * 180 / Math.PI;
  bearing = (bearing + 360) % 360; // Normalize to 0-360

  return bearing;
}

/**
 * Calculate distance between two lat/lng points (in meters)
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Create a route signature from GPS points
 * Downsamples to ~50 segments for fast comparison
 */
export function createRouteSignature(points: ActivityPoint[]): RouteSignature {
  if (points.length < 2) {
    return {
      bearings: [],
      distances: [],
      totalDistance: 0,
      startPoint: points[0] || { lat: 0, lng: 0 },
      endPoint: points[0] || { lat: 0, lng: 0 },
    };
  }

  // Downsample to ~50 points for performance
  const targetPoints = Math.min(50, points.length);
  const step = Math.floor(points.length / targetPoints);
  const sampledPoints: ActivityPoint[] = [];
  
  for (let i = 0; i < points.length; i += step) {
    sampledPoints.push(points[i]);
  }
  
  // Always include last point
  if (sampledPoints[sampledPoints.length - 1] !== points[points.length - 1]) {
    sampledPoints.push(points[points.length - 1]);
  }

  // Calculate bearings and distances
  const bearings: number[] = [];
  const distances: number[] = [0];
  let cumDist = 0;

  for (let i = 0; i < sampledPoints.length - 1; i++) {
    const p1 = sampledPoints[i];
    const p2 = sampledPoints[i + 1];

    const bearing = calculateBearing(p1.lat, p1.lng, p2.lat, p2.lng);
    bearings.push(bearing);

    const dist = haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
    cumDist += dist;
    distances.push(cumDist);
  }

  return {
    bearings,
    distances,
    totalDistance: cumDist,
    startPoint: points[0],
    endPoint: points[points.length - 1],
  };
}

/**
 * Compare two route signatures and return similarity score (0-1)
 * Lower score = more similar routes
 */
function compareSignatures(sig1: RouteSignature, sig2: RouteSignature): number {
  if (sig1.bearings.length === 0 || sig2.bearings.length === 0) {
    return 1.0; // Maximum dissimilarity
  }

  // Component 1: Start/end point similarity (30% weight)
  const startDist = haversineDistance(
    sig1.startPoint.lat, sig1.startPoint.lng,
    sig2.startPoint.lat, sig2.startPoint.lng
  );
  const endDist = haversineDistance(
    sig1.endPoint.lat, sig1.endPoint.lng,
    sig2.endPoint.lat, sig2.endPoint.lng
  );
  
  // Normalize by 5km (routes starting >5km apart are very different)
  const locationScore = Math.min((startDist + endDist) / 10000, 1.0);

  // Component 2: Distance similarity (20% weight)
  const distRatio = Math.abs(sig1.totalDistance - sig2.totalDistance) / 
                    Math.max(sig1.totalDistance, sig2.totalDistance);
  const distanceScore = Math.min(distRatio * 2, 1.0); // 50% difference = max score

  // Component 3: Bearing signature similarity (50% weight)
  // Compare bearing sequences using simplified DTW
  const bearingScore = compareBearingSequences(sig1.bearings, sig2.bearings);

  // Weighted combination
  const totalScore = locationScore * 0.3 + distanceScore * 0.2 + bearingScore * 0.5;

  return totalScore;
}

/**
 * Compare two bearing sequences using simplified correlation
 * Returns 0-1 where 0 = identical, 1 = completely different
 */
function compareBearingSequences(bearings1: number[], bearings2: number[]): number {
  // Normalize both sequences to same length (interpolate)
  const targetLen = Math.min(bearings1.length, bearings2.length, 30);
  
  const norm1 = interpolateBearings(bearings1, targetLen);
  const norm2 = interpolateBearings(bearings2, targetLen);

  // Calculate mean absolute difference in bearings
  let totalDiff = 0;
  for (let i = 0; i < targetLen; i++) {
    let diff = Math.abs(norm1[i] - norm2[i]);
    // Handle wrapping (e.g., 5° and 355° are similar)
    if (diff > 180) diff = 360 - diff;
    totalDiff += diff;
  }

  // Normalize by maximum possible difference (180° * length)
  const normalizedDiff = totalDiff / (180 * targetLen);

  return normalizedDiff;
}

/**
 * Interpolate bearing array to target length
 */
function interpolateBearings(bearings: number[], targetLen: number): number[] {
  if (bearings.length === 0) return new Array(targetLen).fill(0);
  if (bearings.length === targetLen) return bearings;

  const result: number[] = [];
  const ratio = (bearings.length - 1) / (targetLen - 1);

  for (let i = 0; i < targetLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;

    if (idx >= bearings.length - 1) {
      result.push(bearings[bearings.length - 1]);
    } else {
      // Linear interpolation between bearings (handling wrapping)
      let b1 = bearings[idx];
      let b2 = bearings[idx + 1];
      
      // Handle 0/360 wrapping
      if (Math.abs(b2 - b1) > 180) {
        if (b1 < b2) b1 += 360;
        else b2 += 360;
      }

      let interpolated = b1 + (b2 - b1) * frac;
      interpolated = interpolated % 360;
      if (interpolated < 0) interpolated += 360;

      result.push(interpolated);
    }
  }

  return result;
}

/**
 * Simple DBSCAN clustering for route matching
 */
function dbscan(distanceMatrix: number[][], eps: number, minSamples: number): number[] {
  const n = distanceMatrix.length;
  const labels = new Array(n).fill(-1);
  let clusterId = 0;

  function rangeQuery(idx: number): number[] {
    const neighbors: number[] = [];
    for (let i = 0; i < n; i++) {
      if (distanceMatrix[idx][i] <= eps) {
        neighbors.push(i);
      }
    }
    return neighbors;
  }

  function expandCluster(idx: number, neighbors: number[], cid: number) {
    labels[idx] = cid;
    
    let i = 0;
    while (i < neighbors.length) {
      const nIdx = neighbors[i];
      
      if (labels[nIdx] === -1) {
        labels[nIdx] = cid;
        const nNeighbors = rangeQuery(nIdx);
        
        if (nNeighbors.length >= minSamples) {
          neighbors.push(...nNeighbors.filter(n => !neighbors.includes(n)));
        }
      }
      
      i++;
    }
  }

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1) continue;
    
    const neighbors = rangeQuery(i);
    
    if (neighbors.length < minSamples) {
      labels[i] = -1; // Noise
    } else {
      expandCluster(i, neighbors, clusterId);
      clusterId++;
    }
  }

  return labels;
}

/**
 * Generate distinct colors for route patterns
 */
function getPatternColor(patternIndex: number): string {
  const colors = [
    '#FF3B3B', // Bright Red
    '#00D9FF', // Cyan
    '#FFD93B', // Bright Yellow
    '#9D4EDD', // Purple
    '#06FFA5', // Bright Mint Green
    '#FF6B35', // Orange-Red
    '#4361EE', // Royal Blue
    '#FF1E8C', // Hot Pink
    '#00B4D8', // Blue
    '#F72585', // Pink
  ];
  return colors[patternIndex % colors.length];
}

/**
 * Find similar routes using compass signature matching
 * @param routes - Array of GPS point arrays
 * @param similarityThreshold - 0-1, lower = stricter matching (default 0.25)
 * @param minMatches - Minimum routes to form a pattern (default 2)
 */
export function findSimilarRoutes(
  routes: ActivityPoint[][],
  similarityThreshold: number = 0.25,
  minMatches: number = 2
): RouteMatchResult {
  console.log(`Finding similar routes (threshold: ${similarityThreshold})...`);

  if (routes.length === 0) {
    return {
      labels: [],
      patterns: 0,
      uniqueRoutes: 0,
      patternColors: [],
    };
  }

  // Step 1: Create signatures for all routes
  const signatures = routes.map(route => createRouteSignature(route));

  // Step 2: Build similarity matrix
  const n = routes.length;
  const distanceMatrix: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const similarity = compareSignatures(signatures[i], signatures[j]);
      distanceMatrix[i][j] = similarity;
      distanceMatrix[j][i] = similarity;
    }
  }

  // Step 3: Cluster using DBSCAN
  const labels = dbscan(distanceMatrix, similarityThreshold, minMatches);

  // Step 4: Count patterns and unique routes
  const uniqueLabels = new Set(labels);
  const patterns = Array.from(uniqueLabels).filter(l => l >= 0).length;
  const uniqueRoutes = labels.filter(l => l === -1).length;

  // Step 5: Generate colors
  const patternColors = Array.from({ length: patterns }, (_, i) => getPatternColor(i));

  console.log(`Found ${patterns} route patterns and ${uniqueRoutes} unique routes`);

  return {
    labels,
    patterns,
    uniqueRoutes,
    patternColors,
    similarityMatrix: distanceMatrix,
  };
}

/**
 * Get color for a specific route based on its pattern label
 */
export function getRouteMatchColor(patternLabel: number): string {
  if (patternLabel === -1) {
    // Unique/noise routes - gray
    return '#808080';
  }
  return getPatternColor(patternLabel);
}

