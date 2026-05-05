import { describe, it, expect } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import * as t from '@babel/types'
import { createRequire } from 'module'
import { detectPolyfillMethods, applyPolyfillTransform } from '../src/template/wxsPolyfill'
import { compileVueContent } from './test-utils'

const require = createRequire(import.meta.url)
const _wxsUtils = require('../polyfill/wxsUtils.wxs')

// WXS uses `'Array' !== value.constructor` for array checks (string comparison),
// but Node.js uses the actual Array constructor function. Patch array methods to
// use Array.isArray so the same logic is testable in Node.js.
function isArr(v: unknown): boolean {
  return Array.isArray(v)
}
const wxsUtils = {
  ..._wxsUtils,
  filter: (a: any, fn: any) => {
    if (!isArr(a)) return []
    const r: any[] = []
    for (let i = 0; i < a.length; i++) if (fn(a[i], i, a)) r.push(a[i])
    return r
  },
  map: (a: any, fn: any) => {
    if (!isArr(a)) return []
    const r: any[] = []
    for (let i = 0; i < a.length; i++) r.push(fn(a[i], i, a))
    return r
  },
  reduce: (a: any, fn: any, init: any) => {
    if (!isArr(a)) return init
    let acc = init
    for (let i = 0; i < a.length; i++) acc = fn(acc, a[i], i, a)
    return acc
  },
  reduceRight: (a: any, fn: any, init: any) => {
    if (!isArr(a)) return init
    let acc = init
    for (let i = a.length - 1; i >= 0; i--) acc = fn(acc, a[i], i, a)
    return acc
  },
  some: (a: any, fn: any) => {
    if (!isArr(a)) return false
    for (let i = 0; i < a.length; i++) if (fn(a[i], i, a)) return true
    return false
  },
  every: (a: any, fn: any) => {
    if (!isArr(a)) return true
    for (let i = 0; i < a.length; i++) if (!fn(a[i], i, a)) return false
    return true
  },
  flat: (a: any, depth?: number) => {
    if (!isArr(a)) return []
    const d = depth ?? 1
    function h(arr: any[], rem: number): any[] {
      const r: any[] = []
      for (const item of arr) {
        if (rem > 0 && isArr(item)) r.push(...h(item, rem - 1))
        else r.push(item)
      }
      return r
    }
    return h(a, d)
  },
  flatMap: (a: any, fn: any) => {
    if (!isArr(a)) return []
    const r: any[] = []
    for (let i = 0; i < a.length; i++) {
      const v = fn(a[i], i, a)
      if (isArr(v)) r.push(...v)
      else r.push(v)
    }
    return r
  },
  at: (a: any, idx: number) => {
    if (!isArr(a)) return undefined
    const i = idx < 0 ? a.length + idx : idx
    return i < 0 || i >= a.length ? undefined : a[i]
  },
  find: (a: any, fn: any) => {
    if (!isArr(a)) return undefined
    for (let i = 0; i < a.length; i++) if (fn(a[i], i, a)) return a[i]
    return undefined
  },
  findLast: (a: any, fn: any) => {
    if (!isArr(a)) return undefined
    for (let i = a.length - 1; i >= 0; i--) if (fn(a[i], i, a)) return a[i]
    return undefined
  },
  findIndex: (a: any, fn: any) => {
    if (!isArr(a)) return -1
    for (let i = 0; i < a.length; i++) if (fn(a[i], i, a)) return i
    return -1
  },
  findLastIndex: (a: any, fn: any) => {
    if (!isArr(a)) return -1
    for (let i = a.length - 1; i >= 0; i--) if (fn(a[i], i, a)) return i
    return -1
  },
  includes: (t: any, v: any, from?: number) => {
    if (typeof t === 'string') return t.indexOf(v, from) > -1
    if (!isArr(t)) return false
    for (let i = from ?? 0; i < t.length; i++) if (t[i] === v) return true
    return false
  },
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseExpr(code: string) {
  const ast = parse(code, { sourceType: 'script' })
  return ast.program.body[0].type === 'ExpressionStatement'
    ? (ast.program.body[0] as any).expression
    : null
}

function transformExpr(code: string): string {
  const ast = parse(code, { sourceType: 'script' })
  const clonedProgram = t.cloneDeep(ast.program)
  applyPolyfillTransform(clonedProgram)
  const expr = (clonedProgram.body[0] as any).expression
  return (generate as any)(expr).code
}

// ─── 5.1 detectPolyfillMethods ───────────────────────────────────────────────

describe('5.1 detectPolyfillMethods', () => {
  it('detects filter in simple method call', () => {
    const expr = parseExpr('arr.filter(fn)')
    const result = detectPolyfillMethods(expr)
    expect(result.has('filter')).toBe(true)
  })

  it('detects both filter and map in chained calls', () => {
    const expr = parseExpr('arr.filter(fn).map(fn2)')
    const result = detectPolyfillMethods(expr)
    expect(result.has('filter')).toBe(true)
    expect(result.has('map')).toBe(true)
  })

  it('detects map and filter in nested callback', () => {
    const expr = parseExpr('arr.map(x => x.items.filter(fn))')
    const result = detectPolyfillMethods(expr)
    expect(result.has('map')).toBe(true)
    expect(result.has('filter')).toBe(true)
  })

  it('detects typeof operator (triggers WXS function generation path)', () => {
    const expr = parseExpr('typeof x')
    const result = detectPolyfillMethods(expr)
    expect(result.has('__typeof__')).toBe(true)
  })

  it('does NOT detect filter for computed property access', () => {
    const expr = parseExpr("arr['filter'](fn)")
    const result = detectPolyfillMethods(expr)
    expect(result.has('filter')).toBe(false)
  })

  it('does NOT detect non-registered method push', () => {
    const expr = parseExpr('arr.push(x)')
    const result = detectPolyfillMethods(expr)
    expect(result.has('push')).toBe(false)
  })

  it('detects static method Object.entries', () => {
    const expr = parseExpr('Object.entries(obj)')
    const result = detectPolyfillMethods(expr)
    expect(result.has('entries')).toBe(true)
  })

  it('does NOT modify original AST', () => {
    const expr = parseExpr('arr.filter(fn).map(fn2)')
    const before = JSON.stringify(expr)
    detectPolyfillMethods(expr)
    const after = JSON.stringify(expr)
    expect(after).toBe(before)
  })
})

// ─── 5.2 applyPolyfillTransform ──────────────────────────────────────────────

describe('5.2 applyPolyfillTransform', () => {
  it('transforms instance method arr.filter(fn)', () => {
    const code = transformExpr('arr.filter(fn)')
    expect(code).toContain('__vmsWXSUtils.filter(arr, fn)')
  })

  it('transforms static method Object.entries(obj)', () => {
    const code = transformExpr('Object.entries(obj)')
    expect(code).toContain('__vmsWXSUtils.objectEntries(obj)')
  })

  it('transforms static method Number.isNaN(x)', () => {
    const code = transformExpr('Number.isNaN(x)')
    expect(code).toContain('__vmsWXSUtils.numberIsNaN(x)')
  })

  it('does NOT transform typeof x (WXS supports typeof natively)', () => {
    const code = transformExpr('typeof x')
    expect(code).toContain('typeof x')
    expect(code).not.toContain('__vmsWXSUtils.typeOf')
  })

  it('transforms chained arr.filter(fn).map(fn2)', () => {
    const code = transformExpr('arr.filter(fn).map(fn2)')
    expect(code).toContain('__vmsWXSUtils.filter')
    expect(code).toContain('__vmsWXSUtils.map')
  })

  it('does NOT modify original AST (only the clone)', () => {
    const ast = parse('arr.filter(fn)', { sourceType: 'script' })
    const expr = (ast.program.body[0] as any).expression
    const before = JSON.stringify(expr)
    const clonedProgram = t.cloneDeep(ast.program)
    applyPolyfillTransform(clonedProgram)
    const after = JSON.stringify(expr)
    expect(after).toBe(before)
  })
})

// ─── 5.3 wxsUtils.wxs polyfill functions ─────────────────────────────────────

describe('5.3 wxsUtils.wxs polyfill functions', () => {
  describe('filter', () => {
    it('filters elements matching predicate', () => {
      expect(wxsUtils.filter([1, 2, 3, 4], (x: number) => x > 2)).toEqual([3, 4])
    })
    it('returns [] for null input', () => {
      expect(wxsUtils.filter(null, (x: any) => x)).toEqual([])
    })
    it('returns [] for empty array', () => {
      expect(wxsUtils.filter([], (x: any) => x)).toEqual([])
    })
  })

  describe('map', () => {
    it('maps elements with transform', () => {
      expect(wxsUtils.map([1, 2, 3], (x: number) => x * 2)).toEqual([2, 4, 6])
    })
    it('returns [] for null input', () => {
      expect(wxsUtils.map(null, (x: any) => x)).toEqual([])
    })
  })

  describe('reduce', () => {
    it('reduces array to sum', () => {
      expect(wxsUtils.reduce([1, 2, 3], (acc: number, x: number) => acc + x, 0)).toBe(6)
    })
    it('returns initialValue for null input', () => {
      expect(wxsUtils.reduce(null, (acc: number, x: number) => acc + x, 0)).toBe(0)
    })
  })

  describe('reduceRight', () => {
    it('reduces array from right', () => {
      expect(wxsUtils.reduceRight([1, 2, 3], (acc: number, x: number) => acc + x, 0)).toBe(6)
    })
  })

  describe('some', () => {
    it('returns true when at least one element matches', () => {
      expect(wxsUtils.some([1, 2, 3], (x: number) => x > 2)).toBe(true)
    })
    it('returns false when no element matches', () => {
      expect(wxsUtils.some([1, 2, 3], (x: number) => x > 5)).toBe(false)
    })
    it('returns false for null input', () => {
      expect(wxsUtils.some(null, (x: any) => x)).toBe(false)
    })
  })

  describe('every', () => {
    it('returns true when all elements match', () => {
      expect(wxsUtils.every([1, 2, 3], (x: number) => x > 0)).toBe(true)
    })
    it('returns false when not all elements match', () => {
      expect(wxsUtils.every([1, 2, 3], (x: number) => x > 1)).toBe(false)
    })
    it('returns true for null input', () => {
      expect(wxsUtils.every(null, (x: any) => x)).toBe(true)
    })
  })

  describe('flat', () => {
    it('flattens one level by default', () => {
      expect(wxsUtils.flat([1, [2, 3], [4, [5]]])).toEqual([1, 2, 3, 4, [5]])
    })
    it('flattens to specified depth', () => {
      expect(wxsUtils.flat([1, [2, [3]]], 2)).toEqual([1, 2, 3])
    })
    it('returns [] for null input', () => {
      expect(wxsUtils.flat(null)).toEqual([])
    })
  })

  describe('flatMap', () => {
    it('maps then flattens one level', () => {
      expect(wxsUtils.flatMap([1, 2, 3], (x: number) => [x, x * 2])).toEqual([1, 2, 2, 4, 3, 6])
    })
  })

  describe('at', () => {
    it('returns element at positive index', () => {
      expect(wxsUtils.at([1, 2, 3], 0)).toBe(1)
    })
    it('returns element at negative index', () => {
      expect(wxsUtils.at([1, 2, 3], -1)).toBe(3)
    })
    it('returns undefined for out-of-bounds index', () => {
      expect(wxsUtils.at([1, 2, 3], 5)).toBeUndefined()
    })
    it('returns undefined for null input', () => {
      expect(wxsUtils.at(null, 0)).toBeUndefined()
    })
  })

  describe('padStart', () => {
    it('pads string at start', () => {
      expect(wxsUtils.padStart('5', 3, '0')).toBe('005')
    })
    it('returns original string if already long enough', () => {
      expect(wxsUtils.padStart('hello', 3, '0')).toBe('hello')
    })
    it('returns empty string for null input', () => {
      expect(wxsUtils.padStart(null, 3, '0')).toBe('')
    })
  })

  describe('padEnd', () => {
    it('pads string at end', () => {
      expect(wxsUtils.padEnd('5', 3, '0')).toBe('500')
    })
    it('returns empty string for null input', () => {
      expect(wxsUtils.padEnd(null, 3, '0')).toBe('')
    })
  })

  describe('trimStart', () => {
    it('trims leading whitespace', () => {
      expect(wxsUtils.trimStart('  hello  ')).toBe('hello  ')
    })
    it('returns empty string for null input', () => {
      expect(wxsUtils.trimStart(null)).toBe('')
    })
  })

  describe('trimEnd', () => {
    it('trims trailing whitespace', () => {
      expect(wxsUtils.trimEnd('  hello  ')).toBe('  hello')
    })
  })

  describe('replaceAll', () => {
    it('replaces all occurrences', () => {
      expect(wxsUtils.replaceAll('aabbcc', 'b', 'x')).toBe('aaxxcc')
    })
    it('returns empty string for null input', () => {
      expect(wxsUtils.replaceAll(null, 'b', 'x')).toBe('')
    })
  })

  describe('objectEntries', () => {
    it('returns entries of object', () => {
      expect(wxsUtils.objectEntries({ a: 1, b: 2 })).toEqual([
        ['a', 1],
        ['b', 2],
      ])
    })
    it('returns [] for null input', () => {
      expect(wxsUtils.objectEntries(null)).toEqual([])
    })
  })

  describe('objectFromEntries', () => {
    it('constructs object from entries', () => {
      expect(
        wxsUtils.objectFromEntries([
          ['a', 1],
          ['b', 2],
        ]),
      ).toEqual({ a: 1, b: 2 })
    })
    it('returns {} for empty array', () => {
      expect(wxsUtils.objectFromEntries([])).toEqual({})
    })
  })

  describe('objectAssign', () => {
    it('assigns properties from multiple sources', () => {
      expect(wxsUtils.objectAssign({}, { a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 })
    })
  })

  describe('numberIsNaN', () => {
    it('returns true for NaN', () => {
      expect(wxsUtils.numberIsNaN(NaN)).toBe(true)
    })
    it('returns false for a number', () => {
      expect(wxsUtils.numberIsNaN(1)).toBe(false)
    })
    it('returns false for string NaN', () => {
      expect(wxsUtils.numberIsNaN('NaN')).toBe(false)
    })
  })

  describe('numberIsFinite', () => {
    it('returns true for finite number', () => {
      expect(wxsUtils.numberIsFinite(1)).toBe(true)
    })
    it('returns false for Infinity', () => {
      expect(wxsUtils.numberIsFinite(Infinity)).toBe(false)
    })
    it('returns false for string', () => {
      expect(wxsUtils.numberIsFinite('1')).toBe(false)
    })
  })

  describe('numberIsInteger', () => {
    it('returns true for integer', () => {
      expect(wxsUtils.numberIsInteger(1)).toBe(true)
    })
    it('returns false for float', () => {
      expect(wxsUtils.numberIsInteger(1.5)).toBe(false)
    })
  })
})

// ─── 5.4 Integration tests for expression.ts ─────────────────────────────────

describe('5.4 Integration tests for expression.ts', () => {
  it('expression with filter generates __vmsWXSUtils.filter in wxml', async () => {
    const vueContent = `
<template>
  <view :data-val="arr.filter(x => x > 0)"></view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const arr = ref([1, -1, 2])
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('__vmsWXSUtils.filter')
  })

  it('expression with map generates __vmsWXSUtils.map in wxml', async () => {
    const vueContent = `
<template>
  <view :data-val="arr.map(x => x * 2)"></view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const arr = ref([1, 2, 3])
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    expect(wxml).toContain('__vmsWXSUtils.map')
  })

  it('arr.map(String) does NOT throw (String is in Safe_Global)', async () => {
    const vueContent = `
<template>
  <view :data-val="arr.map(String)"></view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const arr = ref([1, 2, 3])
</script>
`
    const { error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
  })

  it('typeof x expression stays as typeof in generated WXS function', async () => {
    const vueContent = `
<template>
  <view :data-val="typeof x"></view>
</template>
<script setup lang="ts">
import { ref } from '@unmagic/vue-mini'
const x = ref(42)
</script>
`
    const { wxml, error } = await compileVueContent(vueContent)
    expect(error).toBeNull()
    // typeof is native in WXS, so the generated WXS function uses typeof directly
    expect(wxml).not.toContain('__vmsWXSUtils.typeOf')
  })
})
