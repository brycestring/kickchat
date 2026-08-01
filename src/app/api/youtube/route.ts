import { NextRequest, NextResponse } from 'next/server'
import { localBadgeSrc, type MsgPart } from '@/lib/chat'

// Server-side YouTube live-chat connector. Two modes:
//   - API mode (preferred, reliable): when YOUTUBE_API_KEY is set. We resolve
//     the live video id by scraping the channel's /live page (cheap + free),
//     then use the Data API videos.list → activeLiveChatId → liveChatMessages
//     .list to poll — official + not throttled.
//   - Scrape mode (fallback, no key): scrape the live_chat page + poll
//     get_live_chat. Works but YouTube rate-limits datacenter IPs.
// Either way the browser can't do this (CORS), so the overlay polls this route.

export const dynamic = 'force-dynamic'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const apiKey = () => process.env.YOUTUBE_API_KEY || ''

type OutMsg = { id: string; username: string; color: string; parts: MsgPart[]; badges: string[] }
type ScrapeSession = { mode: 'scrape'; key: string; clientVersion: string; continuation: string; videoId: string; updatedAt: number; pending: OutMsg[] }
type ApiSession = { mode: 'api'; liveChatId: string; pageToken?: string; videoId: string; updatedAt: number }
type Session = ScrapeSession | ApiSession
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
    // The consent cookie + forced US/English locale make YouTube serve the real
    // page instead of a consent/cookie wall. Datacenter IPs (e.g. Railway) get
    // that wall by default, which strips ytInitialData and the videoId — so
    // without this the /live scrape silently yields no live video. (Same trick
    // yt-dlp uses.)
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'SOCS=CAI; CONSENT=YES+cb',
      },
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
// Cheap + reliable (only chat POLLING is throttled, not this).
async function resolveVideoId(channel: string): Promise<string | null> {
  const liveHtml = await fetchText(channelLiveUrl(channel))
  if (!liveHtml) return null
  return liveHtml.match(/"videoId":"([\w-]{11})"/)?.[1] ?? null
}

async function bootstrapScrape(channel: string, videoId: string): Promise<ScrapeSession | { notLive: true }> {
  const chatHtml = await fetchText(`https://www.youtube.com/live_chat?is_popout=1&hl=en&gl=US&v=${videoId}`)
  if (!chatHtml) return { notLive: true }
  const key = chatHtml.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1]
  const clientVersion = chatHtml.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1]
    || chatHtml.match(/"clientVersion":"([\d.]+)"/)?.[1]
  const initial = extractJsonAfter(chatHtml, /window\["ytInitialData"\]\s*=\s*/) || extractJsonAfter(chatHtml, /ytInitialData\s*=\s*/)
  const continuation = deepFindContinuation(initial)
  if (!key || !clientVersion || !continuation) return { notLive: true }
  // Seed with the recent messages already embedded in the page so the overlay
  // shows live chat immediately (also covers cases where the delta poll is
  // rate-limited by YouTube for datacenter IPs).
  const pageActions = (initial as { contents?: { liveChatRenderer?: { actions?: unknown[] } } })?.contents?.liveChatRenderer?.actions ?? []
  return { mode: 'scrape', key, clientVersion, continuation, videoId, updatedAt: Date.now(), pending: messagesFromActions(pageActions).slice(-30) }
}

// ── Data API mode ──────────────────────────────────────────────────────────
async function getLiveChatId(videoId: string, key: string): Promise<string | null> {
  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${key}`)
    if (!r.ok) return null
    const j = await r.json()
    return j?.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null
  } catch { return null }
}

type ApiItem = {
  id?: string
  snippet?: { type?: string; displayMessage?: string }
  authorDetails?: { displayName?: string; isChatOwner?: boolean; isChatModerator?: boolean; isChatSponsor?: boolean; isVerified?: boolean }
}
function messagesFromApiItems(items: ApiItem[]): OutMsg[] {
  const out: OutMsg[] = []
  for (const it of items) {
    const type = it.snippet?.type
    if (type !== 'textMessageEvent' && type !== 'superChatEvent') continue
    const text = it.snippet?.displayMessage ?? ''
    const a = it.authorDetails ?? {}
    const badges: string[] = []
    const roleKeys: string[] = []
    if (a.isChatOwner) { const s = localBadgeSrc('owner'); if (s) badges.push(s); roleKeys.push('broadcaster') }
    if (a.isChatModerator) { const s = localBadgeSrc('moderator'); if (s) badges.push(s); roleKeys.push('moderator') }
    if (a.isVerified) { const s = localBadgeSrc('verified'); if (s) badges.push(s) }
    if (it.id && a.displayName) out.push({ id: it.id, username: a.displayName, color: ytColor(roleKeys), parts: [{ t: 'text', v: text }], badges })
  }
  return out
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
  const key = apiKey()

  // Temporary diagnostics: ?debug=1 reports what the /live scrape actually sees
  // from this host, so we can tell a datacenter block apart from a real bug.
  if (req.nextUrl.searchParams.get('debug') === '1' && channel) {
    const html = await fetchText(channelLiveUrl(channel))
    const videoId = html?.match(/"videoId":"([\w-]{11})"/)?.[1] ?? null
    return NextResponse.json({
      hasKey: !!key,
      fetched: html !== null,
      bytes: html?.length ?? 0,
      videoId,
      isLive: html ? /"isLive":true/.test(html) : false,
      consent: html ? /consent\.youtube\.com|Before you continue/i.test(html) : false,
      title: html?.match(/<title>([^<]{0,80})/)?.[1] ?? null,
    })
  }

  let s = sessions.get(channel)
  if (!s) {
    const videoId = await resolveVideoId(channel)
    if (videoId === null) return NextResponse.json({ live: false, error: 'fetch_failed' })
    if (!videoId) return NextResponse.json({ live: false })
    if (key) {
      const liveChatId = await getLiveChatId(videoId, key)
      if (!liveChatId) return NextResponse.json({ live: false })
      s = { mode: 'api', liveChatId, videoId, updatedAt: Date.now() }
    } else {
      const boot = await bootstrapScrape(channel, videoId)
      if ('notLive' in boot) return NextResponse.json({ live: false })
      s = boot
    }
    sessions.set(channel, s)
  }

  // ── API mode ──
  if (s.mode === 'api') {
    try {
      const u = new URL('https://www.googleapis.com/youtube/v3/liveChatMessages')
      u.searchParams.set('part', 'snippet,authorDetails')
      u.searchParams.set('liveChatId', s.liveChatId)
      u.searchParams.set('key', key)
      if (s.pageToken) u.searchParams.set('pageToken', s.pageToken)
      const r = await fetch(u)
      if (!r.ok) { sessions.delete(channel); return NextResponse.json({ live: false, error: `api_${r.status}` }) }
      const j = await r.json()
      s.pageToken = j.nextPageToken
      s.updatedAt = Date.now()
      const messages = messagesFromApiItems((j.items ?? []) as ApiItem[])
      return NextResponse.json({ live: true, messages, pollMs: Math.max(1500, Math.min(8000, Number(j.pollingIntervalMillis) || 3000)) })
    } catch (e) {
      sessions.delete(channel)
      return NextResponse.json({ live: false, error: e instanceof Error ? e.message : 'api_error' })
    }
  }

  // ── Scrape mode ──
  if (s.pending.length) {
    const messages = s.pending
    s.pending = []
    return NextResponse.json({ live: true, messages, pollMs: 2000 })
  }
  try {
    const r = await fetch(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${s.key}&prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: s.clientVersion } }, continuation: s.continuation }),
    })
    if (!r.ok) { sessions.delete(channel); return NextResponse.json({ live: false, error: `poll_${r.status}` }) }
    const json = await r.json()
    const { messages, continuation, timeoutMs } = parseActions(json)
    if (continuation) { s.continuation = continuation; s.updatedAt = Date.now() }
    else sessions.delete(channel)
    return NextResponse.json({ live: true, messages, pollMs: Math.max(1200, Math.min(5000, timeoutMs)) })
  } catch (e) {
    sessions.delete(channel)
    return NextResponse.json({ live: false, error: e instanceof Error ? e.message : 'poll_error' })
  }
}
