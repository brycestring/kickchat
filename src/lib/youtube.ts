// Client-side YouTube poller. Polls our /api/youtube proxy (which holds the
// live-chat continuation server-side) and emits normalized messages, deduping
// by id. Cadence follows the server's suggested pollMs.
import type { ChatMessage } from '@/lib/chat'

type StatusFn = (status: 'connecting' | 'connected' | 'waiting' | 'error', detail?: string) => void

export function connectYouTubeChat(
  channel: string,
  onMessage: (msg: Omit<ChatMessage, '_ts'>) => void,
  onStatus?: StatusFn,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const seen = new Set<string>()
  const seenOrder: string[] = []

  function remember(id: string) {
    if (seen.has(id)) return false
    seen.add(id); seenOrder.push(id)
    if (seenOrder.length > 500) { const old = seenOrder.shift(); if (old) seen.delete(old) }
    return true
  }

  async function poll() {
    if (stopped) return
    let nextMs = 3000
    try {
      const r = await fetch(`/api/youtube?channel=${encodeURIComponent(channel)}`)
      const d = await r.json()
      if (d.live === false) {
        onStatus?.('waiting')
        nextMs = 8000 // channel not live — check back less often
      } else if (Array.isArray(d.messages)) {
        onStatus?.('connected')
        for (const m of d.messages) {
          if (m?.id && remember(m.id)) {
            onMessage({ id: m.id, platform: 'youtube', username: m.username || '', color: m.color || '#cfcfcf', parts: Array.isArray(m.parts) ? m.parts : [], badges: m.badges || [] })
          }
        }
        if (typeof d.pollMs === 'number') nextMs = d.pollMs
      }
    } catch {
      onStatus?.('error')
      nextMs = 6000
    }
    if (!stopped) timer = setTimeout(poll, nextMs)
  }

  onStatus?.('connecting')
  poll()
  return () => { stopped = true; if (timer) clearTimeout(timer) }
}
