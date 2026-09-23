import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'

import { INPUT_BASE } from './styles'

/** iOS ZOOMS INTO ANY FIELD SMALLER THAN 16px, AND DOES NOT ZOOM BACK OUT. */
const MIN = 16

describe('every field a thumb can focus is at least 16px', () => {
  it('INPUT_BASE is, and it is the shared one', () => {
    const size = /text-\[(\d+)px\]/.exec(INPUT_BASE)
    expect(size).not.toBeNull()
    expect(Number(size?.[1])).toBeGreaterThanOrEqual(MIN)
  })

  it('INPUT_BASE does not use a Tailwind size step, which is how it went wrong', () => {
    // `text-sm` reads as "small text" and means "zooms on iOS".
    expect(INPUT_BASE).not.toMatch(/(?<![\w-])text-(xs|sm)(?![\w-])/)
  })

  /** And every OTHER input in the app, because the constant only covers nine files. */
  it('no component sets a font size under 16px on an input or textarea', () => {
    const dir = join(__dirname, '..', 'components')
    const offenders: string[] = []
    for (const file of readdirSync(dir).filter(name => name.endsWith('.tsx'))) {
      const source = readFileSync(join(dir, file), 'utf8')
      for (const tag of fieldTags(source)) {
        const type = /type="(\w+)"/.exec(tag)?.[1]
        // A checkbox, radio or file button is never typed into, so it never triggers the zoom.
        if (type === 'checkbox' || type === 'radio' || type === 'file') continue
        const styles = tag + resolvedConstants(tag, source)
        const px = /text-\[(\d+)px\]/.exec(styles)
        if (px !== null && Number(px[1]) < MIN) {
          offenders.push(`${file}: text-[${px[1]}px]`)
        }
        if (/(?<![\w-])text-(xs|sm)(?![\w-])/.test(styles)) {
          offenders.push(`${file}: text-xs/sm on a field`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

/** EVERY `<input>` AND `<textarea>`, INCLUDING THE ONES WITH HANDLERS ON THEM. */
function fieldTags(source: string): string[] {
  const tags: string[] = []
  for (const open of source.matchAll(/<(input|textarea)\b/g)) {
    const from = open.index ?? 0
    let depth = 0
    for (let i = from; i < source.length; i += 1) {
      const c = source[i]
      if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      else if (c === '>' && depth === 0) {
        tags.push(source.slice(from, i + 1))
        break
      }
    }
  }
  return tags
}

function resolvedConstants(tag: string, source: string): string {
  const shared = readFileSync(join(__dirname, 'styles.ts'), 'utf8')
  let out = ''
  for (const ref of tag.matchAll(/\$\{\s*([A-Z][A-Z0-9_]*)\s*\}/g)) {
    const name = ref[1]
    // `const NAME = '...'` or a template literal, possibly wrapped onto the next line.
    const decl = new RegExp(`const ${name}\\s*=\\s*\\n?\\s*([\`'"][^\`'"]*[\`'"])`)
    out += decl.exec(source)?.[1] ?? decl.exec(shared)?.[1] ?? ''
  }
  return out
}

describe('the app does not pinch-zoom, and a browser still does', () => {
  const shell = readFileSync(join(__dirname, 'native-shell.ts'), 'utf8')
  const appShell = readFileSync(join(__dirname, '..', 'components', 'AppShell.tsx'), 'utf8')

  it('locks the pinch with touch-action', () => {
    expect(shell).toContain("root.style.touchAction = 'pan-x pan-y'")
  })

  it('does NOT reach for a viewport tag', () => {
    /* Two reasons, both already learned here. */
    // Asserted against the CODE, not the file: the comment above the hook explains.
    const code = shell.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(code).not.toContain('user-scalable')
    expect(code).not.toContain('maximum-scale')
    expect(code).not.toContain('viewport')
  })

  it('only applies inside the app', () => {
    // A reader on nostrich.org in Safari is entitled to pinch a photo.
    const hook = shell.slice(shell.indexOf('export function useNativeShellZoomLock'))
    expect(hook).toContain('if (!isNativeShell()) return')
  })

  it('leaves scrolling and panning alone', () => {
    // `none` would take the scroll.
    expect(shell).not.toContain("touchAction = 'none'")
  })

  it('is actually mounted', () => {
    // A hook nothing calls is the quietest way for this to be wrong.
    expect(appShell).toContain('useNativeShellZoomLock()')
  })
})
