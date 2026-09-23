import { getTagValues } from './events'
import { hostOf, underDomain } from './hosts'
import { parseNip05 } from './nip05'
import type { Hex, NostrEvent } from './types'

/** THE SPAM RULES THAT ARE PURE. */

/** Accounts kept out of discovery by hand. */
const BLOCKED: { pubkey: Hex; note: string }[] = [
  /* ONE SYNTHETIC ENTRY, so the mechanism has something to prove itself. */
  { pubkey: ('2'.repeat(64)) as Hex, note: 'Example entry, replace with a real one.' },
]

/** Tags we never PROMOTE. */
const NEVER_PROMOTED = new Set<string>(['nsfw', 'porn', 'xxx'])

/** Whether a hashtag may appear in a list WE compose. */
export function isPromotableTag(tag: string): boolean {
  return !NEVER_PROMOTED.has(tag.toLowerCase().trim())
}

/** Whether a note may appear on a surface we curate. */
export function isPromotable(event: NostrEvent): boolean {
  return !event.tags.some(tag => tag[0] === 't' && !isPromotableTag(tag[1] ?? ''))
}

/** Accounts kept off the CHARTS, and off nothing else. */
const NOT_TRENDING: { pubkey: Hex; note: string }[] = [
  // Synthetic, as in BLOCKED above: charts only, never the wider surfaces.
  { pubkey: ('1'.repeat(64)) as Hex, note: 'Example entry, replace with a real one.' },
]

const notTrending = new Set<string>(NOT_TRENDING.map(entry => entry.pubkey))

/** On the charts-only exclusion list. */
export function isExcludedFromTrending(pubkey: Hex): boolean {
  return notTrending.has(pubkey)
}

/** Handles that say what the account. */
const ADULT_FRAGMENTS: readonly string[] = [
  'porn',
  'hentai',
  'nsfw',
  'onlyfans',
  'fansly',
  'xhamster',
  'xvideos',
  'camgirl',
  'camslut',
  'sexcam',
  'camsex',
  'sexwork',
  'cumshot',
  'blowjob',
  'deepthroat',
  'bigtits',
  'titties',
  'boobs',
  'nudes',
  'erotic',
  'ahegao',
  'rule34',
  'bdsm',
  'fetish',
  'bukkake',
  'creampie',
  'gangbang',
  'pussy',
  'pedophil',
]

/** Ambiguous as substrings, unambiguous as a word on their own. */
const ADULT_WORDS: ReadonlySet<string> = new Set([
  'anal',
  'sex',
  'ass',
  'cum',
  'tits',
  'nude',
  'naked',
  'xxx',
  'milf',
  'escort',
  'escorts',
  'stripper',
  'slut',
  'whore',
  'lewd',
  'lewds',
  'incest',
  'rape',
  'rapist',
  'pedo',
  // "Bad wording".
  'fuck',
  'fucks',
  'fucker',
  'fuckers',
  'fucking',
  'shit',
  'bullshit',
  'bitch',
  'bitches',
  'cunt',
  'faggot',
  'nigger',
  'nigga',
])

/** `🔞`, and the `18+` that survives having its digits stripped. */
const ADULT_MARKS = /🔞|\b18\s*\+/u

/** Leetspeak, folded before either list runs. */
const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
}

function fold(value: string): string {
  return (
    value
      // NFKD splits accents off their letters and unpacks the fullwidth and math-styled.
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/[013457@$!|]/gu, character => LEET[character] ?? character)
  )
}

/** Whether a single name, handle or NIP-05 announces adult content. */
export function isAdultName(value: string): boolean {
  if (value.trim() === '') return false
  if (ADULT_MARKS.test(value)) return true

  const folded = fold(value)
  // Everything that is not a letter goes, so separators cannot break a word up.
  const flat = folded.replace(/[^a-z]+/gu, '')
  if (ADULT_FRAGMENTS.some(fragment => flat.includes(fragment))) return true

  return folded.split(/[^a-z]+/u).some(token => token !== '' && ADULT_WORDS.has(token))
}

/** The same question asked of a whole profile: display name, handle, and NIP-05 claim. */
export function hasAdultName(
  profile: { name?: string; displayName?: string; nip05?: string } | null | undefined,
): boolean {
  if (profile === null || profile === undefined) return false
  return [profile.displayName, profile.name, profile.nip05].some(
    value => value !== undefined && isAdultName(value),
  )
}

/** Word sets that identify one spam operation by the NAME it insists on wearing. */
// Synthetic pair.
const SUPPRESSED_NAME_PAIRS: readonly (readonly string[])[] = [['example', 'placeholder']]

/** Whether one name, handle or NIP-05 carries a full word set. */
export function isSuppressedName(value: string): boolean {
  if (value.trim() === '') return false
  // Same flattening the adult-name rule uses: separators cannot break a word up.
  const flat = fold(value).replace(/[^a-z]+/gu, '')
  if (flat === '') return false
  return SUPPRESSED_NAME_PAIRS.some(words => words.every(word => flat.includes(word)))
}

/** The same question asked of a whole profile: display name, handle, and NIP-05 claim. */
export function hasSuppressedName(
  profile: { name?: string; displayName?: string; nip05?: string } | null | undefined,
): boolean {
  if (profile === null || profile === undefined) return false
  return [profile.displayName, profile.name, profile.nip05].some(
    value => value !== undefined && isSuppressedName(value),
  )
}

/** Accounts that do not exist in this client. */
const SUPPRESSED: { pubkey: Hex; note: string }[] = [
  // Synthetic, as in BLOCKED above.
  { pubkey: ('3'.repeat(64)) as Hex, note: 'Example entry, replace with a real one.' },
]

/** Domains whose links are suppressed unless the author is NIP-05 verified. */
const PHISHING_DOMAINS = new Set<string>([
  // Synthetic.
  'example-phishing.test',

])

/** Whether the note links to one of them. */
export function linksToPhishingDomain(event: NostrEvent): boolean {
  const urls = event.content.match(/https?:\/\/[^\s<>"')]+/g)
  if (urls === null) return false
  for (const raw of urls) {
    const host = hostOf(raw)
    if (host !== undefined && underDomain(host, PHISHING_DOMAINS)) return true
  }
  return false
}

/** CAMPAIGN DOMAINS. */
const CAMPAIGN_DOMAINS: ReadonlySet<string> = new Set<string>([
  // Synthetic.
  'example-campaign.test',

])

/** Domains that may NEVER be listed above. */
const NEVER_CAMPAIGN: ReadonlySet<string> = new Set<string>([
  'substack.com', 'medium.com', 'ghost.io', 'blogger.com', 'wordpress.com', 'notion.site',
  'github.com', 'github.io', 'gitlab.com', 'pages.dev', 'netlify.app', 'vercel.app',
  'linktr.ee', 'bento.me', 'beacons.ai', 'bit.ly', 't.co', 'tinyurl.com',
  'youtube.com', 'rumble.com', 't.me', 'x.com', 'mastodon.social', 'mostr.pub',
  'nostr.build', 'example-client.test', 'example-client.test', 'example-client.test', 'njump.me', 'nostrcheck.me',
  'nostrplebs.com', 'zap.stream', 'fountain.fm', 'stacker.news', 'nostrich.org',
])

for (const domain of CAMPAIGN_DOMAINS) {
  if (NEVER_CAMPAIGN.has(domain)) {
    throw new Error(
      `spam-rules: "${domain}" is a platform, not a campaign. See NEVER_CAMPAIGN, a domain ` +
        'thousands of ordinary accounts advertise cannot be listed, whatever one of them is doing.',
    )
  }
}

/** Does a listed domain appear in this field at all. */
function mentionsAny(value: string | undefined, domains: ReadonlySet<string>): boolean {
  if (value === undefined || value === '') return false
  const lower = value.toLowerCase()
  for (const domain of domains) if (lower.includes(domain)) return true
  return false
}

/** Whether this account CLAIMS a listed campaign domain as its own. */
export function advertisesCampaignDomain(
  profile: { website?: string; banner?: string; nip05?: string } | null | undefined,
): boolean {
  if (profile === null || profile === undefined) return false

  for (const field of [profile.website, profile.banner]) {
    if (!mentionsAny(field, CAMPAIGN_DOMAINS)) continue
    const host = hostOf(field)
    if (host !== undefined && underDomain(host, CAMPAIGN_DOMAINS)) return true
  }

  // The domain half of the claim, through the parser this package already.
  if (mentionsAny(profile.nip05, CAMPAIGN_DOMAINS)) {
    const claim = parseNip05(profile.nip05)
    if (claim !== null && underDomain(claim.domain, CAMPAIGN_DOMAINS)) return true
  }

  return false
}

const suppressed = new Set<string>(SUPPRESSED.map(entry => entry.pubkey))

/** Whether this account's events are dropped entirely. */
export function isSuppressed(pubkey: Hex): boolean {
  return suppressed.has(pubkey)
}

/** Nothing from a suppressed account reaches a screen, whatever kind. */

const blocked = new Set<string>(BLOCKED.map(entry => entry.pubkey))

/** On the hand-maintained list. */
export function isBlockedFromDiscovery(pubkey: Hex): boolean {
  // Suppressed accounts are blocked too, by definition.
  return blocked.has(pubkey) || suppressed.has(pubkey)
}

/** A fingerprint for "several accounts posted the same thing". */
const SIGNATURE_CHARS = 24

const MIN_TEMPLATED_LENGTH = 150

export function bodySignature(content: string): string | undefined {
  const normalized = content.replace(/\s+/g, ' ').trim().toLowerCase()
  if (normalized.length < MIN_TEMPLATED_LENGTH) return undefined
  return normalized.slice(0, SIGNATURE_CHARS)
}
