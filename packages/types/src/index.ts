/** zod contracts for data crossing a trust boundary. */

import { isHexKey, tryNormalizeRelayUrl } from '@nostrich/nostr'
import type { Hex, RelayUrl } from '@nostrich/nostr'
import { z } from 'zod'

/** A pubkey or event id: 64 lowercase hex characters. */
export const hexKeySchema: z.ZodType<Hex> = z
  .string()
  .refine(isHexKey, { message: 'expected 64 lowercase hex characters' })

/** A relay URL, normalised on the way through (wss://, no trailing slash). */
export const relayUrlSchema: z.ZodType<RelayUrl, z.ZodTypeDef, unknown> = z
  .string()
  .transform((value, ctx) => {
    const url = tryNormalizeRelayUrl(value)
    if (url === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'not a usable relay URL' })
      return z.NEVER
    }
    return url
  })

/** The session shape that survives a reload. */
/** One remembered account. */
export const storedSessionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('readonly'), pubkey: hexKeySchema }),
  z.object({ kind: z.literal('nip07'), pubkey: hexKeySchema }),
  /** An nsec encrypted under a passphrase the reader chose (NIP-49 `ncryptsec1…`). */
  z.object({ kind: z.literal('ncryptsec'), pubkey: hexKeySchema, ncryptsec: z.string().min(1) }),
  /** An nsec kept as-is, for a reader who signed in without setting a password. */
  z.object({ kind: z.literal('privatekey'), pubkey: hexKeySchema, nsec: z.string().min(1) }),
  /** A NIP-46 pairing with a remote signer, so it survives a reload. */
  z.object({
    kind: z.literal('nip46'),
    pubkey: hexKeySchema,
    // Same 64-lowercase-hex shape as a pubkey.
    clientSecretKey: hexKeySchema,
    remoteSignerPubkey: hexKeySchema,
    // Normalised on the way through, so two spellings of one relay cannot open two sockets.
    relays: z.array(relayUrlSchema).min(1).max(8),
    // Granted once at `connect` and frozen there.
    perms: z.array(z.string().max(64)).max(64).optional(),
  }),
])

export type StoredSession = z.infer<typeof storedSessionSchema>

/** Five is the product limit, enforced here AND at the point of sign-in. */
export const MAX_STORED_ACCOUNTS = 5

/** One entry, parsed on its own so that a bad one costs only itself. */
const storedSessionEntry = z
  .unknown()
  .transform(value => {
    const parsed = storedSessionSchema.safeParse(value)
    return parsed.success ? parsed.data : null
  })

/** Every account the reader has added, and which one is in front. */
export const storedAccountsSchema = z.object({
  accounts: z
    .array(storedSessionEntry)
    .transform(entries =>
      entries.filter((entry): entry is StoredSession => entry !== null).slice(0, MAX_STORED_ACCOUNTS),
    ),
  active: hexKeySchema.optional().catch(undefined),
})

export type StoredAccounts = z.infer<typeof storedAccountsSchema>

/** `/api/trending`'s payload and its conversion to Nostr events. */
export {
  toEvent,
  isWholeNote,
  parseTrendingPayload,
  type ServedNote,
  type ServedProfile,
  type TrendingPayload,
} from './trending-wire'
