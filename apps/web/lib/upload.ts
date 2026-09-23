'use client'

import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  BlossomError,
  DEFAULT_BLOSSOM_SERVERS,
  buildImetaTag,
  uploadServers,
  uploadWithMirrors,
  type Hex,
  type Signer,
  type UploadResult,
} from '@nostrich/nostr'

import { blossomServersQuery } from './blossom-servers'
import { mediaGateMessage, mediaKindOf, type MediaVerdict } from './media-gate'
import { useMediaGate } from './use-media-gate'
import { chosenServers } from './media-servers'

/** Attaching a photo or a video to a note. */

/** 20 MiB, refused before a byte leaves the device. */
const MAX_BYTES = 20 * 1024 * 1024

/** 100 MiB, for a reader uploading to a server they chose themselves. */
const MAX_BYTES_OWN = 100 * 1024 * 1024

/** Which ceiling applies, decided from the servers this upload is ACTUALLY going. */
function limitFor(targets: readonly string[]): number {
  const ours = new Set(DEFAULT_BLOSSOM_SERVERS.map(server => server.replace(/\/+$/, '')))
  const mine = targets.some(server => !ours.has(server.replace(/\/+$/, '')))
  return mine ? MAX_BYTES_OWN : MAX_BYTES
}

export interface Attachment {
  /** Stable id for React keys and removal. */
  id: string
  file: File
  /** Object URL for the local preview. */
  preview: string
  status: 'uploading' | 'done' | 'failed'
  result?: UploadResult
  error?: string
  /** Every server's own rejection, for the tile's tooltip and the console. */
  detail?: string
}

/** Whether this surface is subject to the posting gate. */
export type UploadGate = 'post' | 'exempt'

export interface UploadOptions {
  gate?: UploadGate
}

export interface UploadApi {
  attachments: Attachment[]
  add: (files: FileList | File[], signer: Signer) => void
  /** Why the last `add` was refused, or undefined. */
  refusal: string | undefined
  /** The gate's verdict for a kind, for a control that wants to explain itself. */
  gateVerdict: (kind: 'image' | 'video') => MediaVerdict
  remove: (id: string) => void
  clear: () => void
  /** URLs to append to the note body, in the order they were attached. */
  urls: string[]
  /** NIP-92 `imeta` tags for the finished uploads. */
  imetaTags: string[][]
  busy: boolean
}

export function useUploads(options: UploadOptions = {}): UploadApi {
  const gate = options.gate ?? 'post'
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const client = useQueryClient()
  const mediaGateApi = useMediaGate()

  /** Where this signer's blobs should go, their own servers first. */
  const resolveTargets = useCallback(
    async (signer: Signer): Promise<string[]> => {
      try {
        const pubkey = (await signer.getPublicKey()) as Hex

        /* THE LOCAL CHOICE FIRST, because publishing can be refused. */
        const chosen = chosenServers()
        if (chosen.length > 0) return uploadServers(chosen, DEFAULT_BLOSSOM_SERVERS)

        /* AN EMPTY ANSWER IS REFETCHED, NEVER TRUSTED FROM CACHE. */
        const cached = client.getQueryData<string[]>(blossomServersQuery(pubkey).queryKey)
        const mine =
          cached !== undefined && cached.length > 0
            ? cached
            : await client.fetchQuery(blossomServersQuery(pubkey))
        return uploadServers(mine, DEFAULT_BLOSSOM_SERVERS)
      } catch {
        // No key, or the relays did not answer.
        return [...DEFAULT_BLOSSOM_SERVERS]
      }
    },
    [client],
  )

  const remove = useCallback((id: string) => {
    setAttachments(current => {
      const going = current.find(a => a.id === id)
      if (going !== undefined) URL.revokeObjectURL(going.preview)
      return current.filter(a => a.id !== id)
    })
  }, [])

  const clear = useCallback(() => {
    setAttachments(current => {
      for (const a of current) URL.revokeObjectURL(a.preview)
      return []
    })
  }, [])

  const add = useCallback((files: FileList | File[], signer: Signer) => {
    const list = Array.from(files)
    if (list.length === 0) return

    /* THE GATE, AT THE ONE PLACE EVERY ATTACHMENT PASSES. */
    if (gate === 'post') {
      const verdict = mediaGateApi.check(list)
      if (!verdict.ok) {
        setRefusal(mediaGateMessage(verdict, mediaKindOf(list[0] as File)))
        return
      }
    }
    setRefusal(undefined)

    for (const file of list) {
      const id = `${file.name}:${file.size}:${Math.random().toString(36).slice(2, 8)}`
      const preview = URL.createObjectURL(file)

      /* The one rejection that needs no lookup: past the HIGHEST ceiling any destination. */
      if (file.size > MAX_BYTES_OWN) {
        setAttachments(current => [
          ...current,
          { id, file, preview, status: 'failed', error: 'Larger than 100 MB.' },
        ])
        continue
      }

      setAttachments(current => [...current, { id, file, preview, status: 'uploading' }])

      /* THE AUTHOR'S OWN SERVERS FIRST. */
      void resolveTargets(signer)
        .then(async servers => {
          /* SIZE CHECKED HERE, not before, because the ceiling depends on WHERE this is going. */
          const limit = limitFor(servers)
          if (file.size > limit) {
            const mb = Math.round(limit / (1024 * 1024))
            throw new Error(`Larger than ${mb} MB.`)
          }
          return uploadWithMirrors(servers, file, signer)
        })
        .then(result => {
          setAttachments(current =>
            // Functional update throughout: several uploads finish out of order, and a closure.
            current.map(a => (a.id === id ? { ...a, status: 'done' as const, result } : a)),
          )
        })
        .catch((cause: unknown) => {
          /** THE REASON THE SERVERS GAVE, not just the fact that they all said. */
          if (cause instanceof BlossomError && cause.reason !== undefined) {
            console.error('[upload] every Blossom server refused:', cause.reason)
          }
          const detail = cause instanceof BlossomError ? cause.reason : undefined
          const message = cause instanceof Error ? cause.message : 'Upload failed.'
          setAttachments(current =>
            current.map(a =>
              a.id === id
                ? { ...a, status: 'failed' as const, error: message, ...(detail === undefined ? {} : { detail }) }
                : a,
            ),
          )
        })
    }
  }, [gate, mediaGateApi])

  const done = attachments.filter(a => a.status === 'done' && a.result !== undefined)

  return {
    attachments,
    add,
    remove,
    clear,
    refusal,
    gateVerdict: mediaGateApi.verdictFor,
    // First URL only.
    urls: done.map(a => a.result?.urls[0]).filter((url): url is string => url !== undefined),
    imetaTags: done.flatMap(a => (a.result === undefined ? [] : [buildImetaTag(a.result)])),
    busy: attachments.some(a => a.status === 'uploading'),
  }
}
