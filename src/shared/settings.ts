/** Stable identifiers used in persisted settings and OBS URLs. */
export const fontFamilies = {
  monocraft: 'Monocraft, Consolas, monospace', segoe: '"Segoe UI", Arial, sans-serif',
  arial: 'Arial, sans-serif', verdana: 'Verdana, sans-serif', georgia: 'Georgia, serif',
  consolas: 'Consolas, "Courier New", monospace'
} as const;
export const settingsVersion = 6;
export interface OverlaySettings {
  channel: string; fontFamily: keyof typeof fontFamilies; fontWeight: '400' | '700';
  fontStyle: 'normal' | 'italic'; lineHeight: number; letterSpacing: number; fontSize: number;
  lifetime: number; maxMessages: number; background: boolean;
  theme: 'pixel' | 'glass' | 'clean' | 'neon'; align: 'left' | 'right';
  textColor: string; panelOpacity: number; vignette: number; radius: number;
}
export type StoredSettings = (key: string) => string | null;
interface Setting<T> { query: string; default: T; parse(raw: string): T }
function numeric(query: string, fallback: number, min: number, max: number): Setting<number> {
  return { query, default: fallback, parse(raw) {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  } };
}
function choice<T extends string>(query: string, fallback: T, allowed: readonly T[]): Setting<T> {
  return { query, default: fallback, parse: raw => allowed.includes(raw as T) ? raw as T : fallback };
}
/** Add a setting here: reading and URL serialization automatically include it. */
export const settingsSchema: { [K in keyof OverlaySettings]: Setting<OverlaySettings[K]> } = {
  channel: { query: 'channel', default: 'mimiclous', parse(raw) {
    const value = raw.toLowerCase().replace(/^#/, '');
    return /^[a-z0-9_]{1,25}$/.test(value) ? value : 'mimiclous';
  } },
  fontFamily: choice('font', 'monocraft', Object.keys(fontFamilies) as (keyof typeof fontFamilies)[]),
  fontWeight: choice('weight', '400', ['400', '700']), fontStyle: choice('italic', 'normal', ['normal', 'italic']),
  lineHeight: numeric('line', 1.22, 1, 2), letterSpacing: numeric('spacing', 0, -1, 5),
  fontSize: numeric('size', 28, 16, 48), lifetime: numeric('lifetime', 0, 0, 120),
  maxMessages: numeric('max', 9, 5, 30),
  background: { query: 'background', default: false, parse: raw => raw !== '0' },
  theme: choice('theme', 'pixel', ['pixel', 'glass', 'clean', 'neon']),
  align: choice('align', 'left', ['left', 'right']),
  textColor: { query: 'text', default: '#ffffff', parse: raw => /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#ffffff' },
  panelOpacity: numeric('panel', 32, 0, 80), vignette: numeric('vignette', 55, 0, 100), radius: numeric('radius', 0, 0, 40)
};
export function readSettings(params: URLSearchParams, stored: StoredSettings = () => null): OverlaySettings {
  const result = {} as OverlaySettings;
  function read<K extends keyof OverlaySettings>(key: K) {
    const spec = settingsSchema[key];
    const legacy = key === 'background' && Number(stored('settingsVersion')) < settingsVersion;
    const raw = params.get(spec.query) ?? (legacy ? null : stored(key));
    result[key] = raw === null ? spec.default : spec.parse(raw);
  }
  for (const key of Object.keys(settingsSchema) as (keyof OverlaySettings)[]) read(key);
  return result;
}
export function serializeSettings(settings: OverlaySettings, instance: string): URLSearchParams {
  const params = new URLSearchParams({ instance });
  for (const key of Object.keys(settingsSchema) as (keyof OverlaySettings)[]) {
    const value = settings[key];
    params.set(settingsSchema[key].query, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  return params;
}
