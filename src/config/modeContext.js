import { createContext, useContext } from 'react';

export const ModeContext = createContext(null);

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

export function useModeConfig(path) {
  const config = useMode();
  if (!path) return config;
  return path.split('.').reduce((obj, key) => obj?.[key], config);
}

export function useModeFeature(feature) {
  const config = useMode();
  return config.features?.[feature] ?? false;
}

export function useModeLabels() {
  const config = useMode();
  return config.ui?.labels || {};
}

export function useModeBranding() {
  const config = useMode();
  return config.branding || {};
}

export function useModeData() {
  const config = useMode();
  return config.data || {};
}
