// Browser-side Twitch chat via anonymous IRC-over-WebSocket. No auth needed to
// READ chat: connect as an anonymous "justinfan" user with tags enabled.
import { escapeHtml, twemojify, localBadgeSrc, type ChatMessage } from '@/lib/chat'

type StatusFn = (status: 'connecting' | 'connected' | 'disconnected' | 'error', detail?: string) => void

// Unescape IRCv3 tag values (\s space, \: semicolon, \\ backslash, \r \n).
function unescapeTag(v: string): string {
  return v.replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
}

function parseTags(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of raw.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    out[pair.slice(0, eq)] = unescapeTag(pair.slice(eq + 1))
  }
  return out
}

// Render a Twitch message: replace emote ranges (from the emotes tag) with
// CDN <img>s, twemoji the rest. Positions in the emotes tag are codepoint
// indices, so we index the message as an array of codepoints.
function renderTwitch(message: string, emotesTag: string | undefined): string {
  const cps = Array.from(message)
  const ranges: { start: number; end: number; id: string }[] = []
  if (emotesTag) {
    for (const group of emotesTag.split('/')) {
      const [id, positions] = group.split(':')
      if (!id || !positions) continue
      for (const range of positions.split(',')) {
        const [a, b] = range.split('-').map(Number)
        if (Number.isFinite(a) && Number.isFinite(b)) ranges.push({ start: a, end: b, id })
      }
    }
    ranges.sort((x, y) => x.start - y.start)
  }
  let out = ''
  let i = 0
  for (const r of ranges) {
    if (r.start > i) out += twemojify(escapeHtml(cps.slice(i, r.start).join('')))
    const name = escapeHtml(cps.slice(r.start, r.end + 1).join(''))
    out += `<img class="kc-emote" src="https://static-cdn.jtvnw.net/emoticons/v2/${r.id}/default/dark/2.0" alt="${name}" title="${name}" />`
    i = r.end + 1
  }
  if (i < cps.length) out += twemojify(escapeHtml(cps.slice(i).join('')))
  return out
}

function badgesFromTag(tag: string | undefined): string[] {
  if (!tag) return []
  const out: string[] = []
  for (const b of tag.split(',')) {
    const role = b.split('/')[0]
    const src = localBadgeSrc(role)
    if (src && !out.includes(src)) out.push(src)
  }
  return out
}

export function connectTwitchChat(
  channel: string,
  onMessage: (msg: Omit<ChatMessage, '_ts'>) => void,
  onStatus?: StatusFn,
): () => void {
  const chan = channel.trim().toLowerCase().replace(/^#/, '')
  let ws: WebSocket | null = null
  let stopped = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connect() {
    if (stopped) return
    onStatus?.('connecting')
    ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443')
    ws.addEventListener('open', () => {
      ws!.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
      ws!.send('PASS SCHMOOPIIE')
      ws!.send('NICK justinfan' + Math.floor(10000 + Math.random() * 89999))
      ws!.send('JOIN #' + chan)
      onStatus?.('connected')
    })
    ws.addEventListener('message', (e) => {
      const data = typeof e.data === 'string' ? e.data : ''
      for (const line of data.split('\r\n')) {
        if (!line) continue
        if (line.startsWith('PING')) { try { ws?.send('PONG :tmi.twitch.tv') } catch {}; continue }
        // @tags :prefix PRIVMSG #chan :message
        let rest = line
        let tags: Record<string, string> = {}
        if (rest[0] === '@') {
          const sp = rest.indexOf(' ')
          tags = parseTags(rest.slice(1, sp))
          rest = rest.slice(sp + 1)
        }
        const prMatch = rest.match(/^:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :([\s\S]*)$/)
        if (!prMatch) continue
        const nick = prMatch[1]
        let text = prMatch[2]
        // Strip Twitch /me ACTION wrapper (\x01ACTION ...\x01).
        const action = text.match(/^\x01ACTION ([\s\S]*)\x01$/)
        if (action) text = action[1]
        onMessage({
          id: tags.id || `${nick}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          platform: 'twitch',
          username: tags['display-name'] || nick,
          color: tags.color || '#bf94ff',
          html: renderTwitch(text, tags.emotes),
          badges: badgesFromTag(tags.badges),
        })
      }
    })
    ws.addEventListener('close', () => {
      onStatus?.('disconnected')
      if (!stopped) reconnectTimer = setTimeout(connect, 2500)
    })
    ws.addEventListener('error', () => onStatus?.('error'))
  }

  connect()
  return () => {
    stopped = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    try { ws?.close() } catch {}
  }
}
