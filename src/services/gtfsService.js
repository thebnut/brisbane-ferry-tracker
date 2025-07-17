import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { API_CONFIG } from '../utils/constants';

class GTFSService {
  constructor() {
    this.baseUrl = API_CONFIG.baseUrl;
  }

  async fetchFeed(endpoint) {
    try {
      let url;
      
      // Use proxy in development or when deployed to Vercel
      if (import.meta.env.DEV || window.location.hostname.includes('vercel')) {
        url = `/api/gtfs-proxy?endpoint=${encodeURIComponent(endpoint)}`;
      } else {
        url = `${this.baseUrl}${endpoint}`;
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
      throw new Error(`Failed to fetch ${endpoint}: ${error.message}`);
    }
  }

  async getTripUpdates() {
    try {
      const feed = await this.fetchFeed(API_CONFIG.endpoints.tripUpdates);
      return feed.entity || [];
    } catch (error) {
      console.error('Error getting trip updates:', error);
      return [];
    }
  }

  async getVehiclePositions() {
    try {
      const feed = await this.fetchFeed(API_CONFIG.endpoints.vehiclePositions);
      return feed.entity || [];
    } catch (error) {
      console.error('Error getting vehicle positions:', error);
      return [];
    }
  }

  async getServiceAlerts() {
    try {
      const feed = await this.fetchFeed(API_CONFIG.endpoints.serviceAlerts);
      return feed.entity || [];
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