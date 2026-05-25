'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type Anim = 'slide' | 'fade' | 'none'
type Bg = 'transparent' | 'dark' | 'light' | 'custom'
type FontKey = 'system' | 'inter' | 'mono' | 'rounded' | 'display'

interface Settings {
  channel: string
  font: FontKey
  size: number
  color: string
  bg: Bg
  bgcolor: string
  badges: boolean
  timestamps: boolean
  stroke: boolean
  anim: Anim
  max: number
}

const DEFAULTS: Settings = {
  channel: '',
  font: 'system',
  size: 18,
  color: '#ffffff',
  bg: 'transparent',
  bgcolor: '#000000',
  badges: true,
  timestamps: false,
  stroke: true,
  anim: 'slide',
  max: 40,
}

function buildQuery(s: Settings): string {
  const p = new URLSearchParams()
  p.set('channel', s.channel.trim().toLowerCase())
  p.set('font', s.font)
  p.set('size', String(s.size))
  p.set('color', s.color)
  p.set('bg', s.bg)
  if (s.bg === 'custom') p.set('bgcolor', s.bgcolor)
  p.set('badges', s.badges ? '1' : '0')
  p.set('timestamps', s.timestamps ? '1' : '0')
  p.set('stroke', s.stroke ? '1' : '0')
  p.set('anim', s.anim)
  p.set('max', String(s.max))
  return p.toString()
}

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(DEFAULTS)
  const [origin, setOrigin] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState<null | {
    display_name: string
    avatar_url: string | null
    is_live: boolean
  }>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const previewRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
    try {
      const saved = localStorage.getItem('kc-settings')
      if (saved) setS({ ...DEFAULTS, ...JSON.parse(saved) })
    } catch {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem('kc-settings', JSON.stringify(s)) } catch {}
  }, [s])

  const overlayUrl = useMemo(() => {
    if (!origin || !s.channel.trim()) return ''
    return `${origin}/overlay?${buildQuery(s)}`
  }, [origin, s])

  async function verify() {
    const u = s.channel.trim().toLowerCase()
    if (!u) return
    setVerifying(true)
    setVerifyError(null)
    setVerified(null)
    try {
      const r = await fetch(`/api/kick/channel/${encodeURIComponent(u)}`)
      const data = await r.json()
      if (!r.ok) {
        setVerifyError(data?.error || `Lookup failed (${r.status})`)
      } else {
        setVerified({
          display_name: data.display_name,
          avatar_url: data.avatar_url,
          is_live: !!data.is_live,
        })
      }
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setVerifying(false)
    }
  }

  async function copyUrl() {
    if (!overlayUrl) return
    try {
      await navigator.clipboard.writeText(overlayUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  function set<K extends keyof Settings>(key: K, val: Settings[K]) {
    setS(prev => ({ ...prev, [key]: val }))
  }

  return (
    <div style={{ minHeight: '100vh', padding: '32px 20px', maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>
          Kick Chat Overlay
        </h1>
        <p style={{ margin: '6px 0 0', opacity: 0.65, fontSize: 14 }}>
          A free, customizable Kick chat for OBS. Paste the URL as a Browser Source.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* ----------- Settings ----------- */}
        <section style={card}>
          <Field label="Kick username">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={s.channel}
                onChange={e => set('channel', e.target.value)}
                placeholder="trainwreckstv"
                style={input}
                onKeyDown={e => { if (e.key === 'Enter') verify() }}
              />
              <button onClick={verify} disabled={verifying || !s.channel.trim()} style={btnSecondary}>
                {verifying ? '…' : 'Verify'}
              </button>
            </div>
            {verifyError && <small style={{ color: '#ff6b6b', marginTop: 6, display: 'block' }}>{verifyError}</small>}
            {verified && (
              <small style={{ color: '#4ade80', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                {verified.avatar_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={verified.avatar_url} alt="" width={20} height={20} style={{ borderRadius: '50%' }} />
                )}
                Found {verified.display_name}{verified.is_live ? ' (live now)' : ''}
              </small>
            )}
          </Field>

          <div style={row2}>
            <Field label="Font">
              <select value={s.font} onChange={e => set('font', e.target.value as FontKey)} style={input}>
                <option value="system">System</option>
                <option value="inter">Inter (sans)</option>
                <option value="rounded">Rounded</option>
                <option value="mono">Monospace</option>
                <option value="display">Display (Bebas)</option>
              </select>
            </Field>
            <Field label={`Font size: ${s.size}px`}>
              <input type="range" min={10} max={48} value={s.size}
                onChange={e => set('size', Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
          </div>

          <div style={row2}>
            <Field label="Text color">
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="color" value={s.color}
                  onChange={e => set('color', e.target.value)}
                  style={{ ...input, width: 50, padding: 2, height: 38 }} />
                <input value={s.color} onChange={e => set('color', e.target.value)} style={{ ...input, flex: 1 }} />
              </div>
            </Field>
            <Field label="Background">
              <select value={s.bg} onChange={e => set('bg', e.target.value as Bg)} style={input}>
                <option value="transparent">Transparent (OBS)</option>
                <option value="dark">Dark (preview)</option>
                <option value="light">Light (preview)</option>
                <option value="custom">Custom color</option>
              </select>
            </Field>
          </div>

          {s.bg === 'custom' && (
            <Field label="Custom background">
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="color" value={s.bgcolor}
                  onChange={e => set('bgcolor', e.target.value)}
                  style={{ ...input, width: 50, padding: 2, height: 38 }} />
                <input value={s.bgcolor} onChange={e => set('bgcolor', e.target.value)} style={{ ...input, flex: 1 }} />
              </div>
            </Field>
          )}

          <div style={row2}>
            <Field label="Animation">
              <select value={s.anim} onChange={e => set('anim', e.target.value as Anim)} style={input}>
                <option value="slide">Slide in</option>
                <option value="fade">Fade in</option>
                <option value="none">None</option>
              </select>
            </Field>
            <Field label={`Max messages: ${s.max}`}>
              <input type="range" min={5} max={200} step={5} value={s.max}
                onChange={e => set('max', Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
            <Toggle label="Badges" checked={s.badges} onChange={v => set('badges', v)} />
            <Toggle label="Timestamps" checked={s.timestamps} onChange={v => set('timestamps', v)} />
            <Toggle label="Outline" checked={s.stroke} onChange={v => set('stroke', v)} />
          </div>

          <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid #1f1f24' }}>
            <Field label="Overlay URL (paste into OBS Browser Source)">
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  readOnly
                  value={overlayUrl || 'Enter a channel above…'}
                  style={{ ...input, fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace' }}
                  onFocus={e => e.currentTarget.select()}
                />
                <button onClick={copyUrl} disabled={!overlayUrl} style={btnPrimary}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              {overlayUrl && (
                <small style={{ opacity: 0.55, marginTop: 6, display: 'block', fontSize: 12 }}>
                  In OBS → + → Browser → paste URL → width 400, height 600 (or your preference).
                </small>
              )}
            </Field>
          </div>
        </section>

        {/* ----------- Live preview ----------- */}
        <section style={{ ...card, padding: 0, overflow: 'hidden', position: 'relative' }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #1f1f24',
            fontSize: 13,
            opacity: 0.7,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span>Live preview</span>
            <span style={{ fontSize: 11, opacity: 0.5 }}>
              {s.channel ? `#${s.channel.toLowerCase()}` : 'no channel'}
            </span>
          </div>
          <div style={{
            position: 'relative',
            height: 540,
            background:
              s.bg === 'transparent'
                ? 'repeating-conic-gradient(#1a1a1f 0% 25%, #131316 0% 50%) 50% / 20px 20px'
                : '#0d0d10',
          }}>
            {s.channel ? (
              <iframe
                ref={previewRef}
                src={`/overlay?${buildQuery(s)}`}
                style={{ width: '100%', height: '100%', border: 0, background: 'transparent' }}
                key={buildQuery(s)} /* remount on change */
              />
            ) : (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center', opacity: 0.45, fontSize: 14,
              }}>
                Enter a Kick username to start the preview.
              </div>
            )}
          </div>
        </section>
      </div>

      <footer style={{ marginTop: 32, opacity: 0.4, fontSize: 12, textAlign: 'center' }}>
        Not affiliated with Kick. Built for streamers who want a clean OBS chat.
      </footer>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.75, marginBottom: 6, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
        {label}
      </div>
      {children}
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid ' + (checked ? '#22c55e' : '#2a2a30'),
        background: checked ? 'rgba(34,197,94,0.12)' : '#15151a',
        color: checked ? '#86efac' : '#a1a1aa',
        fontWeight: 600,
        fontSize: 13,
        cursor: 'pointer',
        textAlign: 'center',
      }}
    >
      {checked ? '✓ ' : ''}{label}
    </button>
  )
}

const card: React.CSSProperties = {
  background: '#121216',
  border: '1px solid #1f1f24',
  borderRadius: 14,
  padding: 22,
}

const input: React.CSSProperties = {
  width: '100%',
  background: '#1a1a1f',
  border: '1px solid #2a2a30',
  borderRadius: 8,
  color: '#f0f0f2',
  padding: '9px 11px',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
}

const btnPrimary: React.CSSProperties = {
  background: '#53fc18',
  color: '#000',
  border: 0,
  borderRadius: 8,
  padding: '0 18px',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const btnSecondary: React.CSSProperties = {
  background: '#2a2a30',
  color: '#f0f0f2',
  border: 0,
  borderRadius: 8,
  padding: '0 16px',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const row2: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 14,
}
