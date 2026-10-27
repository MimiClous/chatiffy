import type { EmoteSet } from '../shared/contracts.js';
export type Fetcher = (url: string, options?: RequestInit, timeoutMs?: number) => Promise<Response>;
export interface EmoteContext { twitchId: string; fetch: Fetcher }
export interface EmoteProvider { id: string; load(context: EmoteContext): Promise<ReadonlyMap<string, string>> }
/** Providers fail independently. Later registered providers win name collisions. */
export class EmoteRegistry {
  private readonly providers = new Map<string, EmoteProvider>();
  register(provider: EmoteProvider): this {
    if (this.providers.has(provider.id)) throw new Error(`Duplicate emote provider: ${provider.id}`);
    this.providers.set(provider.id, provider);
    return this;
  }
  async load(context: EmoteContext): Promise<Map<string, string>> {
    const results = await Promise.allSettled([...this.providers.values()].map(p => Promise.resolve().then(() => p.load(context))));
    const emotes = new Map<string, string>();
    for (const result of results) if (result.status === 'fulfilled') {
      for (const [name, url] of result.value) {
        // Never pass script/data URLs from extensions to the renderer.
        if (/^https:\/\//i.test(url)) emotes.set(name, url);
      }
    }
    return emotes;
  }
}
export function parse7tvSet(data: EmoteSet): Map<string, string> {
  const emotes = new Map<string, string>();
  for (const item of data?.emote_set?.emotes || data?.emotes || []) {
    const host = item.data?.host || item.host;
    const files = host?.files || [];
    const file = files.find(f => f.name === '2x.webp') || files.find(f => f.name === '2x.avif')
      || files.find(f => /^2x\./.test(f.name)) || files.at(-1);
    if (!host?.url || !file) continue;
    const base = host.url.startsWith('//') ? `https:${host.url}` : host.url;
    emotes.set(item.name, `${base}/${file.name}`);
  }
  return emotes;
}
export const sevenTvProvider: EmoteProvider = {
  id: '7tv',
  async load({ twitchId, fetch }) {
    const results = await Promise.allSettled([
      fetch(`https://7tv.io/v3/users/twitch/${twitchId}`), fetch('https://7tv.io/v3/emote-sets/global')
    ]);
    const emotes = new Map<string, string>();
    for (const result of results) if (result.status === 'fulfilled' && result.value.ok) {
      try {
        for (const [name, url] of parse7tvSet(await result.value.json() as EmoteSet)) emotes.set(name, url);
      } catch { /* malformed data must not discard the other set */ }
    }
    return emotes;
  }
};
