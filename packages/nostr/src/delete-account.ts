import { KINDS } from './events'
import type { EventTemplate } from './types'

/** LEAVING. */

/** The profile a deleted account is left showing. */
export const DELETED_PROFILE_NAME = 'Deleted Account'

export function buildDeletedProfile(createdAt: number): EventTemplate {
  return {
    kind: KINDS.metadata,
    created_at: createdAt,
    tags: [],
    content: JSON.stringify({
      name: DELETED_PROFILE_NAME,
      display_name: DELETED_PROFILE_NAME,
      about: DELETED_PROFILE_NAME,
      deleted: true,
    }),
  }
}
