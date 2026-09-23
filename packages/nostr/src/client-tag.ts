import {
  ClientAuth,
  FileMessage,
  GiftWrap,
  HTTPAuth,
  NWCWalletRequest,
  NWCWalletResponse,
  NostrConnect,
  PrivateDirectMessage,
  Seal,
} from 'nostr-tools/kinds'

import { BLOSSOM_AUTH_KIND } from './blossom'
import type { EventTemplate } from './types'

/** THE NIP-89 CLIENT TAG. */
export const CLIENT_TAG_NAME = 'nostrich'

/** Kinds that must never carry the tag. */
export const NEVER_CLIENT_TAGGED: ReadonlySet<number> = new Set<number>([
  // NIP-17 / NIP-59 direct messages: the seal, the message, the file message, the gift.
  Seal,
  PrivateDirectMessage,
  FileMessage,
  GiftWrap,
  // Credentials handed to a third-party server.
  HTTPAuth,
  BLOSSOM_AUTH_KIND,
  ClientAuth,
  // Encrypted RPC to a remote signer or wallet.
  NostrConnect,
  NWCWalletRequest,
  NWCWalletResponse,
])

/** The template, stamped. */
export function withClientTag(template: EventTemplate): EventTemplate {
  if (NEVER_CLIENT_TAGGED.has(template.kind)) return template
  if (template.tags.some(tag => tag[0] === 'client')) return template
  return { ...template, tags: [...template.tags, ['client', CLIENT_TAG_NAME]] }
}
