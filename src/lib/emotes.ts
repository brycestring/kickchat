// Third-party channel emotes (7TV / BTTV / FFZ). These appear in messages as
// plain words (e.g. "catJAM", "OMEGALUL") that we swap for images at render.
// All three provider APIs are CORS-friendly, so we fetch them client-side.
//
// 7TV supports twitch, kick and youtube (by platform user/channel id).
// BTTV + FFZ are Twitch-only.

async function getJson(url: string): Promise<unknown | null> {
  try { const r = await fetch(url); return r.ok ? await r.json() : null } catch { return null }
}

function add(map: Map<string, string>, name: string | undefined, url: string | undefined) {
  if (name && url) map.set(name, url.startsWith('//') ? 'https:' + url : url)
}

async function sevenTv(map: Map<string, string>, platform: 'twitch' | 'kick' | 'youtube', id: string) {
  const data = await getJson(`https://7tv.io/v3/users/${platform}/${id}`) as { emote_set?: { emotes?: Array<{ name?: string; id?: string }> } } | null
  for (const e of data?.emote_set?.emotes ?? []) add(map, e.name, e.id ? `https://cdn.7tv.app/emote/${e.id}/2x.webp` : undefined)
}

async function sevenTvGlobal(map: Map<string, string>) {
  const data = await getJson('https://7tv.io/v3/emote-sets/global') as { emotes?: Array<{ name?: string; id?: string }> } | null
  for (const e of data?.emotes ?? []) add(map, e.name, e.id ? `https://cdn.7tv.app/emote/${e.id}/2x.webp` : undefined)
}

async function bttv(map: Map<string, string>, twitchId: string) {
  const g = await getJson('https://api.betterttv.net/3/cached/emotes/global') as Array<{ code?: string; id?: string }> | null
  for (const e of g ?? []) add(map, e.code, e.id ? `https://cdn.betterttv.net/emote/${e.id}/2x.webp` : undefined)
  const c = await getJson(`https://api.betterttv.net/3/cached/users/twitch/${twitchId}`) as { channelEmotes?: Array<{ code?: string; id?: string }>; sharedEmotes?: Array<{ code?: string; id?: string }> } | null
  for (const e of [...(c?.channelEmotes ?? []), ...(c?.sharedEmotes ?? [])]) add(map, e.code, e.id ? `https://cdn.betterttv.net/emote/${e.id}/2x.webp` : undefined)
}

async function ffz(map: Map<string, string>, twitchId: string) {
  const data = await getJson(`https://api.frankerfacez.com/v1/room/id/${twitchId}`) as { sets?: Record<string, { emoticons?: Array<{ name?: string; urls?: Record<string, string> }> }> } | null
  for (const set of Object.values(data?.sets ?? {})) {
    for (const e of set.emoticons ?? []) add(map, e.name, e.urls?.['2'] || e.urls?.['1'])
  }
}

// Build the emote map for whichever platform ids are known. Channel emotes
// override globals (added last).
export async function buildEmoteMap(ids: { twitchId?: string; kickId?: string; youtubeId?: string }): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const jobs: Promise<void>[] = [sevenTvGlobal(map)]
  if (ids.twitchId) jobs.push(bttv(map, ids.twitchId), ffz(map, ids.twitchId), sevenTv(map, 'twitch', ids.twitchId))
  if (ids.kickId) jobs.push(sevenTv(map, 'kick', ids.kickId))
  if (ids.youtubeId) jobs.push(sevenTv(map, 'youtube', ids.youtubeId))
  await Promise.allSettled(jobs)
  return map
}
