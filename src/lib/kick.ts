// Browser-side Kick chat connection via Pusher WebSocket.
// Kick uses Pusher with these public credentials (visible in their web app).

export const KICK_PUSHER_KEY = '32cbd69e4b950bf97679'
export const KICK_PUSHER_CLUSTER = 'us2'

export interface KickChatMessage {
  id: string
  content: string
  type: string
  sender: {
    id: number
    username: string
    slug: string
    identity?: {
      color?: string
      badges?: Array<{ type: string; text?: string; count?: number }>
    }
  }
  created_at: string
}

// Connect to Kick chat for a given chatroom_id. Returns a stop() function.
// onMessage fires once per chat message; onStatus reports connection state.
export function connectKickChat(
  chatroomId: number | string,
  onMessage: (msg: KickChatMessage) => void,
  onStatus?: (status: 'connecting' | 'connected' | 'disconnected' | 'error', detail?: string) => void
): () => void {
  const url = `wss://ws-${KICK_PUSHER_CLUSTER}.pusher.com/app/${KICK_PUSHER_KEY}?protocol=7&client=js&version=7.6.0&flash=false`
  let ws: WebSocket | null = null
  let stopped = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  const channel = `chatrooms.${chatroomId}.v2`

  function connect() {
    if (stopped) return
    onStatus?.('connecting')
    ws = new WebSocket(url)
    ws.addEventListener('open', () => {
      onStatus?.('connected')
      ws!.send(
        JSON.stringify({
          event: 'pusher:subscribe',
          data: { auth: '', channel },
        })
      )
      // Pusher keepalive
      pingTimer = setInterval(() => {
        try { ws?.send(JSON.stringify({ event: 'pusher:ping', data: {} })) } catch {}
      }, 30_000)
    })
    ws.addEventListener('message', (e) => {
      let parsed: { event?: string; data?: unknown; channel?: string }
      try { parsed = JSON.parse(typeof e.data === 'string' ? e.data : '') } catch { return }
      if (!parsed?.event) return
      if (parsed.event !== 'App\\Events\\ChatMessageEvent') return
      let payload: KickChatMessage | null = null
      try {
        payload = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : (parsed.data as KickChatMessage)
      } catch { return }
      if (payload?.id && payload.sender?.username) onMessage(payload)
    })
    ws.addEventListener('close', () => {
      onStatus?.('disconnected')
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
      if (!stopped) reconnectTimer = setTimeout(connect, 2500)
    })
    ws.addEventListener('error', () => onStatus?.('error'))
  }

  connect()
  return () => {
    stopped = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (pingTimer) clearInterval(pingTimer)
    try { ws?.close() } catch {}
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
import twemoji from '@twemoji/api'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Render a Kick chat message to safe HTML:
//   1. [emote:ID:name] tags → <img> from files.kick.com
//   2. Unicode emojis (😂, 🔥, etc.) → Twemoji SVG <img> so they show in
//      full color on every platform (OBS browser source, Windows, Linux —
//      not just systems with Apple Color Emoji)
//   3. Everything else gets HTML-escaped so plain text can't inject markup
export function renderKickMessageHTML(content: string): string {
  // Split on Kick emote tags so we can handle the text and emote pieces
  // separately. Even indices = plain text, odd-grouped indices = emote.
  const parts = content.split(/\[emote:(\d+):([^\]]+)\]/g)
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      // Plain text chunk — escape, then run twemoji to swap unicode
      // emojis for color SVG <img> tags.
      const escaped = escapeHtml(parts[i])
      out += twemoji.parse(escaped, {
        folder: 'svg',
        ext: '.svg',
        className: 'kc-twemoji',
      } as Parameters<typeof twemoji.parse>[1])
    } else if (i % 3 === 1) {
      // Emote id; the next part is the name.
      const id = parts[i]
      const name = escapeHtml(parts[i + 1] ?? '')
      out += `<img class="kc-emote" src="https://files.kick.com/emotes/${id}/fullsize" alt="${name}" title="${name}" />`
      i++ // skip the name part we already consumed
    }
  }
  return out
}
