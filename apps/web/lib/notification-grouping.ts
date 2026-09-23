'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'

import type { NotificationItem } from './notifications'
import {
  reactionFlavour,
  summariseMarks,
  type ReactionFlavour,
  type ReactionMark,
} from './reactions'
import { onScopedChange, readScoped, writeScoped } from './scope'
import { GROUPING_KEY as KEY } from './settings-keys'

/** Collapsing a run of identical notifications into one row. */

/** How many faces a group shows before it stops adding them. */
export const MAX_FACES = 8

export interface NotificationGroup {
  /** Stable across renders: the kind, the note it concerns, and nothing else. */
  key: string
  kind: NotificationItem['kind']
  /** Newest first. The first is the one named in the sentence. */
  items: NotificationItem[]
  /** The newest member's time, so a group sorts by its most recent activity. */
  createdAt: number
  /** Summed across the group. */
  totalSats?: number
  /** At least one zap in this group was not confirmed by the reader's lightning server. */
  unsettled?: boolean
  /** `kind === 'reaction'` only: which of NIP-25's three shapes this row. */
  flavour?: ReactionFlavour
  /** `flavour === 'emoji'` only: the distinct marks, most-sent first. */
  marks?: ReactionMark[]
  /** `flavour === 'emoji'` only: how many distinct marks did not fit. */
  moreMarks?: number
}

/** What may collapse together. */
function groupKeyOf(item: NotificationItem): string | undefined {
  switch (item.kind) {
    case 'reaction': {
      /** Keyed by the note AND by what was sent, so a 🤙 never lands in a row that says. */
      if (item.targetId === undefined) return undefined
      return `reaction:${reactionFlavour(item.content)}:${item.targetId}`
    }
    case 'repost':
    case 'zap':
    case 'bookmark':
      // Keyed by the NOTE. Two people liking different notes is two facts, not one.
      return item.targetId === undefined ? undefined : `${item.kind}:${item.targetId}`
    case 'follow': {
      /** Grouped by DAY, not globally. */
      const when = new Date(item.createdAt * 1_000)
      return `follow:${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`
    }
    default:
      return undefined
  }
}

export function groupNotifications(items: NotificationItem[]): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>()
  const out: NotificationGroup[] = []

  for (const item of items) {
    const key = groupKeyOf(item)
    if (key === undefined) {
      // Ungrouped: its own group of one, so the renderer has a single shape to deal.
      out.push({ key: item.id, kind: item.kind, items: [item], createdAt: item.createdAt })
      continue
    }
    const held = groups.get(key)
    if (held === undefined) {
      const group: NotificationGroup = {
        key,
        kind: item.kind,
        items: [item],
        createdAt: item.createdAt,
        ...(item.amountSats === undefined ? {} : { totalSats: item.amountSats }),
        ...(item.unsettled === true ? { unsettled: true } : {}),
      }
      groups.set(key, group)
      out.push(group)
      continue
    }
    held.items.push(item)
    // The group carries its NEWEST time, so recent activity floats it back up the page.
    if (item.createdAt > held.createdAt) held.createdAt = item.createdAt
    if (item.amountSats !== undefined) held.totalSats = (held.totalSats ?? 0) + item.amountSats
    if (item.unsettled === true) held.unsettled = true
  }

  /* The marks, in a second pass. */
  for (const group of out) {
    if (group.kind !== 'reaction') continue
    const flavour = reactionFlavour(group.items[0]?.content)
    group.flavour = flavour
    if (flavour !== 'emoji') continue
    const { marks, more } = summariseMarks(
      // A reaction always carries its event.
      group.items.map(item => ({ content: item.content, tags: item.event?.tags ?? [] })),
    )
    group.marks = marks
    if (more > 0) group.moreMarks = more
  }

  /* Ties broken by key, for the same reason the item sort breaks them by id. */
  return out.sort(
    (a, b) => b.createdAt - a.createdAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )
}

/** "Alice", "Alice and Bob", "Alice and 7 others". */
export function actorSentence(names: string[], total: number): string {
  const [first, second] = names
  if (total <= 1) return first ?? 'Someone'
  if (total === 2) return `${first ?? 'Someone'} and ${second ?? 'someone'}`
  return `${first ?? 'Someone'} and ${(total - 1).toLocaleString()} others`
}

// ---------------------------------------------------------------------------.

/** See `read`. */
const DEFAULT_GROUPED = true

let enabled: boolean | undefined
const listeners = new Set<() => void>()
let version = 0

/** ON by default. */
function read(): boolean {
  if (enabled !== undefined) return enabled
  if (typeof window === 'undefined') return DEFAULT_GROUPED
  // Absent means never chosen, which now means grouped.
  const stored = readScoped(KEY)
  enabled = stored === null ? DEFAULT_GROUPED : stored === '1'
  return enabled
}

onScopedChange(base => {
  if (base !== undefined && base !== KEY) return
  enabled = undefined
  version += 1
  for (const listener of listeners) listener()
})

export function useGroupNotifications(): [boolean, (next: boolean) => void] {
  useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
    () => 0,
  )

  const set = useCallback((next: boolean) => {
    enabled = next
    writeScoped(KEY, next ? '1' : '0')
    version += 1
    for (const listener of listeners) listener()
  }, [])

  return [typeof window === 'undefined' ? DEFAULT_GROUPED : read(), set]
}

export interface NotificationRowData {
  /** Present only when this row collapses more than one item. */
  group: NotificationGroup | undefined
  item: NotificationItem
}

/** One list of rows, honouring the reader's grouping preference. */
export function useNotificationRows(items: readonly NotificationItem[]): NotificationRowData[] {
  const [grouped] = useGroupNotifications()
  return useMemo(() => {
    if (!grouped) return items.map(item => ({ group: undefined, item }))
    return groupNotifications([...items]).map(group =>
      group.items.length > 1
        ? { group, item: group.items[0] as NotificationItem }
        : { group: undefined, item: group.items[0] as NotificationItem },
    )
  }, [grouped, items])
}
