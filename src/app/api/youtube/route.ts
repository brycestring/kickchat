import { NextRequest, NextResponse } from 'next/server'
import { localBadgeSrc, type MsgPart } from '@/lib/chat'

// Server-side YouTube live-chat connector (scrape mode). We resolve the current
// live video by scraping the channel's /live page, bootstrap a chat session from
// the live_chat page (INNERTUBE key + continuation token), then poll youtubei
// get_live_chat for deltas. The browser can't do this (CORS), so the overlay
// polls this route.
//
// We deliberately do NOT use the YouTube Data API (liveChatMessages.list): as of
// recent YouTube changes it returns an empty-body 404 for plain-API-key requests
// from datacenter IPs (verified on Railway). The scrape path, by contrast, works
// once the consent wall is bypassed — see the cookie in fetchLive below.

export const dynamic = 'force-dynamic'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
// Consent cookie + forced US/English locale. Datacenter IPs (e.g. Railway) get a
// consent/cookie wall by default, which strips ytInitialData/videoId and blocks
// the innertube poll — this makes YouTube serve the real page. (yt-dlp's trick.)
const YT_COOKIE = 'SOCS=CAI; CONSENT=YES+cb'

type OutMsg = { id: string; username: string; color: string; parts: MsgPart[]; badges: string[] }
type Session = { key: string; clientVersion: string; continuation: string; videoId: string; updatedAt: number; pending: OutMsg[] }
const sessions = new Map<string, Session>()

// Parse a YouTube live-chat action array (same item shape whether it comes
// from the page's initial ytInitialData or a get_live_chat poll response).
function messagesFromActions(actions: unknown[]): OutMsg[] {
  const messages: OutMsg[] = []
  for (const a of actions) {
    const item = (a as { addChatItemAction?: { item?: Record<string, unknown> } })?.addChatItemAction?.item
    const r = item?.liveChatTextMessageRenderer as Record<string, unknown> | undefined
    if (!r) continue
    const id = String(r.id ?? '')
    const username = ((r.authorName as { simpleText?: string })?.simpleText) ?? ''
    const badges: string[] = []
    for (const b of (r.authorBadges as unknown[]) ?? []) {
      const bd = ((b as { liveChatAuthorBadgeRenderer?: { tooltip?: string; icon?: { iconType?: string } } })?.liveChatAuthorBadgeRenderer)
      const role = (bd?.icon?.iconType || bd?.tooltip || '').toLowerCase()
      const src = role.includes('owner') ? localBadgeSrc('owner')
        : role.includes('moderator') ? localBadgeSrc('moderator')
        : role.includes('verified') ? localBadgeSrc('verified')
        : null
      if (src && !badges.includes(src)) badges.push(src)
    }
    const roleKeys = badges.map(s => s.includes('broadcaster') ? 'broadcaster' : s.includes('moderator') ? 'moderator' : '')
    if (id && username) messages.push({ id, username, color: ytColor(roleKeys), parts: runsToParts((r.message as { runs?: unknown })?.runs), badges })
  }
  return messages
}

function channelLiveUrl(channel: string): string {
  const c = channel.trim().replace(/^@/, '')
  if (/^UC[A-Za-z0-9_-]{20,}$/.test(c)) return `https://www.youtube.com/channel/${c}/live?hl=en&gl=US`
  return `https://www.youtube.com/@${encodeURIComponent(c)}/live?hl=en&gl=US`
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', 'Cookie': YT_COOKIE },
    })
    if (!r.ok) return null
    return await r.text()
  } catch { return null }
}

// Pull the first balanced JSON object that follows a marker like
// `ytInitialData = ` out of a page's HTML.
function extractJsonAfter(html: string, marker: RegExp): unknown | null {
  const m = html.match(marker)
  if (!m) return null
  const start = html.indexOf('{', m.index! + m[0].length - 1)
  if (start === -1) return null
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < html.length; i++) {
    const ch = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, i + 1)) } catch { return null } } }
  }
  return null
}

function deepFindContinuation(obj: unknown): string | null {
  // Find the first continuation token inside a liveChatContinuation-style tree.
  let found: string | null = null
  const walk = (o: unknown) => {
    if (found || !o || typeof o !== 'object') return
    const rec = o as Record<string, unknown>
    for (const k of ['invalidationContinuationData', 'timedContinuationData', 'reloadContinuationData']) {
      const c = rec[k] as { continuation?: string } | undefined
      if (c?.continuation) { found = c.continuation; return }
    }
    for (const v of Object.values(rec)) walk(v)
  }
  walk(obj)
  return found
}

// Resolve the channel's current live video id by scraping its /live page.
// Returns null on fetch failure, '' when the channel isn't live, else the id.
async function resolveVideoId(channel: string): Promise<string | null> {
  const liveHtml = await fetchText(channelLiveUrl(channel))
  if (!liveHtml) return null
  // Prefer the page's canonical watch URL: on a /live page this is the channel's
  // OWN live video. The first raw "videoId" match is unreliable — it can be a
  // recommended/other live stream elsewhere on the page, which is how we ended
  // up showing someone else's chat. When the channel isn't live, canonical is a
  // channel/@handle URL (no video id) → treat as not-live.
  const canonical = liveHtml.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)?.[1]
  if (canonical) return canonical
  if (/<link rel="canonical" href="https:\/\/www\.youtube\.com\/(?:channel|@)/.test(liveHtml)) return ''
  // No usable canonical (rare) — fall back to the first embedded id.
  return liveHtml.match(/"videoId":"([\w-]{11})"/)?.[1] ?? ''
}

async function bootstrapScrape(videoId: string): Promise<Session | { notLive: true }> {
  const chatHtml = await fetchText(`https://www.youtube.com/live_chat?is_popout=1&hl=en&gl=US&v=${videoId}`)
  if (!chatHtml) return { notLive: true }
  const key = chatHtml.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1]
  const clientVersion = chatHtml.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1]
    || chatHtml.match(/"clientVersion":"([\d.]+)"/)?.[1]
  const initial = extractJsonAfter(chatHtml, /window\["ytInitialData"\]\s*=\s*/) || extractJsonAfter(chatHtml, /ytInitialData\s*=\s*/)
  const continuation = deepFindContinuation(initial)
  if (!key || !clientVersion || !continuation) return { notLive: true }
  // Seed with the recent messages already embedded in the page so the overlay
  // shows live chat immediately on the first poll.
  const pageActions = (initial as { contents?: { liveChatRenderer?: { actions?: unknown[] } } })?.contents?.liveChatRenderer?.actions ?? []
  return { key, clientVersion, continuation, videoId, updatedAt: Date.now(), pending: messagesFromActions(pageActions).slice(-30) }
}

function runsToParts(runs: unknown): MsgPart[] {
  if (!Array.isArray(runs)) return []
  const out: MsgPart[] = []
  for (const run of runs as Array<Record<string, unknown>>) {
    if (typeof run.text === 'string') out.push({ t: 'text', v: run.text })
    else if (run.emoji) {
      const emoji = run.emoji as { image?: { thumbnails?: { url: string }[] }; isCustomEmoji?: boolean; shortcuts?: string[] }
      const url = emoji.image?.thumbnails?.slice(-1)[0]?.url
      const alt = (emoji.shortcuts?.[0] || '').replace(/"/g, '')
      if (url) out.push({ t: 'img', v: `<img class="${emoji.isCustomEmoji ? 'kc-emote' : 'kc-twemoji'}" src="${url}" alt="${alt}" title="${alt}" />` })
    }
  }
  return out
}

function ytColor(badges: string[]): string {
  if (badges.includes('broadcaster')) return '#ffd93d'
  if (badges.includes('moderator')) return '#5f84f1'
  return '#cfcfcf'
}

function parseActions(json: unknown): { messages: OutMsg[]; continuation: string | null; timeoutMs: number } {
  const root = (json as { continuationContents?: { liveChatContinuation?: Record<string, unknown> } })?.continuationContents?.liveChatContinuation
  const messages = messagesFromActions((root?.actions as unknown[]) ?? [])
  const conts = (root?.continuations as unknown[]) ?? []
  let continuation: string | null = null
  let timeoutMs = 2500
  for (const c of conts) {
    const cd = (c as Record<string, { continuation?: string; timeoutMs?: number }>)
    const inner = cd.invalidationContinuationData || cd.timedContinuationData || cd.reloadContinuationData
    if (inner?.continuation) { continuation = inner.continuation; if (inner.timeoutMs) timeoutMs = inner.timeoutMs; break }
  }
  return { messages, continuation, timeoutMs }
}

export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get('channel')?.trim()
  if (!channel) return NextResponse.json({ error: 'channel required' }, { status: 400 })

  // Temporary diagnostics: show which build is running + what videoId resolves.
  if (req.nextUrl.searchParams.get('debug') === '1' && channel) {
    const liveHtml = await fetchText(channelLiveUrl(channel))
    const canonical = liveHtml?.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)?.[1] ?? null
    const canonicalRaw = liveHtml?.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? null
    const firstRaw = liveHtml?.match(/"videoId":"([\w-]{11})"/)?.[1] ?? null
    const resolved = await resolveVideoId(channel)
    const sess = sessions.get(channel)
    return NextResponse.json({ build: 'canonical-v2', resolved, canonical, canonicalRaw, firstRaw, sessionVideoId: sess?.videoId ?? null })
  }

  // Force re-resolution / clear a stale session with ?reset=1.
  if (req.nextUrl.searchParams.get('reset') === '1') { sessions.delete(channel) }

  let s = sessions.get(channel)
  if (!s) {
    const videoId = await resolveVideoId(channel)
    if (videoId === null) return NextResponse.json({ live: false, error: 'fetch_failed' })
    if (!videoId) return NextResponse.json({ live: false })
    const boot = await bootstrapScrape(videoId)
    if ('notLive' in boot) return NextResponse.json({ live: false })
    s = boot
    sessions.set(channel, s)
  }

  // Serve the seeded backlog first so chat appears immediately.
  if (s.pending.length) {
    const messages = s.pending
    s.pending = []
    return NextResponse.json({ live: true, messages, pollMs: 2000 })
  }
  try {
    const r = await fetch(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${s.key}&prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Cookie': YT_COOKIE },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: s.clientVersion } }, continuation: s.continuation }),
    })
    if (!r.ok) { sessions.delete(channel); return NextResponse.json({ live: false, error: `poll_${r.status}` }) }
    const json = await r.json()
    const { messages, continuation, timeoutMs } = parseActions(json)
    if (continuation) { s.continuation = continuation; s.updatedAt = Date.now() }
    else sessions.delete(channel)
    // Respect YouTube's timeoutMs. This continuation is a long-poll (typically
    // ~10s); polling faster just resets it and perpetually returns 0 messages,
    // so we must NOT cap below the server's suggested interval.
    return NextResponse.json({ live: true, messages, pollMs: Math.max(2000, Math.min(10000, timeoutMs)) })
  } catch (e) {
    sessions.delete(channel)
    return NextResponse.json({ live: false, error: e instanceof Error ? e.message : 'poll_error' })
  }
}
