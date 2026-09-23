/** WHAT TO CALL AN ADDRESSABLE EVENT NOBODY HAS RESOLVED YET. */

/** NIP-53 live event. */
const LIVE_EVENT = 30311
/** NIP-23 long-form, published and draft. */
const LONG_FORM = 30023
const LONG_FORM_DRAFT = 30024
/** NIP-99 classified listing. */
const CLASSIFIED = 30402
/** NIP-51 lists that carry a `d` somebody chose. */
const FOLLOW_SET = 30000
const GENERIC_LIST = 30001
const RELAY_SET = 30003

export interface AddressLike {
  kind: number
  identifier: string
  bech32: string
}

/** The label, in the reader's terms. */
export function addressLabel(segment: AddressLike): string {
  const identifier = segment.identifier.trim()
  switch (segment.kind) {
    case LIVE_EVENT:
      return 'Live stream'
    case LONG_FORM:
    case LONG_FORM_DRAFT:
      return identifier === '' ? 'Article' : identifier
    case CLASSIFIED:
      return identifier === '' ? 'Listing' : identifier
    case FOLLOW_SET:
    case GENERIC_LIST:
    case RELAY_SET:
      return identifier === '' ? 'List' : identifier
    default:
      /* An unknown kind falls back to the identifier, and only then to the pointer. */
      return identifier === '' ? `${segment.bech32.slice(0, 14)}…` : identifier
  }
}
