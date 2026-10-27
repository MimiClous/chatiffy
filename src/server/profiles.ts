import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readSettings, type OverlaySettings } from '../shared/settings.js';

export interface Profile { revision: string; settings: OverlaySettings }
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
    try { return JSON.parse(await readFile(path, 'utf8')) as Profile; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async write(id: string, input: unknown): Promise<Profile> {
    const path = this.path(id);
    const profile: Profile = { revision: randomUUID(), settings: normalizeSettings(input) };
    await mkdir(this.directory, { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(profile), { mode: 0o600 });
    await rename(temp, path);
    return profile;
  }
}
