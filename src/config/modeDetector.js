/**
 * Mode detection based on hostname
 * Determines which transit mode (ferry, train, bus) to use based on the current domain
 */

export function detectMode() {
  const hostname = window.location.hostname.toLowerCase();

  // Development mode override via environment variable
  if (import.meta.env.VITE_MODE) {
    console.log(`Mode override via VITE_MODE: ${import.meta.env.VITE_MODE}`);
    return import.meta.env.VITE_MODE;
  }

  // Development mode override via URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const modeParam = urlParams.get('mode');
  if (modeParam) {
    console.log(`Mode override via URL parameter: ${modeParam}`);
    return modeParam;
  }

  // Production mode detection based on hostname
  if (hostname.includes('train')) {
    return 'train';
  }

  if (hostname.includes('bus')) {
    return 'bus';
  }

  // Default to ferry for:
  // - brisbaneferry.com
  // - ferry.lifemap.au
  // - localhost
  // - any other domain
  return 'ferry';
}

/**
 * Get the appropriate configuration file based on mode
 */
export async function loadModeConfig(mode) {
  try {
    switch (mode) {
      case 'train':
        const { default: TRAIN_CONFIG } = await import('./modes/train.config.js');
        return TRAIN_CONFIG;

      case 'bus':
        // Will be implemented in Phase 5
        console.warn('Bus mode not yet implemented, falling back to ferry');
        const { FERRY_CONFIG: BUS_FALLBACK } = await import('./modes/ferry.config.js');
        return BUS_FALLBACK;

      case 'ferry':
      default:
        const { FERRY_CONFIG } = await import('./modes/ferry.config.js');
        return FERRY_CONFIG;
    }
  } catch (error) {
    console.error(`Failed to load config for mode: ${mode}`, error);
    // Fallback to ferry config if loading fails
    const { FERRY_CONFIG } = await import('./modes/ferry.config.js');
    return FERRY_CONFIG;
  }
}

/**
 * Check if running in development mode
 */
export function isDevelopment() {
  return import.meta.env.DEV ||
         window.location.hostname === 'localhost' ||
         window.location.hostname === '127.0.0.1';
}

/**
 * Get the base URL for API calls based on mode and environment
 */
export function getApiBaseUrl(mode) {
  // In development, always use the proxy
  if (isDevelopment()) {
    return '';
  }

  // In production, use the appropriate domain
  // This ensures CORS proxy works correctly
  switch (mode) {
    case 'train':
      return 'https://brisbanetrain.com';
    case 'bus':
      return 'https://brisbanebus.com';
    case 'ferry':
    default:
      return 'https://www.brisbaneferry.com';
  }
}
