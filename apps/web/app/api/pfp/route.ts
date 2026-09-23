import { servePfp } from './handler'

/** `GET /api/pfp?u=<source>`. */
export const runtime = 'nodejs'
/** Never prerendered, and never cached by Next's own route cache. */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  return servePfp(request)
}
