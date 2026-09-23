import { prisma } from '@nostrich/api'

/** The trending list, precomputed, as one primary-key lookup. */

/** Node, not edge: this reads Postgres. */
export const runtime = 'nodejs'
/** Never statically rendered. */
export const dynamic = 'force-dynamic'

/** 1, 4 and 24 are the note windows. */
const WINDOWS = new Set([1, 4, 24, 720])

/** Half the worker's build interval. */
const CACHE_SECONDS = 150
const STALE_SECONDS = 600

export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get('hours')
  const hours = Number(raw)
  if (!WINDOWS.has(hours)) {
    return Response.json({ error: 'hours must be 1, 4, 24 or 720' }, { status: 400 })
  }

  const snapshot = await prisma.trendingSnapshot.findUnique({ where: { hours } })
  /* NO SNAPSHOT IS NOT AN ERROR, and must not read as one. */
  if (snapshot === null) {
    return Response.json(
      { hours, ready: false, notes: [], profiles: [] },
      { headers: { 'cache-control': 'public, max-age=30' } },
    )
  }

  const payload = snapshot.payload as Record<string, unknown>
  return Response.json(
    {
      ...payload,
      ready: true,
      /* Age in seconds rather than a timestamp. */
      ageSeconds: Math.max(0, Math.round((Date.now() - snapshot.builtAt.getTime()) / 1000)),
    },
    {
      headers: {
        'cache-control': `public, max-age=${CACHE_SECONDS}`,
      },
    },
  )
}
