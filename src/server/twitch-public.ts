import type { BadgeSet, HelixResponse, TwitchChannel } from '../shared/contracts.js';

// Public website metadata only. No viewer/bot login, cookies or user OAuth token.
// Twitch can change this website API; configured Helix remains the preferred source.
async function publicQuery<T>(query: string): Promise<T> {
  const response = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST', signal: AbortSignal.timeout(6500),
    headers: { 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  if (!response.ok) throw new Error(`Public Twitch API returned ${response.status}`);
  const result = await response.json() as { data?: T; errors?: unknown[] };
  if (!result.data || result.errors?.length) throw new Error('Public Twitch metadata unavailable');
  return result.data;
}
interface PublicBadge { setID: string; version: string; title: string; imageURL: string }
const badgeFields = 'setID version title imageURL(size: DOUBLE)';
export async function publicBadges(channelId?: string): Promise<HelixResponse<BadgeSet>> {
  if (channelId && !/^\d{1,20}$/.test(channelId)) throw new Error('Invalid channel ID');
  const result = await publicQuery<{ badges?: PublicBadge[]; user?: { broadcastBadges?: PublicBadge[] } | null }>(
    channelId ? `query { user(id: "${channelId}") { broadcastBadges { ${badgeFields} } } }`
      : `query { badges { ${badgeFields} } }`
  );
  const badges = channelId ? result.user?.broadcastBadges : result.badges;
  if (!Array.isArray(badges)) throw new Error('Twitch badge catalog unavailable');
  const sets = new Map<string, BadgeSet>();
  for (const badge of badges) {
    if (typeof badge.setID !== 'string' || typeof badge.version !== 'string'
      || !/^https:\/\/static-cdn\.jtvnw\.net\//.test(badge.imageURL || '')) continue;
    let set = sets.get(badge.setID);
    if (!set) { set = { set_id: badge.setID, versions: [] }; sets.set(badge.setID, set); }
    set.versions!.push({ id: badge.version, image_url_1x: badge.imageURL, image_url_2x: badge.imageURL, title: badge.title });
  }
  return { data: [...sets.values()] };
}
export async function publicChannel(login: string): Promise<HelixResponse<TwitchChannel>> {
  if (!/^[a-z0-9_]{1,25}$/.test(login)) throw new Error('Invalid Twitch login');
  const result = await publicQuery<{ user: { id: string; login: string; displayName: string } | null }>(
    `query { user(login: "${login}") { id login displayName } }`
  );
  return { data: result.user ? [{ id: result.user.id, login: result.user.login, display_name: result.user.displayName }] : [] };
}

export async function publicUserBadges(userId: string) {
  if (!/^\d{1,20}$/.test(userId)) throw new Error('Invalid Twitch ID');
  const result = await publicQuery<{ user: { displayBadges: PublicBadge[] } | null }>(
    `query { user(id: "${userId}") { displayBadges { ${badgeFields} } } }`
  );
  if (!result.user) throw new Error('Twitch user unavailable');
  return result.user.displayBadges.filter(b => /^https:\/\/static-cdn\.jtvnw\.net\//.test(b.imageURL))
    .map(b => ({ url: b.imageURL, title: b.title }));
}
