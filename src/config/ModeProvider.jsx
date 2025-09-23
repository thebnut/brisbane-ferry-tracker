import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { detectMode, loadModeConfig } from './modeDetector';
import { ModeContext } from './modeContext';

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

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const mode = overrideMode || detectMode();
      console.log(`Loading configuration for mode: ${mode}`);

      const modeConfig = await loadModeConfig(mode);

      const enrichedConfig = {
        ...modeConfig,
        getServiceType: (routeId) => {
          return modeConfig.data.gtfs.routeCategories[routeId] || {
            id: 'unknown',
            name: 'Unknown',
            icon: '🚌',
            color: 'bg-gray-500',
            borderColor: 'border-gray-500',
            isExpress: false,
            priority: 999,
          };
        },
        isExpressRoute: (routeId) => {
          const serviceType = modeConfig.data.gtfs.routeCategories[routeId];
          return serviceType?.isExpress || false;
        },
        formatStopName: (name) => {
          if (modeConfig.ui.labels.noStopsSuffix) {
            return name
              .replace(/\s+ferry\s+terminal$/i, '')
              .replace(/\s+train\s+station$/i, '')
              .replace(/\s+railway\s+station$/i, '')
              .replace(/\s+bus\s+stop$/i, '')
              .replace(/\s+stop\s+\d+$/i, '');
          }
          return name;
        },
      };

      setConfig(enrichedConfig);
    } catch (err) {
      console.error('Failed to load mode configuration:', err);
      setError(err.message);
      try {
        const { FERRY_CONFIG } = await import('./modes/ferry.config.js');
        setConfig(FERRY_CONFIG);
      } catch (fallbackErr) {
        console.error('Failed to load fallback configuration:', fallbackErr);
      }
    } finally {
      setLoading(false);
    }
  }, [overrideMode]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const contextValue = useMemo(() => ({
    config,
    loading,
    error,
    reload: loadConfig,
  }), [config, loading, error, loadConfig]);

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
export default ModeProvider;
