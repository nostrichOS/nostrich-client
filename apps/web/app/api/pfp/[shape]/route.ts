import { servePfp } from '../handler'
import { PFP_VARIANTS, isPfpVariant } from '../../../../lib/pfp-variants'

/** `GET /api/pfp/<width>.webp?u=<source>`. */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ shape: string }> },
): Promise<Response> {
  const { shape } = await params
  if (!shape.endsWith('.webp')) return badShape()
  const width = Number(shape.slice(0, -'.webp'.length))
  if (!isPfpVariant(width)) return badShape()
  return servePfp(request, width)
}

function badShape(): Response {
  return new Response(`shape must be one of ${PFP_VARIANTS.map(w => `${w}.webp`).join(', ')}`, {
    status: 400,
  })
}
