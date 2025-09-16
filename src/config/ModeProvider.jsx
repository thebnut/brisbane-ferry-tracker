import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { detectMode, loadModeConfig } from './modeDetector';

// Create context for mode configuration
const ModeContext = createContext(null);

/**
 * ModeProvider component that provides mode configuration to the entire app
 * @param {Object} props
 * @param {React.ReactNode} props.children - Child components
 * @param {string} [props.overrideMode] - Optional mode override for testing
 */
export function ModeProvider({ children, overrideMode = null }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadConfig() {
      try {
        setLoading(true);
        setError(null);

        // Determine which mode to use
        const mode = overrideMode || detectMode();
        console.log(`Loading configuration for mode: ${mode}`);

        // Load the configuration
        const modeConfig = await loadModeConfig(mode);

        // Add computed properties
        const enrichedConfig = {
          ...modeConfig,
          // Add helper methods
          getServiceType: (routeId) => {
            return modeConfig.data.gtfs.routeCategories[routeId] || {
              id: 'unknown',
              name: 'Unknown',
              icon: '🚌',
              color: 'bg-gray-500',
              borderColor: 'border-gray-500',
              isExpress: false,
              priority: 999
            };
          },
          isExpressRoute: (routeId) => {
            const serviceType = modeConfig.data.gtfs.routeCategories[routeId];
            return serviceType?.isExpress || false;
          },
          formatStopName: (name) => {
            if (modeConfig.ui.labels.noStopsSuffix) {
              // Remove "ferry terminal", "train station", "bus stop" suffixes
              return name
                .replace(/\s+ferry\s+terminal$/i, '')
                .replace(/\s+train\s+station$/i, '')
                .replace(/\s+railway\s+station$/i, '')
                .replace(/\s+bus\s+stop$/i, '')
                .replace(/\s+stop\s+\d+$/i, ''); // Remove "Stop 1", "Stop 2", etc.
            }
            return name;
          }
        };

        setConfig(enrichedConfig);
      } catch (err) {
        console.error('Failed to load mode configuration:', err);
        setError(err.message);
        // Don't leave the app in a broken state - load ferry as fallback
        try {
          const { FERRY_CONFIG } = await import('./modes/ferry.config.js');
          setConfig(FERRY_CONFIG);
        } catch (fallbackErr) {
          console.error('Failed to load fallback configuration:', fallbackErr);
        }
      } finally {
        setLoading(false);
      }
    }

    loadConfig();
  }, [overrideMode]);

  const contextValue = useMemo(() => ({
    config,
    loading,
    error,
    reload: () => {
      setConfig(null);
      loadConfig();
    }
  }), [config, loading, error]);

  if (loading) {
    // Show a loading state while configuration loads
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ferry-orange mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading configuration...</p>
        </div>
      </div>
    );
  }

  if (error && !config) {
    // Show error state if configuration failed to load and no fallback
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center text-red-600">
          <p className="text-xl font-semibold">Configuration Error</p>
          <p className="mt-2">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-ferry-orange text-white rounded hover:bg-ferry-orange-dark"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  return (
    <ModeContext.Provider value={contextValue}>
      {children}
    </ModeContext.Provider>
  );
}

/**
 * Hook to access the mode configuration
 * @returns {Object} Mode configuration object
 */
export function useMode() {
  const context = useContext(ModeContext);
  if (!context) {
    throw new Error('useMode must be used within ModeProvider');
  }
  if (!context.config) {
    throw new Error('Mode configuration not loaded');
  }
  return context.config;
}

/**
 * Hook to access a specific configuration path
 * @param {string} path - Dot-separated path to config value (e.g., 'ui.labels.stop')
 * @returns {any} Configuration value at the specified path
 */
export function useModeConfig(path) {
  const config = useMode();
  if (!path) return config; // Return full config if no path specified
  return path.split('.').reduce((obj, key) => obj?.[key], config);
}

/**
 * Hook to check if a feature is enabled
 * @param {string} feature - Feature name
 * @returns {boolean} Whether the feature is enabled
 */
export function useModeFeature(feature) {
  const config = useMode();
  return config.features[feature] ?? false;
}

/**
 * Hook to get mode-specific labels
 * @returns {Object} UI labels for the current mode
 */
export function useModeLabels() {
  const config = useMode();
  return config.ui.labels;
}

/**
 * Hook to get mode branding
 * @returns {Object} Branding configuration for the current mode
 */
export function useModeBranding() {
  const config = useMode();
  return config.branding;
}

/**
 * Hook to get data configuration
 * @returns {Object} Data configuration for the current mode
 */
export function useModeData() {
  const config = useMode();
  return config.data;
}