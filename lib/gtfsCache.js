/**
 * GTFS-RT Cache Management
 * Simple memory-based cache with TTL support
 * Can be extended to use Vercel KV for persistence
 */

class GTFSCache {
  constructor() {
    // In-memory cache storage
    this.cache = new Map();
    this.defaultTTL = 30; // seconds
  }

  /**
   * Get cached data
   * @param {string} key - Cache key
   * @returns {Object|null} - Cached data with metadata or null if not found
   */
  async get(key) {
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    return {
      data: cached.data,
      timestamp: cached.timestamp,
      ttl: cached.ttl || this.defaultTTL,
      cached: true
    };
  }

  /**
   * Set cache data
   * @param {string} key - Cache key
   * @param {any} data - Data to cache
   * @param {Object} options - Cache options
   * @returns {Object} - Cached entry
   */
  async set(key, data, options = {}) {
    const entry = {
      data,
      timestamp: Date.now(),
      ttl: options.ttl || this.defaultTTL
    };

    this.cache.set(key, entry);

    // Optional: Clean up old entries periodically
    this.cleanupIfNeeded();

    return entry;
  }

  /**
   * Check if cached data is stale
   * @param {Object} cached - Cached entry
   * @param {number} ttl - TTL in seconds
   * @returns {boolean} - True if stale
   */
  isStale(cached, ttl = null) {
    if (!cached || !cached.timestamp) {
      return true;
    }

    const effectiveTTL = ttl || cached.ttl || this.defaultTTL;
    const age = Date.now() - cached.timestamp;

    return age > effectiveTTL * 1000;
  }

  /**
   * Clear specific cache entry
   * @param {string} key - Cache key to clear
   */
  async clear(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  async clearAll() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache stats
   */
  getStats() {
    const entries = Array.from(this.cache.entries());
    const now = Date.now();

    return {
      size: this.cache.size,
      entries: entries.map(([key, value]) => ({
        key,
        age: Math.floor((now - value.timestamp) / 1000),
        stale: this.isStale(value)
      }))
    };
  }

  /**
   * Clean up stale entries if cache is getting large
   * Called automatically after set operations
   */
  cleanupIfNeeded() {
    // Only cleanup if cache is large
    if (this.cache.size < 100) {
      return;
    }

    // Remove stale entries
    for (const [key, value] of this.cache.entries()) {
      if (this.isStale(value)) {
        this.cache.delete(key);
      }
    }

    // If still too large, remove oldest entries
    if (this.cache.size > 150) {
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);

      // Keep only the 100 most recent
      const toRemove = entries.slice(0, entries.length - 100);
      for (const [key] of toRemove) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Warm the cache with pre-fetched data
   * Useful for warming cache on cold starts
   */
  async warm(key, fetcher, ttl = null) {
    try {
      const data = await fetcher();
      return await this.set(key, data, { ttl });
    } catch (error) {
      console.error(`Failed to warm cache for ${key}:`, error);
      return null;
    }
  }
}

// Export singleton instance
export const gtfsCache = new GTFSCache();

// Export class for testing
export default GTFSCache;