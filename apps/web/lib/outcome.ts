'use client'

import { useSyncExternalStore } from 'react'

/** What happened to a zap that was sent in the background. */

/** Somewhere the reader can go to fix it themselves. */
export interface OutcomeAction {
  /** On the button. A verb, short enough to sit inside a toast. */
  label: string
  href: string
}

export interface Outcome {
  /** Rendered to the reader. */
  message: string
  /** A failure is red and stays longer. */
  tone: 'error' | 'warning'
  /** Distinguishes two identical messages so the second one re-shows. */
  id: number
  /** Present only when there is something the reader can actually press. */
  action?: OutcomeAction
}

let current: Outcome | undefined
let next = 1
const listeners = new Set<() => void>()

function announce(message: string, tone: Outcome['tone'], action?: OutcomeAction): number {
  current = { message, tone, id: next++, action }
  for (const listener of listeners) listener()
  return current.id
}

/** Something the reader asked for that did not happen. */
export function announceProblem(message: string, action?: OutcomeAction): number {
  return announce(message, 'error', action)
}

export const announceZapFailure = announceProblem

/** It happened, but something is worth saying. */
export function announceWarning(message: string, action?: OutcomeAction): number {
  return announce(message, 'warning', action)
}

export const announceZapWarning = announceWarning

/** Take it back down. */
export function dismissOutcome(id?: number): void {
  if (id !== undefined && current?.id !== id) return
  current = undefined
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): Outcome | undefined {
  return current
}

function serverSnapshot(): undefined {
  return undefined
}

export function useOutcome(): Outcome | undefined {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}

/** The outcome currently on screen, without rendering. */
export function currentOutcome(): Outcome | undefined {
  return current
}

/* The old names, so the zap call sites read as they did. */
export const dismissZapOutcome = dismissOutcome
export const useZapOutcome = useOutcome
export const currentZapOutcome = currentOutcome
export type ZapOutcome = Outcome
