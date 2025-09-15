/**
 * Central export for all configuration-related modules
 */

export { ModeProvider, useMode, useModeConfig, useModeFeature, useModeLabels, useModeBranding, useModeData } from './ModeProvider';
export { detectMode, loadModeConfig, isDevelopment, getApiBaseUrl } from './modeDetector';
export { FERRY_CONFIG } from './modes/ferry.config';

// Future exports (Phase 3 and Phase 5)
// export { TRAIN_CONFIG } from './modes/train.config';
// export { BUS_CONFIG } from './modes/bus.config';