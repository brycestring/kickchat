// Shared types + render helpers for the multi-platform chat overlay.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import twemoji from '@twemoji/api'

export type Platform = 'kick' | 'twitch' | 'youtube'

// A message is a list of parts: raw text (which may contain word-emotes like
// 7TV/BTTV/FFZ that we resolve at render time against the channel's emote map)
// and pre-built image HTML (native platform emotes we already resolved).
export type MsgPart = { t: 'text'; v: string } | { t: 'img'; v: string }

export interface ChatMessage {
  id: string
  platform: Platform
  username: string
  color: string
  badges: string[]
  parts: MsgPart[]
  _ts: number
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function twemojify(escaped: string): string {
  return twemoji.parse(escaped, {
    folder: '72x72',
    ext: '.png',
    className: 'kc-twemoji',
  } as Parameters<typeof twemoji.parse>[1])
}

// Render a raw text chunk: match whole words against the third-party emote map
// (7TV / BTTV / FFZ), else escape + twemoji for unicode emoji.
export function renderTextWithEmotes(text: string, emoteMap?: Map<string, string>): string {
  let out = ''
  for (const tok of text.split(/(\s+)/)) {
    if (tok === '') continue
    if (/^\s+$/.test(tok)) { out += tok; continue }
    const url = emoteMap?.get(tok)
    if (url) out += `<img class="kc-emote" src="${url}" alt="${escapeHtml(tok)}" title="${escapeHtml(tok)}" />`
    else out += twemojify(escapeHtml(tok))
  }
  return out
}

export function renderParts(parts: MsgPart[], emoteMap?: Map<string, string>): string {
  let out = ''
  for (const p of parts) out += p.t === 'img' ? p.v : renderTextWithEmotes(p.v, emoteMap)
  return out
}

export function partsText(parts: MsgPart[]): string {
  return parts.map(p => (p.t === 'text' ? p.v : '')).join('').trim()
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
