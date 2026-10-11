// Style names and swatches for the panel (the ids match packages/engine/styles/<id>).
import { t, type MessageKey } from '../i18n';

const KNOWN = ['warm-story', 'study', 'whiteboard', 'chalkboard', 'tech-dark'];
/** a style's name in the interface language; undefined for a style the panel doesn't know */
export const styleName = (id: string): string | undefined => (KNOWN.includes(id) ? t(`common.styles.${id}` as MessageKey) : undefined);
/** a built-in style's one-line summary in the interface language; undefined for others */
export const styleSummary = (id: string): string | undefined => (KNOWN.includes(id) ? t(`common.styleSummaries.${id}` as MessageKey) : undefined);
/** STYLE_NAME[id], read at use time so it follows the language */
export const STYLE_NAME: Record<string, string | undefined> = new Proxy({}, { get: (_, id) => (typeof id === 'string' ? styleName(id) : undefined) });
export const STYLE_SWATCH: Record<string, string[]> = {
  'warm-story': ['#F4E7D3', '#C8603C', '#E0A23B', '#7E9F7A'],
  study: ['#F4EEE2', '#2B2520', '#3D6D93', '#C0782E'],
  whiteboard: ['#F7F8F7', '#1E2226', '#D0342C', '#1F5DBA'],
  chalkboard: ['#223029', '#F1ECE1', '#F3DD86', '#F0A3A0'],
  'tech-dark': ['#15171A', '#E8E6E1', '#4FBFAE', '#E3A64B'],
};
