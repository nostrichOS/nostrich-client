import type { EventTemplate, NostrEvent } from '../types'

/** Did the signer sign what we asked it to sign. */

export interface TemplateMismatch {
  field: 'kind' | 'content' | 'tags'
  detail: string
}

export function templateMismatch(
  template: EventTemplate,
  signed: NostrEvent,
): TemplateMismatch | undefined {
  if (signed.kind !== template.kind) {
    return { field: 'kind', detail: `asked for kind ${template.kind}, got ${signed.kind}` }
  }

  if (signed.content !== template.content) {
    return {
      field: 'content',
      detail: `the text changed (${template.content.length} characters in, ${signed.content.length} out)`,
    }
  }

  const sent = template.tags.map(tag => tag.map(String))
  const back = Array.isArray(signed.tags) ? signed.tags.map(tag => tag.map(String)) : []
  if (JSON.stringify(sent) !== JSON.stringify(back)) {
    return { field: 'tags', detail: `${sent.length} tags in, ${back.length} out, and not the same` }
  }

  return undefined
}
