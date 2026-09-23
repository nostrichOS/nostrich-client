'use client'

import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_BLOSSOM_SERVERS,
  blossomOperator,
  normalizeServer,
  uploadServers,
  type Hex,
  type Signer,
} from '@nostrich/nostr'

import { blossomServersQuery } from './blossom-servers'
import { getPool } from './pool'
import { readScoped, writeScoped } from './scope'

/** The media servers an author uploads. */

export const MEDIA_SERVER_KIND = 10063

/** What a kind 10063 may carry from here. */
const MAX_SERVERS = 8

export type MediaPublishOutcome = 'ok' | 'declined' | 'error' | 'no-signer' | 'not-loaded'

export interface MediaServersApi {
  /** The list as edited here. Empty means "publishing nothing", not "use the defaults". */
  servers: string[]
  /** True once the relays have answered, so an empty list can be trusted. */
  settled: boolean
  /** THE LIST AN UPLOAD WOULD ACTUALLY WALK, in order. */
  effective: string[]
  /** True when the edits here differ from what is published. */
  dirty: boolean
  add: (url: string) => string | null
  remove: (url: string) => void
  publish: (signer: Signer) => Promise<MediaPublishOutcome>
  publishing: boolean
}

/** Two copies of a blob are only two copies if two different people are holding them. */
export function singleOperator(servers: readonly string[]): boolean {
  if (servers.length < 2) return false
  const first = blossomOperator(servers[0] as string)
  return servers.every(server => blossomOperator(server) === first)
}

/** THE READER'S OWN CHOICE OF MEDIA SERVERS, KEPT ON THIS DEVICE. */
const CHOSEN_KEY = 'nostrich:media-servers:v1'

/** The list this device has chosen, readable outside React. */
export function chosenServers(): string[] {
  return readChosenServers()
}

function readChosenServers(): string[] {
  try {
    const raw = readScoped(CHOSEN_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string').slice(0, MAX_SERVERS)
  } catch {
    return []
  }
}

function writeChosenServers(servers: readonly string[]): void {
  try {
    writeScoped(CHOSEN_KEY, JSON.stringify(servers.slice(0, MAX_SERVERS)))
  } catch {
    // Private mode.
  }
}

export function useMediaServers(pubkey: Hex | undefined): MediaServersApi {
  const client = useQueryClient()
  const [servers, setServers] = useState<string[]>(() => readChosenServers())
  const [published, setPublished] = useState<string[] | null>(null)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (pubkey === undefined) {
      setServers([])
      setPublished(null)
      return
    }
    void client
      .ensureQueryData(blossomServersQuery(pubkey))
      .then(found => {
        if (cancelled) return
        setPublished(found)
        /* A LOCAL CHOICE OUTRANKS THE RELAYS' ANSWER. */
        if (readChosenServers().length === 0) setServers(found)
      })
      .catch(() => {
        // Left unsettled on purpose: publishing over a list we could not read would delete.
      })
    return () => {
      cancelled = true
    }
  }, [client, pubkey])

  const add = useCallback((url: string): string | null => {
    const trimmed = url.trim()
    if (trimmed === '') return null
    const origin = normalizeServer(trimmed)
    if (!/^https:\/\/[^\s/]+\.[^\s/]+/i.test(origin)) return 'That does not look like a server address.'
    let message: string | null = null
    setServers(current => {
      if (current.includes(origin)) {
        message = 'That server is already on the list.'
        return current
      }
      if (current.length >= MAX_SERVERS) {
        message = `Eight servers is the most this list carries.`
        return current
      }
      const next = [...current, origin]
      writeChosenServers(next)
      return next
    })
    return message
  }, [])

  /** Removing one of OURS is allowed, and it means "adopt the rest as mine". */
  const remove = useCallback((url: string) => {
    setServers(current => {
      const next = (current.length > 0 ? current : [...DEFAULT_BLOSSOM_SERVERS]).filter(
        server => server !== url,
      )
      writeChosenServers(next)
      return next
    })
  }, [])

  const publish = useCallback(
    async (signer: Signer): Promise<MediaPublishOutcome> => {
      if (pubkey === undefined) return 'no-signer'
      // See the header: an unread list must never be replaced by an empty one.
      if (published === null) return 'not-loaded'
      setPublishing(true)
      try {
        const template = {
          kind: MEDIA_SERVER_KIND,
          created_at: Math.floor(Date.now() / 1000),
          content: '',
          tags: servers.map(server => ['server', server]),
        }
        let signed
        try {
          signed = await signer.signEvent(template as never)
        } catch {
          // A dismissed extension or bunker prompt is a decision, not a fault.
          return 'declined'
        }
        const results = await getPool().publish(signed as never)
        if (!results.some(result => result.ok)) return 'error'
        setPublished([...servers])
        // Every other surface reads this through the same query.
        client.setQueryData(blossomServersQuery(pubkey).queryKey, [...servers])
        return 'ok'
      } finally {
        setPublishing(false)
      }
    },
    [client, pubkey, published, servers],
  )

  const dirty =
    published !== null &&
    (published.length !== servers.length || published.some((server, i) => servers[i] !== server))

  return {
    servers,
    settled: published !== null,
    effective: uploadServers(servers, DEFAULT_BLOSSOM_SERVERS),
    dirty,
    add,
    remove,
    publish,
    publishing,
  }
}
