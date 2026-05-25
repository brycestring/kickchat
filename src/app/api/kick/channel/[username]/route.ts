import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params
  const u = username.trim().toLowerCase()
  if (!u || !/^[a-z0-9_-]+$/.test(u)) {
    return Response.json({ error: 'Invalid username' }, { status: 400 })
  }
  try {
    const r = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(u)}`, {
      headers: HEADERS,
      cache: 'no-store',
    })
    if (!r.ok) {
      return Response.json({ error: `Kick API ${r.status}` }, { status: r.status === 404 ? 404 : 502 })
    }
    const data = await r.json()
    const chatroomId = data?.chatroom?.id ?? null
    if (!chatroomId) return Response.json({ error: 'No chatroom found for channel' }, { status: 404 })
    return Response.json({
      username: data?.slug ?? u,
      display_name: data?.user?.username ?? u,
      chatroom_id: chatroomId,
      avatar_url: data?.user?.profile_pic ?? null,
      is_live: !!data?.livestream,
    })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Lookup failed' }, { status: 500 })
  }
}
