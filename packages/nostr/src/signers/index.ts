import type { Signer } from '../types'
import { Nip07Signer } from './nip07'
import { Nip46Signer } from './nip46'
import { PrivateKeySigner } from './privatekey'

export { PrivateKeySigner, SignerDisposedError } from './privatekey'
export {
  Nip07Signer,
  Nip07MissingCapabilityError,
  Nip07RejectedError,
  Nip07UnavailableError,
  isNip07Available,
  nip07SupportsNip44,
  type Nip07Provider,
} from './nip07'
export {
  Nip46Signer,
  Nip46Error,
  Nip46RemoteError,
  Nip46TimeoutError,
  createNostrConnectInvite,
  parseNostrConnectUri,
  type Nip46SignerOptions,
  type NostrConnectInvite,
  type NostrConnectOptions,
  type NostrConnectPointer,
} from './nip46'

export type AnySigner = PrivateKeySigner | Nip07Signer | Nip46Signer

/** Fills in the settings screen's account row, which only ever holds a Signer. */
export function signerLabel(signer: Signer): string {
  switch (signer.kind) {
    case 'privatekey':
      return 'Private key on this device'
    case 'nip07':
      return 'Browser extension'
    case 'nip46':
      return 'Remote signer'
  }
}
