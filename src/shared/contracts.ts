/** Contracts shared by the browser and server. Third-party optional fields stay optional. */
export interface ChatMessage { tags: Record<string, string>; user: string; text: string }
export interface Badge { url: string; title: string }
export interface BadgeSet { set_id: string; versions?: { id: string; image_url_2x?: string; image_url_1x: string; title?: string }[] }
export interface EmoteHost { url: string; files?: { name: string }[] }
export interface EmoteSet { emote_set?: EmoteSet; emotes?: { name: string; data?: { host?: EmoteHost }; host?: EmoteHost }[] }
export interface Paint {
  id: string; function?: string; color?: number; angle?: number; shape?: string;
  image_url?: string; repeat?: boolean; stops?: { at: number; color: number }[];
  shadows?: { x_offset: number; y_offset: number; radius: number; color: number }[];
}
export interface CosmeticBadge { id: string; url?: string; name?: string; tooltip?: string }
export interface Cosmetics { color: number | null; badge: CosmeticBadge | null; paint: Paint | null }
export interface TwitchChannel { id: string; login: string; display_name: string }
export interface HelixResponse<T> { data: T[] }
export interface HealthResponse { ok: true; service: 'Chatiffy'; twitchConfigured: boolean; uptimeSeconds: number }
export interface ApiError { error: string }
