import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

import type { NostrEvent, Signer } from './types'

/** NIP-98: an HTTP request signed with the reader's own key. */

export const NIP98_KIND = 27235

/** Signers show `content` to the reader when they prompt. */
const DEFAULT_CONTENT = 'HTTP request'

/** Phone clocks run fast often enough to matter. */
const CLOCK_SKEW_SECONDS = 10

export interface HttpAuthParams {
  /** Absolute URL, exactly as the request will address. */
  url: string
  method: string
  /** The request body. */
  body?: string
  /** Shown by NIP-07 and NIP-46 signers when they prompt for the signature. */
  content?: string
}

export async function createHttpAuth(signer: Signer, params: HttpAuthParams): Promise<NostrEvent> {
  const tags: string[][] = [
    ['u', params.url],
    ['method', params.method.toUpperCase()],
  ]
  if (params.body !== undefined) {
    tags.push(['payload', bytesToHex(sha256(new TextEncoder().encode(params.body)))])
  }

  return signer.signEvent({
    kind: NIP98_KIND,
    created_at: Math.floor(Date.now() / 1000) - CLOCK_SKEW_SECONDS,
    content: params.content ?? DEFAULT_CONTENT,
    tags,
  })
}

/** The `Authorization` header value. */
export function httpAuthHeader(auth: NostrEvent): string {
  return `Nostr ${toBase64(new TextEncoder().encode(JSON.stringify(auth)))}`
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Hand-rolled, like the one in `blossom.ts`. */
function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0
    const b1 = bytes[i + 1] ?? 0
    const b2 = bytes[i + 2] ?? 0
    const triple = (b0 << 16) | (b1 << 8) | b2
    out += B64_ALPHABET.charAt((triple >> 18) & 63)
    out += B64_ALPHABET.charAt((triple >> 12) & 63)
    out += i + 1 < bytes.length ? B64_ALPHABET.charAt((triple >> 6) & 63) : '='
    out += i + 2 < bytes.length ? B64_ALPHABET.charAt(triple & 63) : '='
  }
  return out
}
