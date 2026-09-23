/** A working `localStorage` for tests. */

class TestStorage implements Storage {
  #entries = new Map<string, string>()

  get length(): number {
    return this.#entries.size
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.#entries.get(String(key)) ?? null
  }

  setItem(key: string, value: string): void {
    this.#entries.set(String(key), String(value))
  }

  removeItem(key: string): void {
    this.#entries.delete(String(key))
  }

  clear(): void {
    this.#entries.clear()
  }

  [name: string]: unknown
}

const install = (name: 'localStorage' | 'sessionStorage'): void => {
  const storage = new TestStorage()
  Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, { value: storage, configurable: true, writable: true })
  }
}

Object.defineProperty(globalThis, 'Storage', {
  value: TestStorage,
  configurable: true,
  writable: true,
})
install('localStorage')
install('sessionStorage')
