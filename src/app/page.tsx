'use client'

import { useEffect, useMemo, useState } from 'react'

type Size = 'small' | 'medium' | 'large' | 'xlarge'
type Stroke = 'off' | 'thin' | 'medium' | 'thick' | 'thicker'

interface Settings {
  channel: string
  size: Size
  stroke: Stroke
  animate: boolean
  badges: boolean
  commands: boolean   // hide commands
  bots: boolean       // hide bots
  fade: boolean
  delay: number
}

const DEFAULTS: Settings = {
  channel: '',
  size: 'medium',
  stroke: 'medium',
  animate: true,
  badges: true,
  commands: true,
  bots: true,
  fade: false,
  delay: 10,
}

function buildQuery(s: Settings): string {
  const p = new URLSearchParams()
  p.set('channel', s.channel.trim().toLowerCase())
  p.set('size', s.size)
  p.set('stroke', s.stroke)
  p.set('animate', s.animate ? '1' : '0')
  p.set('badges', s.badges ? '1' : '0')
  p.set('commands', s.commands ? '1' : '0')
  p.set('bots', s.bots ? '1' : '0')
  if (s.fade) {
    p.set('fade', '1')
    p.set('delay', String(s.delay))
  }
  return p.toString()
}

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(DEFAULTS)
  const [origin, setOrigin] = useState('')
  const [verified, setVerified] = useState<null | { display_name: string; avatar_url: string | null; is_live: boolean }>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [generated, setGenerated] = useState(false)
  const [copied, setCopied] = useState(false)

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

  function set<K extends keyof Settings>(key: K, val: Settings[K]) {
    setS(prev => ({ ...prev, [key]: val }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const u = s.channel.trim().toLowerCase()
    if (!u) return
    setVerified(null)
    setVerifyError(null)
    setGenerated(false)
    try {
      const r = await fetch(`/api/kick/channel/${encodeURIComponent(u)}`)
      const data = await r.json()
      if (!r.ok) {
        setVerifyError(data?.error || `Lookup failed (${r.status})`)
        return
      }
      setVerified({ display_name: data.display_name, avatar_url: data.avatar_url, is_live: !!data.is_live })
      setGenerated(true)
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Lookup failed')
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

  return (
    <div className="page">
      <style>{styles}</style>

      <header className="hero">
        <div className="hero-inner">
          <KickLogo />
          <h1 className="title glow-text">Chat Overlay</h1>
        </div>
      </header>

      <main className="main">
        {/* ---- Configuration card ---- */}
        <section className="card">
          <div className="card-header">
            <div className="dots"><i/><i/><i/></div>
            <span>Configuration</span>
          </div>

          <form className="card-body" onSubmit={onSubmit}>
            <div>
              <label className="section-label" htmlFor="channel">Kick Channel</label>
              <input
                id="channel"
                className="input center"
                placeholder="kick channel name"
                value={s.channel}
                onChange={e => set('channel', e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="grid-2">
              <div>
                <label className="section-label" htmlFor="size">Font Size</label>
                <select id="size" className="select" value={s.size} onChange={e => set('size', e.target.value as Size)}>
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                  <option value="xlarge">X-Large</option>
                </select>
              </div>
              <div>
                <label className="section-label" htmlFor="stroke">Text Stroke</label>
                <select id="stroke" className="select" value={s.stroke} onChange={e => set('stroke', e.target.value as Stroke)}>
                  <option value="off">Off</option>
                  <option value="thin">Thin</option>
                  <option value="medium">Medium</option>
                  <option value="thick">Thick</option>
                  <option value="thicker">Thicker</option>
                </select>
              </div>
            </div>

            <div className="grid-2 toggles">
              <Check label="Animate" checked={s.animate} onChange={v => set('animate', v)} />
              <Check label="Badges" checked={s.badges} onChange={v => set('badges', v)} />
              <Check label="Hide Commands" checked={s.commands} onChange={v => set('commands', v)} />
              <Check label="Hide Bots" checked={s.bots} onChange={v => set('bots', v)} />
            </div>

            <div className="fade-row">
              <Check label="Fade Messages" checked={s.fade} onChange={v => set('fade', v)} />
              <input
                type="number"
                min={2}
                max={120}
                className="input small"
                value={s.delay}
                disabled={!s.fade}
                onChange={e => set('delay', Math.max(2, Math.min(120, Number(e.target.value) || 10)))}
                placeholder="seconds"
              />
            </div>

            {verifyError && <div className="error">⚠ {verifyError}</div>}
            {verified && generated && (
              <div className="success">
                {verified.avatar_url && <img src={verified.avatar_url} alt="" />}
                Found <b>{verified.display_name}</b>{verified.is_live ? ' — live now' : ''}
              </div>
            )}

            <button type="submit" className="btn-generate" disabled={!s.channel.trim()}>
              Generate URL
            </button>
          </form>

          {generated && overlayUrl && (
            <div className="url-output">
              <p className="section-label center">
                {copied ? 'Copied to clipboard ✓' : 'Click to copy Browser Source URL'}
              </p>
              <div className="url-box" onClick={copyUrl} title="Click to copy">
                {overlayUrl}
              </div>
            </div>
          )}
        </section>

        {/* ---- Preview card ---- */}
        <section className="card">
          <div className="card-header">
            <div className="dots"><i/><i/><i/></div>
            <span>Preview</span>
          </div>
          <div className="card-body">
            <div className="preview">
              {s.channel ? (
                <iframe
                  src={`/overlay?${buildQuery(s)}`}
                  className="preview-frame"
                  key={buildQuery(s)}
                />
              ) : (
                <div className="preview-empty">Enter a Kick channel to preview</div>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p className="footer-credit">
          <span className="muted">Made for</span>
          <span className="footer-link"> Kick streamers</span>
        </p>
        <p className="footer-disclaimer">
          Not affiliated with <a href="https://kick.com" target="_blank" rel="noreferrer noopener">Kick.com</a>
        </p>
      </footer>
    </div>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="check-mark" />
      <span className="check-label">{label}</span>
    </label>
  )
}

function KickLogo() {
  return (
    <svg width="56" height="56" viewBox="0 0 100 100" aria-label="Kick logo" className="kick-logo">
      <rect x="6" y="6" width="88" height="88" rx="14" fill="#53fc18"/>
      <path d="M20 22 H34 V44 H44 V34 H54 V24 H68 V40 H58 V50 H68 V66 H54 V56 H44 V46 H34 V78 H20 Z" fill="#0a0a0a"/>
    </svg>
  )
}

const styles = `
:root {
  --primary: #53fc18;
  --primary-dim: #45d414;
  --primary-glow: rgba(83, 252, 24, 0.35);
  --bg-base: #121212;
  --bg-surface: #1e1e1e;
  --bg-elevated: #2a2a2a;
  --text-bright: #ffffff;
  --text-dim: #a0a0a0;
  --text-muted: #666666;
  --border-color: #333333;
  --border-dim: #282828;
  --radius: 8px;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg-base); color: var(--text-bright); font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; }

.page { min-height: 100vh; padding-bottom: 96px; position: relative; }

/* subtle radial vignette */
.page::after {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: -1;
  background: radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.5) 100%);
}

/* ---- Hero ---- */
.hero { padding: 40px 16px 24px; }
.hero-inner { max-width: 600px; margin: 0 auto; display: flex; align-items: center; justify-content: center; gap: 16px; }
.kick-logo { filter: drop-shadow(0 0 10px var(--primary-glow)) drop-shadow(0 0 20px var(--primary-glow)); animation: pulse 2s ease-in-out infinite; }
@keyframes pulse {
  0%,100% { filter: drop-shadow(0 0 10px var(--primary-glow)) drop-shadow(0 0 20px var(--primary-glow)); transform: scale(1); }
  50%     { filter: drop-shadow(0 0 15px var(--primary-glow)) drop-shadow(0 0 30px var(--primary-glow)); transform: scale(1.02); }
}
.title { margin: 0; font-size: 32px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; }
.glow-text { text-shadow: 0 0 5px var(--primary-glow), 0 0 10px var(--primary-glow), 0 0 20px var(--primary-glow); }
@media (min-width: 640px) { .title { font-size: 38px; } }

/* ---- Main ---- */
.main { max-width: 600px; margin: 0 auto; padding: 0 16px; display: flex; flex-direction: column; gap: 20px; }

/* ---- Terminal card ---- */
.card {
  background: var(--bg-surface);
  border: 2px solid var(--border-color);
  border-radius: var(--radius);
  box-shadow: 0 0 20px rgba(83,252,24,0.06), inset 0 0 60px rgba(0,0,0,0.5);
  position: relative;
  overflow: hidden;
}
.card-header {
  height: 36px;
  background: var(--primary);
  border-bottom: 2px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  position: relative;
}
.card-header span {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: #121212;
  text-transform: uppercase;
}
.dots { position: absolute; left: 12px; display: flex; gap: 6px; }
.dots i { width: 10px; height: 10px; border-radius: 50%; background: #121212; opacity: 0.4; display: inline-block; }
.card-body { padding: 22px 22px 24px; display: flex; flex-direction: column; gap: 18px; }

/* ---- Labels ---- */
.section-label {
  display: block;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 8px;
  font-weight: 600;
}
.section-label.center { text-align: center; }

/* ---- Inputs ---- */
.input, .select {
  width: 100%;
  background: var(--bg-base);
  border: 1px solid var(--border-dim);
  color: var(--text-bright);
  padding: 12px 14px;
  border-radius: var(--radius);
  font-family: inherit;
  font-size: 15px;
  outline: none;
  caret-color: var(--primary);
  transition: all 0.2s ease;
}
.input.center { text-align: center; letter-spacing: 0.08em; }
.input.small { padding: 8px 12px; font-size: 13px; width: 120px; text-align: center; }
.input:focus, .select:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary), 0 0 20px rgba(83,252,24,0.2);
}
.input:disabled { opacity: 0.4; cursor: not-allowed; }
.input::placeholder { color: var(--text-muted); }
.select {
  appearance: none;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2353fc18' d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 36px;
}

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.toggles { gap: 12px 16px; }
.fade-row { display: flex; align-items: center; gap: 16px; }

/* ---- Checkbox ---- */
.check { display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; position: relative; }
.check input { position: absolute; opacity: 0; width: 0; height: 0; }
.check-mark {
  width: 18px; height: 18px; flex-shrink: 0;
  border: 1px solid var(--border-dim);
  background: var(--bg-base);
  border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s ease;
}
.check-mark::after {
  content: ""; width: 10px; height: 10px;
  background: var(--primary);
  border-radius: 2px;
  box-shadow: 0 0 10px var(--primary-glow);
  opacity: 0; transition: opacity 0.15s ease;
}
.check input:checked ~ .check-mark { border-color: var(--primary); box-shadow: 0 0 10px rgba(83,252,24,0.25); }
.check input:checked ~ .check-mark::after { opacity: 1; }
.check:hover .check-mark { border-color: var(--primary); }
.check-label { font-size: 13px; color: var(--text-dim); letter-spacing: 0.02em; transition: color 0.15s ease; }
.check:hover .check-label, .check input:checked ~ .check-label { color: var(--text-bright); }

/* ---- Generate button ---- */
.btn-generate {
  margin-top: 4px;
  background: transparent;
  border: 2px solid var(--primary);
  color: var(--primary);
  font-family: inherit;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 13px;
  padding: 14px;
  border-radius: var(--radius);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: all 0.25s ease;
}
.btn-generate::before {
  content: ""; position: absolute; top: 0; left: -100%;
  width: 100%; height: 100%;
  background: linear-gradient(90deg, transparent, var(--primary), transparent);
  opacity: 0.3; transition: left 0.5s ease;
}
.btn-generate:hover:not(:disabled)::before { left: 100%; }
.btn-generate:hover:not(:disabled) {
  background: var(--primary);
  color: #0a0a0a;
  box-shadow: 0 0 30px var(--primary-glow);
  transform: translateY(-2px);
}
.btn-generate:active:not(:disabled) { transform: translateY(0); }
.btn-generate:disabled { opacity: 0.4; cursor: not-allowed; }

/* ---- URL output ---- */
.url-output { padding: 0 22px 22px; }
.url-box {
  background: rgba(0,0,0,0.5);
  border: 1px dashed var(--primary);
  border-radius: var(--radius);
  padding: 14px 14px 14px 32px;
  font-size: 12px;
  font-family: ui-monospace, "JetBrains Mono", Menlo, monospace;
  word-break: break-all;
  cursor: pointer;
  position: relative;
  text-shadow: 0 0 5px rgba(83,252,24,0.4);
  transition: all 0.2s ease;
}
.url-box::before {
  content: ">"; position: absolute; left: 12px; top: 50%;
  transform: translateY(-50%);
  color: var(--primary);
  animation: blink 1s step-end infinite;
}
@keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
.url-box:hover { background: rgba(83,252,24,0.08); box-shadow: 0 0 20px rgba(83,252,24,0.2); }

/* ---- Messages / errors ---- */
.error { color: #ff6b6b; font-size: 13px; text-align: center; }
.success { color: var(--primary); font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.success img { width: 22px; height: 22px; border-radius: 50%; }

/* ---- Preview ---- */
.preview {
  position: relative;
  height: 360px;
  background: repeating-conic-gradient(#161616 0% 25%, #1c1c1c 0% 50%) 50% / 18px 18px;
  border: 1px solid var(--border-dim);
  border-radius: var(--radius);
  overflow: hidden;
}
.preview-frame { width: 100%; height: 100%; border: 0; background: transparent; }
.preview-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase; }

/* ---- Footer ---- */
.footer {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.85) 60%);
  border-top: 1px solid rgba(83,252,24,0.2);
  padding: 14px 16px;
  text-align: center;
  z-index: 50;
}
.footer-credit { margin: 0; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; }
.footer-disclaimer { margin: 4px 0 0; font-size: 11px; color: var(--text-muted); }
.muted { color: var(--text-muted); }
.footer-link { color: var(--primary); text-shadow: 0 0 8px var(--primary-glow); }
.footer-disclaimer a { color: var(--text-dim); text-decoration: none; }
.footer-disclaimer a:hover { color: var(--text-bright); }
`
