'use client'

import { useEffect, useRef, useState } from 'react'
import { connectKickChat, kickParts, type KickChatMessage } from '@/lib/kick'
import { connectTwitchChat } from '@/lib/twitch'
import { connectYouTubeChat } from '@/lib/youtube'
import { renderParts, partsText, type ChatMessage } from '@/lib/chat'
import { buildEmoteMap } from '@/lib/emotes'

// Sized for OBS Browser Source default of 800x600.
const FONT_SIZES: Record<string, number> = { small: 20, medium: 26, large: 34, xlarge: 42 }
const STROKE_WIDTHS: Record<string, number> = { off: 0, thin: 1, medium: 2, thick: 3, thicker: 4 }
const SHADOWS: Record<string, string> = {
  off: 'none',
  soft: '0 1px 3px rgba(0,0,0,0.6)',
  medium: '0 2px 6px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.6)',
  heavy: '0 2px 4px rgba(0,0,0,1), 0 0 8px rgba(0,0,0,0.9), 0 0 14px rgba(0,0,0,0.7)',
}
const BOT_USERS = new Set(
  ['nightbot', 'botisimo', 'streamelements', 'streamlabs', 'wizebot', 'fossabot', 'kickbot', 'moobot', 'commanderroot'].map(s => s.toLowerCase())
)
const LOCAL_BADGES = new Set(['broadcaster', 'moderator', 'verified', 'vip', 'og', 'founder', 'sub_gifter', 'staff'])

interface SubBadge { m: number; s: string }

function readQuery(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  return Object.fromEntries(new URLSearchParams(window.location.search))
}

function decodeSubBadges(b64: string | undefined): SubBadge[] {
  if (!b64) return []
  try {
    const std = b64.replace(/-/g, '+').replace(/_/g, '/')
    const pad = std.length % 4 === 0 ? '' : '='.repeat(4 - (std.length % 4))
    const parsed = JSON.parse(atob(std + pad))
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((b: { m?: unknown; s?: unknown }) => typeof b?.m === 'number' && typeof b?.s === 'string')
      .sort((a: SubBadge, b: SubBadge) => b.m - a.m)
  } catch { return [] }
}

export default function OverlayPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [anyConnected, setAnyConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, setEmoteVersion] = useState(0) // bump to re-render once emotes load
  const emoteMap = useRef<Map<string, string>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)
  const q = typeof window !== 'undefined' ? readQuery() : {}

  // Kick can be given as a channel name or a pre-resolved chatroom id (+ sub
  // badges). Old URLs used channel/cid; new ones use kick/kcid.
  const kickChannel = (q.kick || q.channel || '').toLowerCase()
  const kickCid = Number(q.kcid || q.cid) || 0
  const kickUid = q.kuid || ''
  const twitchChannel = (q.twitch || '').toLowerCase()
  const ytChannel = q.yt || q.youtube || ''
  const subBadges = useRef<SubBadge[]>(decodeSubBadges(q.sb))

  // Merge newly-fetched channel emotes into the map, then force a re-render so
  // recent messages pick them up.
  function addEmotes(m: Map<string, string>) {
    for (const [k, v] of m) emoteMap.current.set(k, v)
    setEmoteVersion(v => v + 1)
  }

  const fontSize = FONT_SIZES[q.size || 'medium'] ?? 26
  const strokeWidth = STROKE_WIDTHS[q.stroke || 'off'] ?? 0
  const textShadow = SHADOWS[q.shadow || 'off'] ?? 'none'
  const animate = q.animate !== '0'
  const showBadges = q.badges !== '0'
  const showPlatform = q.pi !== '0'
  const hideCommands = q.commands === '1' || q.commands === 'hide'
  const hideBots = q.bots === '1' || q.bots === 'hide'
  const fade = q.fade === '1'
  const fadeSeconds = Math.max(2, Math.min(120, Number(q.delay) || 10))
  const maxMessages = Math.max(5, Math.min(200, Number(q.max) || 60))

  function resolveKickBadge(type: string, count?: number): string | null {
    if (type === 'subscriber') {
      const m = count ?? 0
      return subBadges.current.find(b => m >= b.m)?.s ?? null
    }
    if (LOCAL_BADGES.has(type)) return `/badges/${type}.svg`
    return null
  }

  useEffect(() => {
    if (!kickChannel && !kickCid && !twitchChannel && !ytChannel) {
      setError('Add at least one channel (kick / twitch / youtube) to the URL.')
      return
    }
    let cancelled = false
    const stops: Array<() => void> = []

    const push = (m: Omit<ChatMessage, '_ts'>) => {
      const uname = (m.username || '').toLowerCase()
      const text = partsText(m.parts)
      if (hideCommands && text.startsWith('!')) return
      if (hideBots && BOT_USERS.has(uname)) return
      setMessages(prev => {
        const next = [...prev, { ...m, _ts: Date.now() }]
        return next.length > maxMessages ? next.slice(next.length - maxMessages) : next
      })
    }
    const onStatus = (s: string) => {
      if (s === 'connected') { if (!cancelled) setAnyConnected(true) }
    }

    // ── Third-party emotes (7TV / BTTV / FFZ) ──
    buildEmoteMap({}).then(m => { if (!cancelled) addEmotes(m) }) // 7TV global
    if (kickUid) buildEmoteMap({ kickId: kickUid }).then(m => { if (!cancelled) addEmotes(m) })
    if (/^UC[A-Za-z0-9_-]{20,}$/.test(ytChannel)) buildEmoteMap({ youtubeId: ytChannel }).then(m => { if (!cancelled) addEmotes(m) })

    async function startKick() {
      let cid = kickCid
      if (!cid && kickChannel) {
        try {
          const r = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(kickChannel)}`, { headers: { Accept: 'application/json' } })
          if (r.ok) {
            const data = await r.json()
            cid = data?.chatroom?.id || 0
            const uid = data?.user_id || data?.user?.id
            if (uid) buildEmoteMap({ kickId: String(uid) }).then(m => { if (!cancelled) addEmotes(m) })
            type RawSubBadge = { months?: number; badge_image?: { src?: string } }
            subBadges.current = (data?.subscriber_badges ?? [])
              .map((b: RawSubBadge) => ({ m: b.months ?? 0, s: b.badge_image?.src ?? '' }))
              .filter((b: SubBadge) => b.s)
              .sort((a: SubBadge, b: SubBadge) => b.m - a.m)
          }
        } catch {}
      }
      if (cancelled || !cid) return
      const stop = connectKickChat(cid, (m: KickChatMessage) => {
        const badges = showBadges
          ? (m.sender.identity?.badges ?? []).map(b => resolveKickBadge(b.type, b.count)).filter((s): s is string => !!s)
          : []
        push({
          id: `k-${m.id}`,
          platform: 'kick',
          username: m.sender.username,
          color: m.sender.identity?.color || '#a3a3a3',
          parts: kickParts(m.content),
          badges,
        })
      }, onStatus)
      stops.push(stop)
    }

    if (kickChannel || kickCid) startKick()
    if (twitchChannel) stops.push(connectTwitchChat(
      twitchChannel,
      m => push({ ...m, badges: showBadges ? m.badges : [] }),
      onStatus,
      roomId => buildEmoteMap({ twitchId: roomId }).then(m => { if (!cancelled) addEmotes(m) }),
    ))
    if (ytChannel) stops.push(connectYouTubeChat(ytChannel, m => push({ ...m, badges: showBadges ? m.badges : [] }), onStatus))

    return () => { cancelled = true; for (const s of stops) s() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!fade) return
    const t = setInterval(() => {
      const cutoff = Date.now() - fadeSeconds * 1000
      setMessages(prev => prev.filter(m => m._ts >= cutoff))
    }, 1000)
    return () => clearInterval(t)
  }, [fade, fadeSeconds])

  // Pin scroll to the bottom after layout settles (double rAF avoids a flash).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const pin = () => { el.scrollTop = el.scrollHeight }
    const id1 = requestAnimationFrame(() => { pin(); requestAnimationFrame(pin) })
    return () => cancelAnimationFrame(id1)
  }, [messages])

  // Re-pin once emote/emoji images finish loading (they change line height).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: Event) => { if ((e.target as HTMLElement)?.tagName === 'IMG') el.scrollTop = el.scrollHeight }
    el.addEventListener('load', handler, true)
    return () => el.removeEventListener('load', handler, true)
  }, [])

  const platformsLabel = [kickChannel && 'Kick', twitchChannel && 'Twitch', ytChannel && 'YouTube'].filter(Boolean).join(' + ')

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed', inset: 0, padding: '12px',
        overflowY: 'auto', overflowX: 'hidden',
        background: 'transparent', color: '#ffffff',
        fontFamily: 'var(--font-open-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
        fontWeight: 800, fontSize: `${fontSize}px`, lineHeight: 1.35, wordWrap: 'break-word',
        WebkitTextStroke: strokeWidth ? `${strokeWidth}px #000` : undefined,
        textShadow, scrollbarWidth: 'none', overflowAnchor: 'none',
      }}
    >
      <style>{`
        .kc-msg { padding: 4px 0; }
        .kc-msg.anim { animation: kcIn .22s ease-out both; }
        @keyframes kcIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        .kc-name { font-weight: 800; }
        .kc-plat { display: inline-block; height: 1.05em; width: auto; vertical-align: -0.16em; margin-right: 5px; -webkit-text-stroke: 0 !important; text-shadow: none !important; outline: none; border: 0; }
        .kc-plat-youtube { height: 0.86em; vertical-align: -0.08em; }
        .kc-emote { display: inline-block; height: 1.6em; vertical-align: middle; margin: -2px 1px; -webkit-text-stroke: 0 !important; text-shadow: none !important; outline: none; border: 0; }
        .kc-twemoji { display: inline-block; height: 1.15em; width: 1.15em; vertical-align: -0.18em; margin: 0 1px; -webkit-text-stroke: 0 !important; text-shadow: none !important; outline: none; border: 0; }
        .kc-badge-img { display: inline-block; width: 1.15em; height: 1.15em; vertical-align: -0.18em; margin-right: 4px; border-radius: 3px; -webkit-text-stroke: 0 !important; text-shadow: none !important; outline: none; border: 0; }
        ::-webkit-scrollbar { display: none; }
      `}</style>

      {error && (
        <div style={{ opacity: 0.7, fontSize: '13px', WebkitTextStroke: 0, textShadow: 'none' }}>⚠ {error}</div>
      )}
      {!error && !anyConnected && messages.length === 0 && (
        <div style={{ opacity: 0.4, fontSize: '13px', WebkitTextStroke: 0, textShadow: 'none' }}>
          Connecting{platformsLabel ? ` to ${platformsLabel}` : ''}…
        </div>
      )}

      {messages.map(m => (
        <div key={m.id} className={`kc-msg ${animate ? 'anim' : ''}`}>
          {showPlatform && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={`kc-plat kc-plat-${m.platform}`} src={`/platforms/${m.platform}.png`} alt={m.platform} title={m.platform} />
          )}
          {m.badges.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} className="kc-badge-img" src={src} alt="" />
          ))}
          <span className="kc-name" style={{ color: m.color }}>{m.username}</span>
          <span style={{ opacity: 0.7, margin: '0 4px' }}>:</span>
          <span dangerouslySetInnerHTML={{ __html: renderParts(m.parts, emoteMap.current) }} />
        </div>
      ))}
    </div>
  )
}
