import { readSettings, settingsSchema, type OverlaySettings } from './settings.js';

export interface ProfileBackup {
  format: 'chatiffy-profile'; schemaVersion: 1; name: string; settings: OverlaySettings;
}
export const maxBackupBytes = 64 * 1024;

/** A backup contains appearance and channel only, never a profile ID or server credentials. */
export function makeProfileBackup(name: string, settings: OverlaySettings): ProfileBackup {
  return { format: 'chatiffy-profile', schemaVersion: 1, name, settings: { ...settings } };
}
export function parseProfileBackup(text: string): ProfileBackup {
  if (new TextEncoder().encode(text).byteLength > maxBackupBytes) throw new Error('Файл слишком большой. Максимум — 64 КБ.');
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('Не удалось прочитать JSON. Выбери файл, экспортированный из Chatiffy.'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Это не файл профиля Chatiffy.');
  const data = raw as Record<string, unknown>;
  if (data.format !== 'chatiffy-profile' || data.schemaVersion !== 1) throw new Error('Формат профиля не поддерживается этой версией Chatiffy.');
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 64) throw new Error('В файле некорректное название сцены.');
  if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) throw new Error('В файле отсутствуют настройки оформления.');
  const fields = data.settings as Record<string, unknown>;
  if (typeof fields.channel !== 'string' || !/^[a-z0-9_]{1,25}$/i.test(fields.channel)) throw new Error('В файле некорректный Twitch-канал.');
  for (const key of Object.keys(settingsSchema) as (keyof OverlaySettings)[]) {
    if (!(key in fields)) continue; // Older backups can omit newly introduced settings.
    const value = fields[key]; const spec = settingsSchema[key];
    if (typeof value !== typeof spec.default || typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Некорректное поле профиля: ${key}`);
    const parsed = spec.parse(typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    if (key !== 'channel' && parsed !== value) throw new Error(`Недопустимое значение профиля: ${key}`);
  }
  const settings = readSettings(new URLSearchParams(), key => key === 'settingsVersion' ? '6'
    : typeof fields[key] === 'boolean' ? (fields[key] ? '1' : '0')
      : fields[key] === undefined ? null : String(fields[key]));
  return makeProfileBackup(data.name.trim(), settings);
}
export function backupFilename(name: string): string {
  const safe = name.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').slice(0, 60);
  return `Chatiffy-${safe || 'profile'}.json`;
}
