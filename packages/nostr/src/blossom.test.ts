import { describe, expect, it } from 'vitest'
import { getEventHash } from 'nostr-tools/pure'
import {
  BLOSSOM_AUTH_KIND,
  BlossomError,
  DEFAULT_BLOSSOM_SERVERS,
  blobSha256,
  blossomAuthHeader,
  buildImetaTag,
  createBlossomAuth,
  deleteBlob,
  galleryPreset,
  imetaDimFor,
  listBlobs,
  mediaPreset,
  uploadBlob,
  uploadWithMirrors,
} from './blossom'
import type { EventTemplate, NostrEvent, Signer } from './types'

const PUBKEY = 'f'.repeat(63) + '1'
/** sha256("hello world"), the standard vector. */
const HELLO_SHA256 = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'

class TestSigner implements Signer {
  readonly kind = 'privatekey' as const
  readonly signed: EventTemplate[] = []

  async getPublicKey(): Promise<string> {
    return PUBKEY
  }

  async signEvent(template: EventTemplate): Promise<NostrEvent> {
    this.signed.push(template)
    const unsigned = { ...template, pubkey: PUBKEY }
    // Servers verify the signature.
    return { ...unsigned, id: getEventHash(unsigned), sig: '0'.repeat(128) }
  }

  async nip44Encrypt(): Promise<string> {
    return ''
  }

  async nip44Decrypt(): Promise<string> {
    return ''
  }
}

interface StubCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

function stubFetch(handler: (call: StubCall) => Response | Promise<Response>): {
  fetch: typeof fetch
  calls: StubCall[]
} {
  const calls: StubCall[] = []
  const impl = async (input: unknown, init: RequestInit = {}): Promise<Response> => {
    const call: StubCall = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body,
    }
    calls.push(call)
    return handler(call)
  }
  return { fetch: impl as unknown as typeof fetch, calls }
}

function descriptorResponse(server: string, sha256: string, size: number, type = 'image/png'): Response {
  return new Response(
    JSON.stringify({ url: `${server}/${sha256}.png`, sha256, size, type, uploaded: 1700000000 }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function decodeAuthHeader(header: string): NostrEvent {
  const [scheme, payload] = header.split(' ')
  expect(scheme).toBe('Nostr')
  const binary = atob(payload ?? '')
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes)) as NostrEvent
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1]
}

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('sha256 addressing', () => {
  it('hashes the payload to the canonical digest', async () => {
    expect(await blobSha256(bytesOf('hello world'))).toBe(HELLO_SHA256)
  })

  it('hashes ArrayBuffer and Blob inputs identically', async () => {
    const bytes = bytesOf('hello world')
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    expect(await blobSha256(buffer)).toBe(HELLO_SHA256)
    expect(await blobSha256(new Blob(['hello world']))).toBe(HELLO_SHA256)
  })

  it('PUTs the raw bytes to /upload and addresses them by hash', async () => {
    const stub = stubFetch(({ url }) =>
      descriptorResponse(url.replace('/upload', ''), HELLO_SHA256, 11, 'text/plain'),
    )
    const blob = await uploadBlob('https://blossom.example/', bytesOf('hello world'), new TestSigner(), {
      fetch: stub.fetch,
      type: 'text/plain',
    })

    const call = stub.calls[0]
    expect(call?.url).toBe('https://blossom.example/upload')
    expect(call?.method).toBe('PUT')
    expect(call?.headers['Content-Type']).toBe('text/plain')
    expect(new TextDecoder().decode(call?.body as Uint8Array)).toBe('hello world')
    expect(blob.sha256).toBe(HELLO_SHA256)
    expect(blob.url).toBe('https://blossom.example/b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9.png')
  })

  it('falls back to hash addressing when the server answers 200 with no JSON', async () => {
    const stub = stubFetch(() => new Response('ok', { status: 200 }))
    const blob = await uploadBlob('https://blossom.example', bytesOf('hello world'), new TestSigner(), {
      fetch: stub.fetch,
    })
    expect(blob.url).toBe(`https://blossom.example/${HELLO_SHA256}`)
    expect(blob.size).toBe(11)
  })
})

describe('auth events', () => {
  it('builds a kind-24242 event with verb, payload hash and expiration', async () => {
    const now = Math.floor(Date.now() / 1000)
    const auth = await createBlossomAuth(new TestSigner(), {
      verb: 'upload',
      hashes: [HELLO_SHA256],
      server: 'https://blossom.example/',
    })

    expect(auth.kind).toBe(BLOSSOM_AUTH_KIND)
    expect(auth.kind).toBe(24242)
    expect(tagValue(auth, 't')).toBe('upload')
    expect(tagValue(auth, 'x')).toBe(HELLO_SHA256)
    expect(tagValue(auth, 'server')).toBe('https://blossom.example')
    // Servers reject a future created_at and an expired expiration.
    expect(auth.created_at).toBeLessThanOrEqual(now)
    expect(Number(tagValue(auth, 'expiration'))).toBeGreaterThan(now)
  })

  describe('the server tag, in both forms', () => {
    /** Not a style choice. */
    const serverTags = (auth: { tags: string[][] }): string[] =>
      auth.tags.filter(tag => tag[0] === 'server').map(tag => tag[1] ?? '')

    it('carries the origin AND the bare hostname', async () => {
      const auth = await createBlossomAuth(new TestSigner(), {
        verb: 'upload',
        hashes: [HELLO_SHA256],
        server: 'https://blossom.example/',
      })
      expect(serverTags(auth)).toEqual(['https://blossom.example', 'blossom.example'])
    })

    it('keeps a port, which is part of the host a server compares against', async () => {
      const auth = await createBlossomAuth(new TestSigner(), {
        verb: 'upload',
        hashes: [HELLO_SHA256],
        server: 'http://localhost:3000',
      })
      expect(serverTags(auth)).toEqual(['http://localhost:3000', 'localhost:3000'])
    })

    it('adds nothing when no server was named', async () => {
      const auth = await createBlossomAuth(new TestSigner(), { verb: 'delete', hashes: [HELLO_SHA256] })
      expect(serverTags(auth)).toEqual([])
    })
  })

  it('sends the event base64-encoded behind the Nostr scheme', async () => {
    const auth = await createBlossomAuth(new TestSigner(), { verb: 'delete', hashes: [HELLO_SHA256] })
    const header = blossomAuthHeader(auth)

    expect(header.startsWith('Nostr ')).toBe(true)
    expect(header.slice(6)).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(decodeAuthHeader(header)).toEqual(auth)
  })

  it('survives non-Latin1 content, which btoa would have thrown on', async () => {
    const auth = await createBlossomAuth(new TestSigner(), { verb: 'upload', content: 'Résumé 🎈' })
    expect(decodeAuthHeader(blossomAuthHeader(auth)).content).toBe('Résumé 🎈')
  })

  it('authorizes list with t=list and delete with t=delete plus the hash', async () => {
    const listStub = stubFetch(() =>
      new Response(JSON.stringify([{ url: 'https://blossom.example/x.png', sha256: HELLO_SHA256, size: 11 }]), {
        status: 200,
      }),
    )
    const blobs = await listBlobs('https://blossom.example', PUBKEY, new TestSigner(), { fetch: listStub.fetch })
    expect(listStub.calls[0]?.url).toBe(`https://blossom.example/list/${PUBKEY}`)
    expect(tagValue(decodeAuthHeader(listStub.calls[0]?.headers.Authorization ?? ''), 't')).toBe('list')
    expect(blobs[0]?.sha256).toBe(HELLO_SHA256)

    const deleteStub = stubFetch(() => new Response('', { status: 200 }))
    await deleteBlob('https://blossom.example', HELLO_SHA256, new TestSigner(), { fetch: deleteStub.fetch })
    const deleteCall = deleteStub.calls[0]
    expect(deleteCall?.method).toBe('DELETE')
    expect(deleteCall?.url).toBe(`https://blossom.example/${HELLO_SHA256}`)
    const deleteAuth = decodeAuthHeader(deleteCall?.headers.Authorization ?? '')
    expect(tagValue(deleteAuth, 't')).toBe('delete')
    expect(tagValue(deleteAuth, 'x')).toBe(HELLO_SHA256)
  })
})

describe('uploadWithMirrors', () => {
  const servers = ['https://one.example', 'https://two.example', 'https://three.example']

  it('uploads once and mirrors the URL to the rest', async () => {
    const stub = stubFetch(({ url }) => {
      const server = url.replace(/\/(upload|mirror)$/, '')
      return descriptorResponse(server, HELLO_SHA256, 11)
    })

    const result = await uploadWithMirrors(servers, bytesOf('hello world'), new TestSigner(), { fetch: stub.fetch })

    expect(stub.calls.map((call) => call.url)).toEqual([
      'https://one.example/upload',
      'https://two.example/mirror',
      'https://three.example/mirror',
    ])
    expect(JSON.parse(String(stub.calls[1]?.body))).toEqual({ url: `https://one.example/${HELLO_SHA256}.png` })
    expect(result.urls).toHaveLength(3)
    expect(result.failures).toEqual([])
    expect(result.sha256).toBe(HELLO_SHA256)
  })

  it('degrades to a partial success when a mirror fails', async () => {
    const stub = stubFetch(({ url }) => {
      if (url.startsWith('https://two.example')) {
        return new Response('', { status: 500, headers: { 'X-Reason': 'disk full' } })
      }
      return descriptorResponse(url.replace(/\/(upload|mirror)$/, ''), HELLO_SHA256, 11)
    })

    const result = await uploadWithMirrors(servers, bytesOf('hello world'), new TestSigner(), { fetch: stub.fetch })

    expect(result.urls).toEqual([
      `https://one.example/${HELLO_SHA256}.png`,
      `https://three.example/${HELLO_SHA256}.png`,
    ])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.server).toBe('https://two.example')
    expect(result.failures[0]?.error).toContain('disk full')
  })

  /** The bug that produced single-copy blobs. */
  describe('when a server cannot mirror', () => {
    /** Measured on 2026-09-01: not one Blossom server still implements BUD-04 `/mirror`. */
    it('pushes the bytes instead, so a second copy exists', async () => {
      const stub = stubFetch(({ url }) => {
        if (url.endsWith('/mirror')) return new Response('Not Found', { status: 404 })
        return descriptorResponse(url.replace(/\/upload$/, ''), HELLO_SHA256, 11)
      })
      const result = await uploadWithMirrors(servers, bytesOf('hello world'), new TestSigner(), {
        fetch: stub.fetch,
      })
      expect(result.urls).toHaveLength(2)
      // The third is reported, not paid for: `failures` is diagnostic, and "this server.
      expect(result.failures.map(failure => failure.server)).toEqual(['https://three.example'])
    })

    it('buys at most ONE fallback copy, however many servers there are', async () => {
      // A mirror is free.
      const stub = stubFetch(({ url }) => {
        if (url.endsWith('/mirror')) return new Response('Not Found', { status: 404 })
        return descriptorResponse(url.replace(/\/upload$/, ''), HELLO_SHA256, 11)
      })
      const result = await uploadWithMirrors(
        [...servers, 'https://four.example', 'https://five.example'],
        bytesOf('hello world'),
        new TestSigner(),
        { fetch: stub.fetch },
      )
      expect(result.urls).toHaveLength(2)
    })

    it('can be told not to pay for it', async () => {
      const stub = stubFetch(({ url }) => {
        if (url.endsWith('/mirror')) return new Response('Not Found', { status: 404 })
        return descriptorResponse(url.replace(/\/upload$/, ''), HELLO_SHA256, 11)
      })
      const result = await uploadWithMirrors(servers, bytesOf('hello world'), new TestSigner(), {
        fetch: stub.fetch,
        copyWhenMirrorFails: false,
      })
      expect(result.urls).toHaveLength(1)
      expect(result.failures).toHaveLength(2)
    })
  })

  it('still mirrors to a server that refused the direct upload', async () => {
    let uploadRefused = false
    const stub = stubFetch(({ url }) => {
      // One server rejects a PUSH but is happy to PULL, which is the common real case.
      if (url === 'https://one.example/upload') {
        uploadRefused = true
        return new Response('', { status: 413, headers: { 'X-Reason': 'body too large' } })
      }
      return descriptorResponse(url.replace(/\/(upload|mirror)$/, ''), HELLO_SHA256, 11)
    })

    const result = await uploadWithMirrors(servers, bytesOf('hello world'), new TestSigner(), { fetch: stub.fetch })

    expect(uploadRefused).toBe(true)
    // Uploaded to two.example, then mirrored to BOTH others.
    expect(stub.calls.map((call) => call.url)).toContain('https://one.example/mirror')
    expect(result.urls).toHaveLength(3)
  })

  it('forgets an upload failure once the mirror succeeds', async () => {
    const stub = stubFetch(({ url }) => {
      if (url === 'https://one.example/upload') return new Response('', { status: 500 })
      return descriptorResponse(url.replace(/\/(upload|mirror)$/, ''), HELLO_SHA256, 11)
    })

    const result = await uploadWithMirrors(servers, bytesOf('hello world'), new TestSigner(), { fetch: stub.fetch })

    // The bytes are on that server, so reporting it as a failure would be false.
    expect(result.failures.some((failure) => failure.server === 'https://one.example')).toBe(false)
  })

  it('survives a mirror that throws at the transport layer', async () => {
    const stub = stubFetch(({ url }) => {
      if (url.startsWith('https://two.example')) throw new Error('ECONNREFUSED')
      return descriptorResponse(url.replace(/\/(upload|mirror)$/, ''), HELLO_SHA256, 11)
    })

    const result = await uploadWithMirrors(servers, bytesOf('hello world'), new TestSigner(), { fetch: stub.fetch })
    expect(result.urls).toHaveLength(2)
    expect(result.failures[0]?.error).toContain('ECONNREFUSED')
  })

  it('promotes the next server when the first refuses the upload', async () => {
    const stub = stubFetch(({ url }) => {
      if (url === 'https://one.example/upload') return new Response('', { status: 413 })
      return descriptorResponse(url.replace(/\/(upload|mirror)$/, ''), HELLO_SHA256, 11)
    })

    const result = await uploadWithMirrors(servers, bytesOf('hello world'), new TestSigner(), { fetch: stub.fetch })

    // The refusing server is still asked to MIRROR afterwards.
    expect(stub.calls.map((call) => call.url)).toEqual([
      'https://one.example/upload',
      'https://two.example/upload',
      'https://one.example/mirror',
      'https://three.example/mirror',
    ])
    expect(result.urls).toEqual([
      `https://two.example/${HELLO_SHA256}.png`,
      `https://one.example/${HELLO_SHA256}.png`,
      `https://three.example/${HELLO_SHA256}.png`,
    ])
    // And its earlier refusal is no longer reported, because the bytes.
    expect(result.failures).toEqual([])
  })

  it('mirrors the hash the server actually stored, not the one we computed', async () => {
    // nostr.build and friends re-encode images on ingest, so the stored hash differs.
    const stored = 'a'.repeat(64)
    const stub = stubFetch(({ url }) => descriptorResponse(url.replace(/\/(upload|mirror)$/, ''), stored, 9))

    const result = await uploadWithMirrors(servers.slice(0, 2), bytesOf('hello world'), new TestSigner(), {
      fetch: stub.fetch,
    })

    expect(result.sha256).toBe(stored)
    expect(tagValue(decodeAuthHeader(stub.calls[1]?.headers.Authorization ?? ''), 'x')).toBe(stored)
  })

  it('throws only when no server accepted the blob', async () => {
    const stub = stubFetch(() => new Response('', { status: 500, headers: { 'X-Reason': 'nope' } }))
    await expect(
      uploadWithMirrors(servers, bytesOf('hello world'), new TestSigner(), { fetch: stub.fetch }),
    ).rejects.toBeInstanceOf(BlossomError)
  })
})

describe('imeta', () => {
  it('lists mirrors as fallbacks so other clients can still render the image', () => {
    const tag = buildImetaTag(
      {
        sha256: HELLO_SHA256,
        urls: ['https://one.example/a.png', 'https://two.example/a.png'],
        size: 11,
        type: 'image/png',
        failures: [],
      },
      { dim: { width: 800, height: 600 }, alt: 'a duck' },
    )

    expect(tag).toEqual([
      'imeta',
      'url https://one.example/a.png',
      'm image/png',
      `x ${HELLO_SHA256}`,
      'size 11',
      'dim 800x600',
      'alt a duck',
      'fallback https://two.example/a.png',
    ])
  })
})

describe('defaults', () => {
  it('ships the three public servers the .env documents', () => {
    expect(DEFAULT_BLOSSOM_SERVERS).toEqual([
      'https://blossom.nostr.build',
      'https://cdn.hzrd149.com',
      'https://cdn.nostrcheck.me',
    ])
  })

  it('does not depend on any one operator for a blob to survive', () => {
    // Three copies, on three operators.
    const hosts = DEFAULT_BLOSSOM_SERVERS.map(url => new URL(url).host)
    expect(new Set(hosts).size).toBe(3)
    expect(hosts.some(host => host.endsWith('example-client.test'))).toBe(false)
    /* `blossom.band` is not a fourth operator, it is nostr.build under another name. */
    expect(hosts.some(host => host.endsWith('blossom.band'))).toBe(false)
  })
})

describe('imetaDimFor', () => {
  const tag = (url: string, dim?: string): string[] =>
    ['imeta', `url ${url}`, 'm image/jpeg', ...(dim === undefined ? [] : [`dim ${dim}`])]

  it('reads the size for the matching url', () => {
    expect(imetaDimFor([tag('https://a/1.jpg', '1200x1600')], 'https://a/1.jpg')).toEqual({
      width: 1200,
      height: 1600,
    })
  })

  it('picks the right tag when a note has several images', () => {
    const tags = [tag('https://a/1.jpg', '800x600'), tag('https://a/2.jpg', '1080x1920')]
    expect(imetaDimFor(tags, 'https://a/2.jpg')).toEqual({ width: 1080, height: 1920 })
  })

  it('returns nothing when the url is not described', () => {
    expect(imetaDimFor([tag('https://a/1.jpg', '800x600')], 'https://a/other.jpg')).toBeUndefined()
  })

  it('returns nothing when the tag carries no dim', () => {
    expect(imetaDimFor([tag('https://a/1.jpg')], 'https://a/1.jpg')).toBeUndefined()
  })

  /** A zero would divide to Infinity and blow out the layout downstream. */
  it('rejects a degenerate or unparseable size', () => {
    for (const bad of ['0x600', '800x0', 'wide x tall', '800', '']) {
      expect(imetaDimFor([tag('https://a/1.jpg', bad)], 'https://a/1.jpg')).toBeUndefined()
    }
  })

  it('ignores non-imeta tags', () => {
    expect(imetaDimFor([['t', 'nostr'], ['e', 'a'.repeat(64)]], 'https://a/1.jpg')).toBeUndefined()
  })
})

describe('mediaPreset', () => {
  it('reads ordinary phone photos as landscape', () => {
    for (const ratio of [4 / 3, 3 / 2, 16 / 9, 2]) expect(mediaPreset(ratio)).toBe('landscape')
  })

  it('reads a portrait as vertical, including a full-height phone shot', () => {
    for (const ratio of [3 / 4, 4 / 5, 9 / 16, 0.5]) expect(mediaPreset(ratio)).toBe('vertical')
  })

  it('keeps near-square pictures square', () => {
    for (const ratio of [1, 0.95, 1.1]) expect(mediaPreset(ratio)).toBe('square')
  })

  /** The middle frame, so an unknown picture is never more than one step wrong. */
  it('defaults to square when the shape is not known yet', () => {
    for (const ratio of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(mediaPreset(ratio)).toBe('square')
    }
  })

  /** 4:3 is the shape of most photographs ever taken. */
  it('calls 4:3 a landscape, not a square', () => {
    expect(mediaPreset(4 / 3)).toBe('landscape')
    expect(mediaPreset(1.16)).toBe('landscape')
    expect(mediaPreset(1.14)).toBe('square')
    expect(mediaPreset(0.89)).toBe('vertical')
  })
})

describe('galleryPreset', () => {
  const portrait = 3 / 4
  const wide = 16 / 9

  it('uses the shape most of the pictures share', () => {
    expect(galleryPreset([portrait, portrait, wide])).toBe('vertical')
    expect(galleryPreset([wide, wide, portrait])).toBe('landscape')
  })

  /** A portrait in a landscape frame loses a head. */
  it('breaks a tie toward the frame that crops less badly', () => {
    expect(galleryPreset([portrait, wide])).toBe('vertical')
    expect(galleryPreset([1, wide])).toBe('square')
  })

  it('is square when nothing is known yet', () => {
    expect(galleryPreset([])).toBe('square')
    expect(galleryPreset([undefined, undefined])).toBe('square')
  })

  it('lets known shapes decide even when some are still unknown', () => {
    // Two unknowns vote square, two portraits vote vertical.
    expect(galleryPreset([portrait, portrait, undefined, undefined])).toBe('vertical')
  })
})
