/**
 * K-Means Clustering Implementation
 * Based on the Python clustering algorithm from strava.py
 */

export interface ClusterFeatures {
  distance_km?: number;
  average_speed_kph?: number;
  total_elevation_gain?: number;
  moving_time_hours?: number;
  max_speed_kph?: number;
}

export interface ClusterResult {
  labels: number[];
  centroids: number[][];
  silhouetteScore: number;
  k: number;
  scaledData?: number[][]; // Standardized data for visualization
  rawData?: number[][]; // Raw data before standardization
  silhouetteScores?: Array<{ k: number; score: number }>; // All scores tested
}

/**
 * Seeded random number generator for deterministic clustering
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
}

/**
 * Standardize features (Z-score normalization)
 */
function standardize(data: number[][]): { scaled: number[][], means: number[], stds: number[] } {
  const numFeatures = data[0].length;
  const means = new Array(numFeatures).fill(0);
  const stds = new Array(numFeatures).fill(0);

  // Calculate means
  for (let j = 0; j < numFeatures; j++) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i][j];
    }
    means[j] = sum / data.length;
  }

  // Calculate standard deviations
  for (let j = 0; j < numFeatures; j++) {
    let sumSquared = 0;
    for (let i = 0; i < data.length; i++) {
      sumSquared += Math.pow(data[i][j] - means[j], 2);
    }
    stds[j] = Math.sqrt(sumSquared / data.length);
  }

  // Standardize
  const scaled = data.map(row => 
    row.map((val, j) => stds[j] === 0 ? 0 : (val - means[j]) / stds[j])
  );

  return { scaled, means, stds };
}

/**
 * Calculate Euclidean distance between two points
 */
function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.pow(a[i] - b[i], 2);
  }
  return Math.sqrt(sum);
}

/**
 * K-Means clustering algorithm with deterministic initialization
 */
export function kMeans(data: number[][], k: number, maxIterations = 100, seed = 42): { labels: number[], centroids: number[][] } {
  const n = data.length;
  const d = data[0].length;
  const rng = new SeededRandom(seed);

  // Initialize centroids deterministically (k-means++)
  const centroids: number[][] = [];
  const usedIndices = new Set<number>();
  
  // First centroid is deterministic
  const firstIdx = Math.floor(rng.next() * n);
  centroids.push([...data[firstIdx]]);
  usedIndices.add(firstIdx);

  // Select remaining centroids using k-means++
  for (let c = 1; c < k; c++) {
    const distances = data.map(point => {
      const minDist = Math.min(...centroids.map(centroid => euclideanDistance(point, centroid)));
      return minDist * minDist;
    });
    
    const sum = distances.reduce((a, b) => a + b, 0);
    const probabilities = distances.map(d => d / sum);
    
    // Select next centroid based on probability distribution
    let rand = rng.next();
    let cumulativeProb = 0;
    let selectedIdx = 0;
    for (let i = 0; i < n; i++) {
      cumulativeProb += probabilities[i];
      if (rand <= cumulativeProb) {
        selectedIdx = i;
        break;
      }
    }
    
    centroids.push([...data[selectedIdx]]);
    usedIndices.add(selectedIdx);
  }

  let labels = new Array(n).fill(0);
  
  // Iterate until convergence or max iterations
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Assign each point to nearest centroid
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      let minCluster = 0;
      
      for (let c = 0; c < k; c++) {
        const dist = euclideanDistance(data[i], centroids[c]);
        if (dist < minDist) {
          minDist = dist;
          minCluster = c;
        }
      }
      
      if (labels[i] !== minCluster) {
        labels[i] = minCluster;
        changed = true;
      }
    }

    if (!changed) break;

    // Update centroids
    for (let c = 0; c < k; c++) {
      const clusterPoints = data.filter((_, i) => labels[i] === c);
      if (clusterPoints.length > 0) {
        for (let j = 0; j < d; j++) {
          const sum = clusterPoints.reduce((acc, point) => acc + point[j], 0);
          centroids[c][j] = sum / clusterPoints.length;
        }
      }
    }
  }

  return { labels, centroids };
}

/**
 * Calculate silhouette score for clustering quality
 */
function silhouetteScore(data: number[][], labels: number[]): number {
  const n = data.length;
  const k = Math.max(...labels) + 1;
  
  if (k === 1 || n === 0) return 0;

  let totalScore = 0;

  for (let i = 0; i < n; i++) {
    const ownCluster = labels[i];
    
    // Calculate a(i): average distance to points in same cluster
    const sameClusterPoints = data.filter((_, j) => labels[j] === ownCluster && i !== j);
    let a = 0;
    if (sameClusterPoints.length > 0) {
      a = sameClusterPoints.reduce((sum, point) => sum + euclideanDistance(data[i], point), 0) / sameClusterPoints.length;
    }

    // Calculate b(i): min average distance to points in other clusters
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === ownCluster) continue;
      const otherClusterPoints = data.filter((_, j) => labels[j] === c);
      if (otherClusterPoints.length > 0) {
        const avgDist = otherClusterPoints.reduce((sum, point) => sum + euclideanDistance(data[i], point), 0) / otherClusterPoints.length;
        b = Math.min(b, avgDist);
      }
    }

    const s = (b - a) / Math.max(a, b);
    totalScore += s;
  }

  return totalScore / n;
}

/**
 * Find optimal k using silhouette score
 */
export function findOptimalK(data: number[][], kRange: number[] = [2, 3, 4, 5, 6]): ClusterResult {
  let bestK = kRange[0];
  let bestScore = -1;
  let bestLabels: number[] = [];
  let bestCentroids: number[][] = [];
  const allScores: Array<{ k: number; score: number }> = [];

  for (const k of kRange) {
    const { labels, centroids } = kMeans(data, k);
    const score = silhouetteScore(data, labels);
    
    allScores.push({ k, score });
    
    if (score > bestScore) {
      bestScore = score;
      bestK = k;
      bestLabels = labels;
      bestCentroids = centroids;
    }
  }

  return {
    labels: bestLabels,
    centroids: bestCentroids,
    silhouetteScore: bestScore,
    k: bestK,
    silhouetteScores: allScores,
  };
}

/**
 * Cluster activities based on selected features
 */
export function clusterActivities(
  activities: Array<{ distance: number; moving_time: number; total_elevation_gain: number; average_speed?: number; max_speed?: number }>,
  featureNames: string[],
  kRange: number[] = [2, 3, 4, 5, 6]
): ClusterResult {
  // Extract and prepare feature data
  const data: number[][] = activities.map(activity => {
    const features: number[] = [];
    
    featureNames.forEach(feature => {
      switch (feature) {
        case 'distance_miles':
          features.push(activity.distance / 1609.34);
          break;
        case 'average_speed_mph':
          features.push(activity.average_speed ? activity.average_speed * 2.23694 : (activity.distance / activity.moving_time) * 2.23694);
          break;
        case 'total_elevation_gain':
          features.push(activity.total_elevation_gain * 3.28084); // Convert meters to feet
          break;
        case 'moving_time_hours':
          features.push(activity.moving_time / 3600);
          break;
        case 'max_speed_mph':
          features.push(activity.max_speed ? activity.max_speed * 2.23694 : 0);
          break;
      }
    });
    
    return features;
  });

  // Standardize data
  const { scaled } = standardize(data);

  // Find optimal clustering
  const result = findOptimalK(scaled, kRange);
  
  // Add raw and scaled data for visualization
  return {
    ...result,
    rawData: data,
    scaledData: scaled,
  };
}

/**
 * Get color for cluster (using highly distinct colors)
 */
export function getClusterColor(clusterIndex: number, _totalClusters?: number): string {
  const colors = [
    '#FF3B3B', // Bright Red
    '#00D9FF', // Cyan
    '#FFD93B', // Bright Yellow
    '#9D4EDD', // Purple
    '#06FFA5', // Bright Mint Green
    '#FF6B35', // Orange-Red
    '#4361EE', // Royal Blue
    '#FF1E8C', // Hot Pink
  ];
  
  return colors[clusterIndex % colors.length];
}

