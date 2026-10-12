export { Studio, type MaterialFile, type StudioOptions } from './studio.js';
export { DATA_DIR, PROJECTS_DIR, configFile, withDefaults, type Config, type ConfigStore } from './config.js';
export type * from './types.js';
export type { Renderer } from '@frametell/agent';
export { tr, locale, systemLocale } from './i18n.js';
/** the sample shipped with a built-in voice (no key needed to hear it) */
export { bundledSample as voiceSample } from '@frametell/voice';
