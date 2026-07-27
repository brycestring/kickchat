// Shared types + render helpers for the multi-platform chat overlay.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import twemoji from '@twemoji/api'

export type Platform = 'kick' | 'twitch' | 'youtube'

// A normalized chat message every connector produces. `html` is already-safe
// rendered content (emotes + emoji handled, plain text escaped). `badges` are
// resolved image srcs (local /badges/*.svg or platform CDN urls).
export interface ChatMessage {
  id: string
  platform: Platform
  username: string
  color: string
  html: string
  badges: string[]
  _ts: number
}

export const PLATFORM_LABEL: Record<Platform, string> = { kick: 'Kick', twitch: 'Twitch', youtube: 'YouTube' }

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Swap unicode emojis in an already-escaped string for color Twemoji <img>s.
export function twemojify(escaped: string): string {
  return twemoji.parse(escaped, {
    folder: '72x72',
    ext: '.png',
    className: 'kc-twemoji',
  } as Parameters<typeof twemoji.parse>[1])
}

// Map a platform's role badges to our local generic badge SVGs so the visual
// language is consistent across Kick / Twitch / YouTube.
const LOCAL_BADGE_MAP: Record<string, string> = {
  broadcaster: 'broadcaster', owner: 'broadcaster',
  moderator: 'moderator', mod: 'moderator',
  vip: 'vip',
  founder: 'founder',
  staff: 'staff', admin: 'staff',
  partner: 'verified', verified: 'verified',
}
export function localBadgeSrc(role: string): string | null {
  const key = LOCAL_BADGE_MAP[role.toLowerCase()]
  return key ? `/badges/${key}.svg` : null
}
