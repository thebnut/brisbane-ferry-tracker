/**
 * Central export for all configuration-related modules
 */

export { default as ModeProvider } from './ModeProvider';
export { useMode, useModeConfig, useModeFeature, useModeLabels, useModeBranding, useModeData } from './modeContext';
export { detectMode, loadModeConfig, isDevelopment, getApiBaseUrl } from './modeDetector';
export { FERRY_CONFIG } from './modes/ferry.config';
export { TRAIN_CONFIG } from './modes/train.config';
// export { BUS_CONFIG } from './modes/bus.config';
