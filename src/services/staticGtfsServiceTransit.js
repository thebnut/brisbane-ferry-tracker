import JSZip from 'jszip';
import Papa from 'papaparse';
import { STOPS, ROUTES, DEBUG_CONFIG, STORAGE_KEYS } from '../utils/constants';
import { startOfDay, endOfDay, format, parse, isAfter, isBefore, addMinutes } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

/**
 * Transit-aware GTFS Service for station-level data access
 * Extends base staticGtfsService functionality for train/bus modes
 * with station abstraction and platform metadata handling
 */
class StaticGTFSServiceTransit {
  constructor() {
    this.timezone = 'Australia/Brisbane';
    this.mode = 'ferry'; // Default mode, will be updated from ModeProvider
    this.scheduleCacheKey = STORAGE_KEYS.SCHEDULE_CACHE;
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
    this.gtfsData = null;
    this.stopsData = null; // For train mode: stations; for other modes: stops
    this.platformsData = null; // Platform reference data for train mode
    this.platformToStation = null; // Platform ID -> Station ID mapping for train mode
    this.stopConnectivity = null;
    this.debug = true; // Enable debug for transit service

    // Circuit breaker for failed fetches to prevent infinite 404 loops
    this.fetchFailures = new Map(); // mode -> { count, lastAttempt }
    this.maxFailures = 3;
    this.retryBackoff = 30000; // 30 seconds

    // URL parameter support: Add ?useGitHub=true to use GitHub data on localhost
    // This helps developers test with the latest production data
    const urlParams = new URLSearchParams(window.location.search);
    const forceGitHub = urlParams.get('useGitHub') || urlParams.get('useGithub');

    // Mode will be set later, use ferry as default
    this.updateScheduleUrls(forceGitHub);

    // Log the data source for debugging on localhost
    if (window.location.hostname === 'localhost') {
      console.log(`📍 Using ${forceGitHub ? 'GitHub' : 'local'} schedule data`);
    }
  }

  // Set the mode for this service
  setMode(mode) {
    this.mode = mode;
    // Update cache key to be mode-specific
    this.scheduleCacheKey = `${STORAGE_KEYS.SCHEDULE_CACHE}_${mode}`;
    // Update URLs when mode changes
    const urlParams = new URLSearchParams(window.location.search);
    const forceGitHub = urlParams.get('useGitHub') || urlParams.get('useGithub');
    this.updateScheduleUrls(forceGitHub);
  }

  // Update schedule URLs based on mode
  updateScheduleUrls(forceGitHub) {
    // For train and bus modes, use transit infrastructure
    const useTransitInfrastructure = this.mode === 'train' || this.mode === 'bus';
    const basePath = useTransitInfrastructure
      ? 'https://thebnut.github.io/brisbane-ferry-tracker/schedule-data-transit'
      : 'https://thebnut.github.io/brisbane-ferry-tracker/schedule-data';

    if (window.location.hostname === 'localhost' && !forceGitHub) {
      // Use local paths on localhost (unless forced to use GitHub)
      this.githubScheduleUrl = useTransitInfrastructure
        ? `/schedule-data-transit/${this.mode}/latest.json`
        : `/schedule-data/${this.mode}/latest.json`;
      this.fallbackScheduleUrl = `/schedule-data/${this.mode}/latest.json`;
    } else {
      // Use GitHub Pages URLs for production or when forced
      this.githubScheduleUrl = `${basePath}/${this.mode}/latest.json`;
      this.fallbackScheduleUrl = `${basePath}/${this.mode}/latest.json`;
    }

    if (this.debug) {
      console.log(`📍 Transit service URLs updated for ${this.mode} mode:`, {
        github: this.githubScheduleUrl,
        fallback: this.fallbackScheduleUrl,
        useTransitInfrastructure
      });
    }
  }

  // Check if we have stop/station data loaded
  hasStopsData() {
    return this.stopsData && Object.keys(this.stopsData).length > 0;
  }

  // Get available stops/stations for UI
  getAvailableStops() {
    if (this.debug) {
      console.log(`📍 Transit service getAvailableStops called for ${this.mode}:`, {
        hasStopsData: !!this.stopsData,
        stopsCount: this.stopsData ? Object.keys(this.stopsData).length : 0
      });
    }

    if (!this.stopsData) return [];

    // Convert stops/stations data to array format expected by UI
    const stops = Object.entries(this.stopsData).map(([id, data]) => ({
      id,
      name: data.name,
      lat: data.lat,
      lng: data.lng,
      // For train mode, include platform count
      ...(this.mode === 'train' && data.platforms ? {
        platformCount: data.platforms.length,
        platforms: data.platforms
      } : {})
    })).sort((a, b) => a.name.localeCompare(b.name));

    if (this.debug && stops.length > 0) {
      console.log(`✅ Returning ${stops.length} ${this.mode} stops, first 3:`, stops.slice(0, 3).map(s => s.name));
    }

    return stops;
  }

  // Get valid destinations from a given origin
  getValidDestinations(originId) {
    if (!this.stopsData || !this.stopsData[originId]) return [];
    return this.stopsData[originId].validDestinations || [];
  }

  // Get platform information for a station (train mode only)
  getStationPlatforms(stationId) {
    if (this.mode !== 'train' || !this.stopsData || !this.stopsData[stationId]) {
      return [];
    }
    return this.stopsData[stationId].platforms || [];
  }

  // Convert platform ID to station ID (train mode only)
  getStationIdFromPlatform(platformId) {
    if (this.mode !== 'train' || !this.platformToStation) {
      return platformId; // Return as-is for non-train modes
    }
    return this.platformToStation[platformId] || platformId;
  }

  // Get platform info from platform ID (train mode only)
  getPlatformInfo(platformId) {
    if (this.mode !== 'train' || !this.platformsData || !this.platformsData[platformId]) {
      return null;
    }
    return this.platformsData[platformId];
  }

  // Main method to get scheduled departures
  async getScheduledDepartures(selectedStops = null) {
    try {
      // Try to load from GitHub first
      const data = await this.loadFromGitHub();

      if (data) {
        this.processScheduleData(data);
        return this.filterDeparturesForStops(data.departures, selectedStops);
      }

      // Fallback to GTFS processing would go here
      throw new Error('No schedule data available');

    } catch (error) {
      console.error('Error loading scheduled departures:', error);
      throw error;
    }
  }

  // Load schedule data from GitHub
  async loadFromGitHub() {
    const now = Date.now();
    const failureKey = this.mode;

    // Check circuit breaker
    if (this.fetchFailures.has(failureKey)) {
      const failure = this.fetchFailures.get(failureKey);
      if (failure.count >= this.maxFailures &&
          (now - failure.lastAttempt) < this.retryBackoff) {
        if (this.debug) {
          console.log(`⚡ Circuit breaker active for ${this.mode}, skipping GitHub fetch`);
        }
        return null;
      }
    }

    try {
      // Check cache first
      const cached = this.getCachedData();
      if (cached) {
        // Validate against GitHub timestamp
        const githubTimestamp = await this.getGitHubTimestamp();
        if (githubTimestamp && cached.generated >= githubTimestamp) {
          if (this.debug) {
            console.log(`✅ Using cached ${this.mode} data (up to date)`);
          }
          return cached;
        }
      }

      // Fetch from GitHub
      if (this.debug) {
        console.log(`🌐 Fetching ${this.mode} schedule from GitHub...`);
      }

      const response = await fetch(this.githubScheduleUrl);

      if (!response.ok) {
        throw new Error(`GitHub fetch failed: ${response.status}`);
      }

      const data = await response.json();

      // Cache the successful response
      this.setCachedData(data);

      // Reset failure count on success
      this.fetchFailures.delete(failureKey);

      if (this.debug) {
        console.log(`✅ Loaded ${this.mode} schedule from GitHub:`, {
          departures: data.departures?.length || 0,
          stops: Object.keys(data.stops || {}).length,
          generated: data.generated
        });
      }

      return data;

    } catch (error) {
      // Update failure tracking
      const current = this.fetchFailures.get(failureKey) || { count: 0, lastAttempt: 0 };
      this.fetchFailures.set(failureKey, {
        count: current.count + 1,
        lastAttempt: now
      });

      console.warn(`❌ GitHub fetch failed for ${this.mode}:`, error.message);

      // Return cached data as fallback
      const cached = this.getCachedData();
      if (cached) {
        if (this.debug) {
          console.log(`📦 Using cached ${this.mode} data as fallback`);
        }
        return cached;
      }

      throw error;
    }
  }

  // Get GitHub timestamp for cache validation
  async getGitHubTimestamp() {
    try {
      const response = await fetch(this.githubScheduleUrl, { method: 'HEAD' });
      if (response.ok) {
        const lastModified = response.headers.get('last-modified');
        return lastModified ? new Date(lastModified).toISOString() : null;
      }
    } catch (error) {
      // Ignore timestamp fetch errors
    }
    return null;
  }

  // Process schedule data and extract stops/stations
  processScheduleData(data) {
    this.stopsData = data.stops || {};
    this.stopConnectivity = data.stopConnectivity || {};

    // For train mode, also store platform reference data
    if (this.mode === 'train') {
      this.platformsData = data.platforms || {};
      this.platformToStation = data.platformToStation || {};

      if (this.debug) {
        console.log(`🚂 Loaded train data:`, {
          stations: Object.keys(this.stopsData).length,
          platforms: Object.keys(this.platformsData).length,
          platformMappings: Object.keys(this.platformToStation).length
        });
      }
    }
  }

  // Filter departures for selected stops/stations
  filterDeparturesForStops(departures, selectedStops) {
    if (!departures || !selectedStops) return departures || [];

    const { outbound, inbound } = selectedStops;

    // For train mode, filter by station IDs; for other modes, filter by stop IDs
    const originId = this.mode === 'train' ? outbound.id : outbound.id;
    const destinationId = this.mode === 'train' ? inbound.id : inbound.id;

    return departures.filter(departure => {
      // For train mode, check both platform stopId and stationId
      if (this.mode === 'train') {
        return departure.stationId === originId || departure.stationId === destinationId;
      } else {
        return departure.stopId === originId || departure.stopId === destinationId;
      }
    });
  }

  // Cache management
  getCachedData() {
    try {
      const cached = localStorage.getItem(this.scheduleCacheKey);
      if (!cached) return null;

      const data = JSON.parse(cached);
      const age = Date.now() - new Date(data.cached).getTime();

      if (age > this.cacheExpiry) {
        localStorage.removeItem(this.scheduleCacheKey);
        return null;
      }

      return data.data;
    } catch (error) {
      console.warn('Error reading cache:', error);
      return null;
    }
  }

  setCachedData(data) {
    try {
      const cacheEntry = {
        data,
        cached: new Date().toISOString()
      };
      localStorage.setItem(this.scheduleCacheKey, JSON.stringify(cacheEntry));
    } catch (error) {
      console.warn('Error writing cache:', error);
    }
  }
}

// Export singleton instance
const staticGtfsServiceTransit = new StaticGTFSServiceTransit();
export default staticGtfsServiceTransit;