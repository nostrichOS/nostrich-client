import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { chosenServers, singleOperator } from './media-servers'
import { writeScoped } from './scope'

/** A reader could not upload at all. */
const upload = readFileSync(join(__dirname, 'upload.ts'), 'utf8')
const settings = readFileSync(join(__dirname, '..', 'components', 'SettingsScreen.tsx'), 'utf8')
const composer = readFileSync(join(__dirname, '..', 'components', 'Composer.tsx'), 'utf8')
const reply = readFileSync(join(__dirname, '..', 'components', 'ReplyComposer.tsx'), 'utf8')

describe('singleOperator', () => {
  it('spots a list that looks like two copies and is one', () => {
    // The commonest shape: somebody's own blossom.band bucket plus the service behind.
    expect(singleOperator(['https://birobela.blossom.band', 'https://blossom.nostr.build'])).toBe(true)
  })

  it('is quiet about a genuinely independent pair', () => {
    expect(singleOperator(['https://birobela.blossom.band', 'https://cdn.hzrd149.com'])).toBe(false)
  })

  it('says nothing at all about a single server', () => {
    // One server is one copy and the reader knows.
    expect(singleOperator(['https://cdn.hzrd149.com'])).toBe(false)
    expect(singleOperator([])).toBe(false)
  })
})

describe('uploads honour the author’s own servers', () => {
  it('no longer uploads to the defaults and nothing else', () => {
    expect(upload).not.toContain('uploadWithMirrors([...DEFAULT_BLOSSOM_SERVERS], file, signer)')
  })

  it('orders the targets with the author’s list first', () => {
    expect(upload).toContain('uploadServers(mine, DEFAULT_BLOSSOM_SERVERS)')
  })

  it('reads that list through the SHARED query, not a second copy of it', () => {
    // A second definition would drift from the one the image fallback uses, and re-ask.
    expect(upload).toContain('blossomServersQuery(pubkey)')
  })

  it('still uploads when the relays cannot be reached', () => {
    // A preference lookup failing must never mean a photo cannot be posted.
    expect(upload).toContain('return [...DEFAULT_BLOSSOM_SERVERS]')
  })

  it('keeps the 20 MiB free-tier guard, which fails with its own words', () => {
    /* The number is now computed from the DESTINATION. */
    expect(upload).toContain('const MAX_BYTES = 20 * 1024 * 1024')
    expect(upload).toContain('Larger than ${mb} MB.')
  })
})

describe('the reader can see and change it', () => {
  it('renders the media servers beside relays in Settings', () => {
    expect(settings).toContain('<MediaServerSettings />')
    expect(settings).toContain('<RelaySettings />')
  })
})

describe('the defaults are removable', () => {
  const media = readFileSync(join(__dirname, 'media-servers.ts'), 'utf8')
  const ui = readFileSync(join(__dirname, '..', 'components', 'MediaServerSettings.tsx'), 'utf8')

  it('removing one of ours adopts the rest as the reader’s own list', () => {
    // Otherwise the rows read as our list rather than theirs, and the delete button lies.
    expect(media).toContain("(current.length > 0 ? current : [...DEFAULT_BLOSSOM_SERVERS]).filter")
  })

  it('does not disable the delete button on a default row', () => {
    expect(ui).not.toContain('disabled={!mine}')
  })

  it('does not label the top row, its position already says it', () => {
    expect(ui).not.toContain('first\n')
  })

  it('labels our fallbacks ONLY once the reader has a list of their own', () => {
    // Every row being one of ours is the starting state.
    expect(ui).toContain('chosenAny && !mine')
  })

  it('lists the upload’s real destinations rather than only the reader’s own', () => {
    // A reader with one custom server saw one row while three servers were used.
    expect(media).toContain('effective: uploadServers(servers, DEFAULT_BLOSSOM_SERVERS)')
  })
})

describe('the chosen list survives, and the uploader can see it', () => {
  it('is empty when nothing has been chosen', () => {
    // The safe default: fall through to the published list, then to ours.
    expect(chosenServers()).toEqual([])
  })

  it('is readable outside React, which is where the uploader lives', () => {
    /* IT USED TO LIVE IN COMPONENT STATE AND NOWHERE ELSE. */
    writeScoped('nostrich:media-servers:v1', JSON.stringify(['https://birobela.blossom.band']))
    expect(chosenServers()).toEqual(['https://birobela.blossom.band'])
  })

  it('survives anything unparseable in storage', () => {
    writeScoped('nostrich:media-servers:v1', 'not json')
    expect(chosenServers()).toEqual([])
  })
})

describe('uploads no longer trust an hour-old “nothing published”', () => {
  it('prefers the locally chosen list over the published one', () => {
    // A publish needs a signature that can be refused.
    expect(upload).toContain('chosenServers()')
  })

  it('refetches rather than serving an empty list from cache', () => {
    /* `blossomServersQuery` holds its answer for an hour and caches "nothing published". */
    expect(upload).toContain('client.fetchQuery(blossomServersQuery(pubkey))')
  })
})

describe('the size ceiling follows the destination', () => {
  it('no longer applies one flat limit before knowing where the file is going', () => {
    /* 20 MiB is the public hosts' FREE TIER, and free is what everybody is there. */
    expect(upload).toContain('MAX_BYTES_OWN')
    expect(upload).toContain('limitFor(servers)')
  })

  it('still rejects the absurd case instantly, with no lookup', () => {
    // Past the highest ceiling any destination has, nothing can accept.
    expect(upload).toContain('file.size > MAX_BYTES_OWN')
  })
})

describe('a pasted-only draft can actually be posted', () => {
  /* THE REGRESSION THE PREVIEW WORK CREATED. */
  it('counts lifted media, links and quote pointers in the note composer', () => {
    expect(composer).toContain('media.attached.length > 0')
    expect(composer).toContain('attached.url !== undefined')
    expect(composer).toContain('pasted.attached !== undefined')
  })

  it('counts them in the reply composer too', () => {
    expect(reply).toContain('media.attached.length > 0')
    expect(reply).toContain('attached.url !== undefined')
    expect(reply).toContain('pasted.attached !== undefined')
  })

  it('lifts the quote through the writer the modal host mirrors', () => {
    // `setBody`, not `setContent`.
    expect(composer).toContain('useAttachedQuote(content, setBody, quoting === undefined)')
  })
})
