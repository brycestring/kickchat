'use client'

import { useEffect, useRef, useState } from 'react'
import { connectKickChat, renderKickMessageHTML, type KickChatMessage } from '@/lib/kick'

type Msg = KickChatMessage & { _ts: number }

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
  ['nightbot', 'botisimo', 'streamelements', 'streamlabs', 'wizebot', 'fossabot', 'kickbot'].map(s => s.toLowerCase())
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
    const json = atob(std + pad)
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((b: { m?: unknown; s?: unknown }) => typeof b?.m === 'number' && typeof b?.s === 'string')
      .sort((a: SubBadge, b: SubBadge) => b.m - a.m)
  } catch { return [] }
}

export default function OverlayPage() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [status, setStatus] = useState<'init' | 'looking-up' | 'connecting' | 'connected' | 'error'>('init')
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const q = typeof window !== 'undefined' ? readQuery() : {}

  const channel = q.channel?.toLowerCase() || ''
  const chatroomIdFromUrl = Number(q.cid) || 0
  const subBadges = useRef<SubBadge[]>(decodeSubBadges(q.sb))

  const fontSize = FONT_SIZES[q.size || 'medium'] ?? 26
  const strokeWidth = STROKE_WIDTHS[q.stroke || 'off'] ?? 0
  const textShadow = SHADOWS[q.shadow || 'off'] ?? 'none'
  const animate = q.animate !== '0'
  const showBadges = q.badges !== '0'
  const hideCommands = q.commands === '1' || q.commands === 'hide'
  const hideBots = q.bots === '1' || q.bots === 'hide'
  const fade = q.fade === '1'
  const fadeSeconds = Math.max(2, Math.min(120, Number(q.delay) || 10))
  const maxMessages = Math.max(5, Math.min(200, Number(q.max) || 60))

  useEffect(() => {
    if (!chatroomIdFromUrl && !channel) {
      setStatus('error')
      setError('Missing channel or chatroom id in URL.')
      return
    }
    let cancelled = false
    let stop: (() => void) | null = null

    async function start() {
      let chatroomId = chatroomIdFromUrl

      // Primary path: chatroom_id is already in the URL — no Kick API call needed.
      // This is the path used when the overlay URL came from the settings page,
      // which is critical for OBS where Kick blocks API access (no Cloudflare
      // cookies in the OBS browser).
      if (!chatroomId) {
        setStatus('looking-up')
        try {
          const r = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`, {
            headers: { 'Accept': 'application/json' },
          })
          if (!r.ok) {
            if (!cancelled) {
              setStatus('error')
              setError(r.status === 404 ? 'Channel not found' : `Kick API ${r.status} — regenerate the overlay URL from the settings page`)
            }
            return
          }
          const data = await r.json()
          if (!data?.chatroom?.id) {
            if (!cancelled) { setStatus('error'); setError('No chatroom for channel') }
            return
          }
          chatroomId = data.chatroom.id
          type RawSubBadge = { months?: number; badge_image?: { src?: string } }
          subBadges.current = (data?.subscriber_badges ?? [])
            .map((b: RawSubBadge) => ({ m: b.months ?? 0, s: b.badge_image?.src ?? '' }))
            .filter((b: SubBadge) => b.s)
            .sort((a: SubBadge, b: SubBadge) => b.m - a.m)
        } catch (err) {
          if (!cancelled) {
            setStatus('error')
            setError(err instanceof Error ? err.message : 'Lookup failed')
          }
          return
        }
      }

      if (cancelled) return
      setStatus('connecting')
      stop = connectKickChat(
        chatroomId,
        (m) => {
          const text = (m.content ?? '').trim()
          if (hideCommands && text.startsWith('!')) return
          if (hideBots && BOT_USERS.has(m.sender.username.toLowerCase())) return
          setMessages(prev => {
            const next = [...prev, { ...m, _ts: Date.now() }]
            return next.length > maxMessages ? next.slice(next.length - maxMessages) : next
          })
        },
        (s) => {
          if (s === 'connected') setStatus('connected')
          else if (s === 'error') { setStatus('error'); setError('WebSocket error') }
        }
      )
    }

    start()
    return () => { cancelled = true; if (stop) stop() }
  }, [channel, chatroomIdFromUrl, maxMessages, hideCommands, hideBots])

  useEffect(() => {
    if (!fade) return
    const t = setInterval(() => {
      const cutoff = Date.now() - fadeSeconds * 1000
      setMessages(prev => prev.filter(m => m._ts >= cutoff))
    }, 1000)
    return () => clearInterval(t)
  }, [fade, fadeSeconds])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  function resolveBadgeSrc(type: string, count?: number): string | null {
    if (type === 'subscriber') {
      const m = count ?? 0
      const match = subBadges.current.find(b => m >= b.m)
      return match?.s ?? null
    }
    if (LOCAL_BADGES.has(type)) return `/badges/${type}.svg`
    return null
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        padding: '12px',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: 'transparent',
        color: '#ffffff',
        fontFamily: 'var(--font-open-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
        fontWeight: 800,
        fontSize: `${fontSize}px`,
        lineHeight: 1.35,
        wordWrap: 'break-word',
        WebkitTextStroke: strokeWidth ? `${strokeWidth}px #000` : undefined,
        textShadow,
        scrollbarWidth: 'none',
      }}
    >
      <style>{`
        .kc-msg { padding: 4px 0; }
        .kc-msg.anim { animation: kcIn .25s ease-out; }
        @keyframes kcIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
        .kc-name { font-weight: 800; }
        .kc-emote { display: inline-block; height: 1.6em; vertical-align: middle; margin: -2px 1px; -webkit-text-stroke: 0; text-shadow: none; }
        .kc-badge-img { display: inline-block; width: 1.15em; height: 1.15em; vertical-align: -0.18em; margin-right: 4px; border-radius: 3px; -webkit-text-stroke: 0; text-shadow: none; }
        ::-webkit-scrollbar { display: none; }
      `}</style>

      {status === 'error' && (
        <div style={{ opacity: 0.7, fontSize: '13px', WebkitTextStroke: 0, textShadow: 'none' }}>⚠ {error}</div>
      )}
      {status !== 'error' && status !== 'connected' && messages.length === 0 && (
        <div style={{ opacity: 0.4, fontSize: '13px', WebkitTextStroke: 0, textShadow: 'none' }}>
          Connecting{channel ? ` to #${channel}` : ''}…
        </div>
      )}
      {status === 'connected' && messages.length === 0 && (
        <div style={{ opacity: 0.4, fontSize: '13px', WebkitTextStroke: 0, textShadow: 'none' }}>
          Connected{channel ? ` to #${channel}` : ''} — waiting for messages…
        </div>
      )}

      {messages.map(m => {
        const userColor = m.sender.identity?.color || '#a3a3a3'
        const badges = showBadges ? (m.sender.identity?.badges ?? []) : []
        return (
          <div key={m.id} className={`kc-msg ${animate ? 'anim' : ''}`}>
            {badges.map((b, i) => {
              const src = resolveBadgeSrc(b.type, b.count)
              if (!src) return null
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={`${b.type}-${i}`} className="kc-badge-img" src={src} alt={b.type} title={b.text || b.type} />
              )
            })}
            <span className="kc-name" style={{ color: userColor }}>{m.sender.username}</span>
            <span style={{ opacity: 0.7, margin: '0 4px' }}>:</span>
            <span dangerouslySetInnerHTML={{ __html: renderKickMessageHTML(m.content) }} />
          </div>
        )
      })}
    </div>
  )
}
