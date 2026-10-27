import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readSettings, type OverlaySettings } from '../shared/settings.js';

export interface Profile { revision: string; name: string; updatedAt: string; settings: OverlaySettings }
export interface ProfileSummary { id: string; name: string; channel: string; updatedAt: string }
export const validProfileId = (id: string): boolean => /^[a-f0-9]{32}$/.test(id);
export function normalizeSettings(input: unknown): OverlaySettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw Object.assign(new Error('Settings object required'), { status: 400 });
  // The shared schema remains the only normalization authority.
  const fields = input as Record<string, unknown>;
  return readSettings(new URLSearchParams(), key => {
    if (key === 'settingsVersion') return '6';
    const value = fields[key];
    return typeof value === 'boolean' ? (value ? '1' : '0') : typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  });
}
export class ProfileStore {
  constructor(private readonly directory: string) {}
  private path(id: string): string {
    if (!validProfileId(id)) throw Object.assign(new Error('Invalid profile ID'), { status: 400 });
    return join(this.directory, `${id}.json`);
  }
  async read(id: string): Promise<Profile | null> {
    const path = this.path(id);
    try {
      const profile = JSON.parse(await readFile(path, 'utf8')) as Profile;
      return { ...profile, name: profile.name || 'Основная сцена', updatedAt: profile.updatedAt || '' };
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async list(): Promise<ProfileSummary[]> {
    let files: string[];
    try { files = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const profiles = await Promise.all(files.filter(file => /^[a-f0-9]{32}\.json$/.test(file)).map(async file => {
      const id = file.slice(0, -5);
      try {
        const profile = await this.read(id);
        return profile ? { id, name: profile.name, channel: profile.settings.channel, updatedAt: profile.updatedAt } : null;
      } catch { return null; } // One damaged profile must not hide the remaining scenes.
    }));
    return profiles.filter((profile): profile is ProfileSummary => profile !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async write(id: string, input: unknown): Promise<Profile> {
    const path = this.path(id);
    const envelope = input && typeof input === 'object' && 'settings' in input ? input as { name?: unknown; settings: unknown } : null;
    const previous = await this.read(id);
    const name = typeof envelope?.name === 'string' ? envelope.name.trim().slice(0, 64) : previous?.name || 'Основная сцена';
    if (!name) throw Object.assign(new Error('Название профиля не может быть пустым'), { status: 400 });
    const profile: Profile = { revision: randomUUID(), name, updatedAt: new Date().toISOString(), settings: normalizeSettings(envelope ? envelope.settings : input) };
    await mkdir(this.directory, { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(profile), { mode: 0o600 });
    await rename(temp, path);
    return profile;
  }
}
