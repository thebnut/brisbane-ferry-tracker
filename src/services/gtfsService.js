import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { API_CONFIG } from '../utils/constants';

class GTFSService {
  constructor() {
    this.baseUrl = API_CONFIG.baseUrl;
    this.mode = 'ferry'; // Default to ferry, will be updated from ModeProvider
    // TEMP: Disable serverless cache until Phase 2 (Vercel Functions not configured yet)
    this.useServerlessCache = false; // TODO: Re-enable in Phase 2: import.meta.env.VITE_USE_CACHE !== 'false';
    this.requestsInFlight = new Set(); // Track active requests to prevent duplicates
    this.lastRequestTime = {}; // Track last request time per endpoint
    this.MIN_REQUEST_INTERVAL = 5000; // 5 seconds minimum between same endpoint requests
  }

  setMode(mode) {
    this.mode = mode;
  }

  async fetchFeed(endpoint) {
    // Check if request is already in flight
    if (this.requestsInFlight.has(endpoint)) {
      console.log(`Request already in flight for ${endpoint}, skipping`);
      return null;
    }

    // Check throttling
    const now = Date.now();
    const lastRequest = this.lastRequestTime[endpoint] || 0;
    if (now - lastRequest < this.MIN_REQUEST_INTERVAL) {
      console.log(`Throttling ${endpoint} request - too soon since last request`);
      return null;
    }

    this.requestsInFlight.add(endpoint);
    this.lastRequestTime[endpoint] = now;

    try {
      let url;

      // Check if we're on GitHub Pages (no CORS proxy available)
      const isGitHubPages = window.location.hostname.includes('github.io');

      if (isGitHubPages) {
        console.warn(`Cannot fetch live data on GitHub Pages due to CORS. Endpoint: ${endpoint}`);
        throw new Error('Live data not available on GitHub Pages deployment');
      }

      // Use serverless cache if enabled
      if (this.useServerlessCache) {
        url = `/api/rt/${this.mode}?endpoint=${encodeURIComponent(endpoint)}`;
        console.log(`Using serverless cache for ${this.mode} mode`);
      } else {
        // Fallback to direct proxy
        url = `/api/gtfs-proxy?endpoint=${encodeURIComponent(endpoint)}`;
        console.log('Using direct GTFS proxy (cache disabled)');
      }
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
        new Uint8Array(buffer)
      );

      return feed;
    } catch (error) {
      console.error(`Error fetching ${endpoint}:`, error);
      // Don't throw - return null to allow graceful degradation
      return null;
    } finally {
      // Always remove from in-flight set
      this.requestsInFlight.delete(endpoint);
    }
  }

  async getTripUpdates() {
    try {
      const feed = await this.fetchFeed(API_CONFIG.endpoints.tripUpdates);
      return feed?.entity || [];
    } catch (error) {
      console.error('Error getting trip updates:', error);
      return [];
    }
  }

  async getVehiclePositions() {
    try {
      const feed = await this.fetchFeed(API_CONFIG.endpoints.vehiclePositions);
      return feed?.entity || [];
    } catch (error) {
      console.error('Error getting vehicle positions:', error);
      return [];
    }
  }

  async getServiceAlerts() {
    try {
      const feed = await this.fetchFeed(API_CONFIG.endpoints.serviceAlerts);
      return feed?.entity || [];
    } catch (error) {
      console.error('Error getting service alerts:', error);
      return [];
    }
  }

  // Get all data at once
  async getAllData() {
    try {
      // Fetch trip updates and vehicle positions in parallel
      // Service alerts are optional - don't fail if they error
      const [tripUpdates, vehiclePositions] = await Promise.all([
        this.getTripUpdates(),
        this.getVehiclePositions()
      ]);

      // Try to get service alerts but don't fail if they error
      let serviceAlerts = [];
      try {
        serviceAlerts = await this.getServiceAlerts();
      } catch (error) {
        console.warn('Could not fetch service alerts, continuing without them:', error);
      }

      return {
        tripUpdates,
        vehiclePositions,
        serviceAlerts,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Error getting all data:', error);
      throw error;
    }
  }
}

// Export singleton instance
export default new GTFSService();