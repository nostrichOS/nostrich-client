import { describe, expect, it, vi } from 'vitest'

import { browserStore, getStore, installStore, memoryStore } from './store'

describe('the synchronous store', () => {
  it('reads back what it wrote, in the same tick', () => {
    // The property the whole design exists for: a profile written during one render.
    const store = memoryStore()
    store.set('a', '1')
    expect(store.get('a')).toBe('1')
  })

  it('misses rather than throws before a host installs one', () => {
    expect(getStore().get('nothing-here')).toBeNull()
  })

  it('is swappable, so a test never touches the real one', () => {
    const store = memoryStore({ seeded: 'yes' })
    installStore(store)
    expect(getStore().get('seeded')).toBe('yes')
    installStore(memoryStore())
  })

  describe('browserStore', () => {
    it('treats a throwing localStorage as an empty one', () => {
      // Safari in a private window throws on `setItem` once the quota is reached.
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('SecurityError')
        },
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
        removeItem: () => {
          throw new Error('nope')
        },
      })
      const store = browserStore()
      expect(store.get('k')).toBeNull()
      expect(() => store.set('k', 'v')).not.toThrow()
      expect(() => store.remove('k')).not.toThrow()
      vi.unstubAllGlobals()
    })

    it('survives having no localStorage at all', () => {
      vi.stubGlobal('localStorage', undefined)
      expect(browserStore().get('k')).toBeNull()
      vi.unstubAllGlobals()
    })
  })
})
