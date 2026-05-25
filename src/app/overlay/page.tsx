'use client'

import { useEffect, useRef, useState } from 'react'
import { connectKickChat, renderKickMessageHTML, type KickChatMessage } from '@/lib/kick'

type Msg = KickChatMessage & { _ts: number }

const FONTS: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  inter: '"Inter", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  rounded: '"SF Pro Rounded", "Nunito", system-ui, sans-serif',
  display: '"Bebas Neue", Impact, system-ui, sans-serif',
}

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
  const font = FONTS[q.font || 'system'] || FONTS.system
  const fontSize = Math.max(10, Math.min(48, Number(q.size) || 16))
  const textColor = q.color || '#ffffff'
  const bgMode = q.bg || 'transparent' // transparent | dark | light | custom
  const customBg = q.bgcolor || ''
  const showBadges = q.badges !== '0'
  const showTimestamps = q.timestamps === '1'
  const animation = q.anim || 'slide' // slide | fade | none
  const maxMessages = Math.max(5, Math.min(200, Number(q.max) || 40))
  const stroke = q.stroke === '1'

  // Compute container background
  const bgColor =
    bgMode === 'dark' ? 'rgba(15,15,17,0.85)' :
    bgMode === 'light' ? 'rgba(255,255,255,0.85)' :
    bgMode === 'custom' && customBg ? customBg :
    'transparent'

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
        const r = await fetch(`/api/kick/channel/${encodeURIComponent(channel)}`)
        const data = await r.json()
        if (!r.ok || !data.chatroom_id) {
          if (!cancelled) {
            setStatus('error')
            setError(data?.error || 'Channel not found')
          }
          return
        }
        if (cancelled) return
        setStatus('connecting')
        stop = connectKickChat(
          data.chatroom_id,
          (m) => {
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
  }, [channel, maxMessages])

  // Auto-scroll to bottom on new message
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
        background: bgColor,
        color: textColor,
        fontFamily: font,
        fontSize: `${fontSize}px`,
        lineHeight: 1.35,
        wordWrap: 'break-word',
        textShadow: stroke ? '0 0 2px #000, 0 0 2px #000, 0 0 2px #000, 0 0 2px #000' : 'none',
        // Hide scrollbar — OBS doesn't need it
        scrollbarWidth: 'none',
      }}
    >
      <style>{`
        .kc-msg { padding: 4px 0; }
        .kc-msg.anim-slide { animation: kcSlideIn .25s ease-out; }
        .kc-msg.anim-fade  { animation: kcFadeIn .25s ease-out; }
        @keyframes kcSlideIn { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: none; } }
        @keyframes kcFadeIn  { from { opacity: 0; } to { opacity: 1; } }
        .kc-name { font-weight: 800; }
        .kc-emote { display: inline-block; height: 1.6em; vertical-align: middle; margin: -2px 1px; }
        .kc-badge { display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; height: 1.1em; line-height: 1.1em; font-size: 0.65em; font-weight: 800; border-radius: 4px; margin-right: 4px; vertical-align: middle; text-transform: uppercase; letter-spacing: 0.04em; }
        .kc-time { opacity: 0.55; font-size: 0.75em; margin-right: 6px; font-variant-numeric: tabular-nums; }
        ::-webkit-scrollbar { display: none; }
      `}</style>

      {status === 'error' && (
        <div style={{ opacity: 0.7, fontSize: '13px' }}>⚠ {error}</div>
      )}
      {(status === 'looking-up' || status === 'connecting') && messages.length === 0 && (
        <div style={{ opacity: 0.4, fontSize: '13px' }}>Connecting to #{channel}…</div>
      )}

      {messages.map(m => {
        const userColor = m.sender.identity?.color || '#a3a3a3'
        const badges = (m.sender.identity?.badges ?? []).filter(b => showBadges)
        const time = new Date(m.created_at || m._ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        return (
          <div
            key={m.id}
            className={`kc-msg ${animation !== 'none' ? `anim-${animation}` : ''}`}
          >
            {showTimestamps && <span className="kc-time">{time}</span>}
            {badges.map((b, i) => (
              <span key={`${b.type}-${i}`}
                className="kc-badge"
                style={{ background: badgeBg(b.type), color: badgeFg(b.type) }}
                title={b.text || b.type}
              >
                {badgeLabel(b)}
              </span>
            ))}
            <span className="kc-name" style={{ color: userColor }}>{m.sender.username}</span>
            <span style={{ color: textColor, opacity: 0.7, margin: '0 4px' }}>:</span>
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
function badgeFg(_type: string): string { return '#fff' }
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
