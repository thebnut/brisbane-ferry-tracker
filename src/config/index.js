/**
 * Central export for all configuration-related modules
 */

export { ModeProvider, useMode, useModeConfig, useModeFeature, useModeLabels, useModeBranding, useModeData } from './ModeProvider';
export { detectMode, loadModeConfig, isDevelopment, getApiBaseUrl } from './modeDetector';
export { FERRY_CONFIG } from './modes/ferry.config';

// Phase 3: Train mode
export { TRAIN_CONFIG } from './modes/train.config';

// Future exports (Phase 5)
// export { BUS_CONFIG } from './modes/bus.config';