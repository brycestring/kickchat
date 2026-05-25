'use client'

import { useEffect, useRef, useState } from 'react'
import { connectKickChat, renderKickMessageHTML, type KickChatMessage } from '@/lib/kick'

type Msg = KickChatMessage & { _ts: number }

const FONT_SIZES: Record<string, number> = { small: 14, medium: 18, large: 22, xlarge: 28 }
const STROKE_WIDTHS: Record<string, number> = { off: 0, thin: 1, medium: 2, thick: 3, thicker: 4 }
const BOT_USERS = new Set(
  ['nightbot', 'botisimo', 'streamelements', 'streamlabs', 'wizebot', 'fossabot', 'kickbot'].map(s => s.toLowerCase())
)

function readQuery(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  return Object.fromEntries(new URLSearchParams(window.location.search))
}

export default function OverlayPage() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [status, setStatus] = useState<'init' | 'looking-up' | 'connecting' | 'connected' | 'error'>('init')
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const q = typeof window !== 'undefined' ? readQuery() : {}

  const channel = q.channel?.toLowerCase() || ''
  const fontSize = FONT_SIZES[q.size || 'medium'] ?? 18
  const strokeWidth = STROKE_WIDTHS[q.stroke || 'off'] ?? 0
  const animate = q.animate !== '0'
  const showBadges = q.badges !== '0'
  const hideCommands = q.commands === '1' || q.commands === 'hide'
  const hideBots = q.bots === '1' || q.bots === 'hide'
  const fade = q.fade === '1'
  const fadeSeconds = Math.max(2, Math.min(120, Number(q.delay) || 10))
  const maxMessages = Math.max(5, Math.min(200, Number(q.max) || 60))

  useEffect(() => {
    if (!channel) {
      setStatus('error')
      setError('Add ?channel=<kick_username> to the URL.')
      return
    }
    let cancelled = false
    let stop: (() => void) | null = null
    async function start() {
      setStatus('looking-up')
      try {
        // Browser-side fetch — Kick blocks server IPs (Cloudflare).
        const r = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`, {
          headers: { 'Accept': 'application/json' },
        })
        if (!r.ok) {
          if (!cancelled) { setStatus('error'); setError(r.status === 404 ? 'Channel not found' : `Kick API ${r.status}`) }
          return
        }
        const data = await r.json()
        if (!data?.chatroom?.id) {
          if (!cancelled) { setStatus('error'); setError('No chatroom found') }
          return
        }
        if (cancelled) return
        setStatus('connecting')
        stop = connectKickChat(
          data.chatroom.id,
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
      } catch (err) {
        if (!cancelled) {
          setStatus('error')
          setError(err instanceof Error ? err.message : 'Connect failed')
        }
      }
    }
    start()
    return () => { cancelled = true; if (stop) stop() }
  }, [channel, maxMessages, hideCommands, hideBots])

  // Fade old messages off the list after fadeSeconds
  useEffect(() => {
    if (!fade) return
    const t = setInterval(() => {
      const cutoff = Date.now() - fadeSeconds * 1000
      setMessages(prev => prev.filter(m => m._ts >= cutoff))
    }, 1000)
    return () => clearInterval(t)
  }, [fade, fadeSeconds])

  // Auto-scroll
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

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
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
        fontSize: `${fontSize}px`,
        lineHeight: 1.35,
        wordWrap: 'break-word',
        WebkitTextStroke: strokeWidth ? `${strokeWidth}px #000` : undefined,
        scrollbarWidth: 'none',
      }}
    >
      <style>{`
        .kc-msg { padding: 4px 0; }
        .kc-msg.anim { animation: kcIn .25s ease-out; }
        @keyframes kcIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .kc-name { font-weight: 800; }
        .kc-emote { display: inline-block; height: 1.6em; vertical-align: middle; margin: -2px 1px; }
        .kc-badge { display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; height: 1.1em; line-height: 1.1em; font-size: 0.65em; font-weight: 800; border-radius: 4px; margin-right: 4px; vertical-align: middle; text-transform: uppercase; letter-spacing: 0.04em; -webkit-text-stroke: 0; }
        ::-webkit-scrollbar { display: none; }
      `}</style>

      {status === 'error' && (
        <div style={{ opacity: 0.7, fontSize: '13px', WebkitTextStroke: 0 }}>⚠ {error}</div>
      )}
      {(status === 'looking-up' || status === 'connecting') && messages.length === 0 && (
        <div style={{ opacity: 0.4, fontSize: '13px', WebkitTextStroke: 0 }}>Connecting to #{channel}…</div>
      )}

      {messages.map(m => {
        const userColor = m.sender.identity?.color || '#a3a3a3'
        const badges = (m.sender.identity?.badges ?? []).filter(() => showBadges)
        return (
          <div key={m.id} className={`kc-msg ${animate ? 'anim' : ''}`}>
            {badges.map((b, i) => (
              <span key={`${b.type}-${i}`}
                className="kc-badge"
                style={{ background: badgeBg(b.type), color: '#fff' }}
                title={b.text || b.type}
              >
                {badgeLabel(b)}
              </span>
            ))}
            <span className="kc-name" style={{ color: userColor }}>{m.sender.username}</span>
            <span style={{ opacity: 0.7, margin: '0 4px' }}>:</span>
            <span dangerouslySetInnerHTML={{ __html: renderKickMessageHTML(m.content) }} />
          </div>
        )
      })}
    </div>
  )
}

function badgeBg(type: string): string {
  switch (type) {
    case 'broadcaster': return '#e0245e'
    case 'moderator':   return '#0e8c4a'
    case 'verified':    return '#1d9bf0'
    case 'vip':         return '#a020f0'
    case 'og':          return '#f59e0b'
    case 'founder':     return '#f59e0b'
    case 'subscriber':  return '#5865f2'
    case 'sub_gifter':  return '#5865f2'
    case 'staff':       return '#555'
    default:            return '#555'
  }
}
function badgeLabel(b: { type: string; count?: number; text?: string }): string {
  if (b.type === 'broadcaster') return 'host'
  if (b.type === 'moderator')   return 'mod'
  if (b.type === 'verified')    return '✓'
  if (b.type === 'vip')         return 'vip'
  if (b.type === 'og')          return 'og'
  if (b.type === 'founder')     return 'founder'
  if (b.type === 'subscriber')  return b.count ? `sub ${b.count}` : 'sub'
  if (b.type === 'sub_gifter')  return 'gifter'
  if (b.type === 'staff')       return 'staff'
  return b.text || b.type
}
