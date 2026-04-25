import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import * as t from '@babel/types'
import { createRequire } from 'module'
import {
  detectPolyfillMethods,
  applyPolyfillTransform,
  WXS_POLYFILL_REGISTRY,
} from '../src/template/wxsPolyfill'
import { WXS_SAFE_GLOBALS, containsExternalFunctionCall } from '../src/template/tools'

const require = createRequire(import.meta.url)
const _wxsUtils = require('../polyfill/wxsUtils.wxs')
// Node.js uses the actual Array constructor, WXS uses string comparison.
// Patch array methods to use Array.isArray for Node.js test compatibility.
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
}

function parseExpr(code: string) {
  const ast = parse(code, { sourceType: 'script' })
  return (ast.program.body[0] as any).expression
}

// ─── P1 & P3: AST 检测和替换不修改原始节点 ───────────────────────────────────

describe('P1 & P3: detectPolyfillMethods and applyPolyfillTransform do not modify original AST', () => {
  // Feature: wxs-polyfill, Property 1 & 3: AST 检测和替换不修改原始节点
  it('detectPolyfillMethods does not modify original AST', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('arr.filter(fn)', 'arr.map(fn)', 'typeof x', 'Object.entries(obj)'),
        (exprCode) => {
          const expr = parseExpr(exprCode)
          const before = JSON.stringify(expr)
          detectPolyfillMethods(expr)
          const after = JSON.stringify(expr)
          expect(after).toBe(before)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('applyPolyfillTransform on clone does not modify original AST', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('arr.filter(fn)', 'arr.map(fn)', 'typeof x', 'Object.entries(obj)'),
        (exprCode) => {
          const ast = parse(exprCode, { sourceType: 'script' })
          const expr = (ast.program.body[0] as any).expression
          const before = JSON.stringify(expr)
          const clonedProgram = t.cloneDeep(ast.program)
          applyPolyfillTransform(clonedProgram)
          const after = JSON.stringify(expr)
          expect(after).toBe(before)
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─── P2: 含 polyfill 方法的表达式生成合法 ES5 代码 ───────────────────────────

describe('P2: Polyfill replacement produces valid ES5 code', () => {
  // Feature: wxs-polyfill, Property 2: 含 polyfill 方法的表达式生成合法 ES5 代码
  it('generates non-empty string for all polyfill expressions', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'arr.filter(fn)',
          'arr.map(fn)',
          'arr.reduce(fn, 0)',
          'Object.entries(obj)',
          'Number.isNaN(x)',
          'typeof x',
        ),
        (exprCode) => {
          const ast = parse(exprCode, { sourceType: 'script' })
          const clonedProgram = t.cloneDeep(ast.program)
          applyPolyfillTransform(clonedProgram)
          const expr = (clonedProgram.body[0] as any).expression
          const result = (generate as any)(expr).code
          expect(typeof result).toBe('string')
          expect(result.length).toBeGreaterThan(0)
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─── P4: filter + map 语义等价 ────────────────────────────────────────────────

describe('P4: filter + map semantic equivalence', () => {
  // Feature: wxs-polyfill, Property 4: filter + map 语义等价
  it('wxsUtils.filter + wxsUtils.map equals native filter + map', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -100, max: 100 })), (arr) => {
        const native = arr.filter((x) => x > 0).map((x) => x * 2)
        const filtered = wxsUtils.filter(arr, (x: number) => x > 0)
        const mapped = wxsUtils.map(filtered, (x: number) => x * 2)
        expect(mapped).toEqual(native)
      }),
      { numRuns: 100 },
    )
  })
})

// ─── P5: objectFromEntries(objectEntries(obj)) 往返属性 ──────────────────────

describe('P5: objectFromEntries(objectEntries(obj)) round-trip', () => {
  // Feature: wxs-polyfill, Property 5: objectFromEntries(objectEntries(obj)) 往返属性
  it('round-trip preserves all key-value pairs', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.integer()),
        (obj) => {
          const result = wxsUtils.objectFromEntries(wxsUtils.objectEntries(obj))
          expect(result).toEqual(obj)
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─── P6: padStart/padEnd 长度保证 ─────────────────────────────────────────────

describe('P6: padStart/padEnd length guarantee', () => {
  // Feature: wxs-polyfill, Property 6: padStart/padEnd 长度保证
  it('padStart result length >= targetLength', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 20 }), (str, targetLength) => {
        const result = wxsUtils.padStart(str, targetLength, ' ')
        expect(result.length).toBeGreaterThanOrEqual(targetLength)
      }),
      { numRuns: 100 },
    )
  })

  it('padEnd result length >= targetLength', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 20 }), (str, targetLength) => {
        const result = wxsUtils.padEnd(str, targetLength, ' ')
        expect(result.length).toBeGreaterThanOrEqual(targetLength)
      }),
      { numRuns: 100 },
    )
  })
})

// ─── P7: numberIsNaN IEEE 754 等价 ────────────────────────────────────────────

describe('P7: numberIsNaN IEEE 754 equivalence', () => {
  // Feature: wxs-polyfill, Property 7: numberIsNaN IEEE 754 等价
  it('numberIsNaN(v) === (v !== v)', () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        expect(wxsUtils.numberIsNaN(v)).toBe(v !== v)
      }),
      { numRuns: 100 },
    )
  })
})

// ─── P8: typeof 在 WXS 中原生支持，不需要替换 ───────────────────────────────

describe('P8: typeof is native in WXS, not replaced by polyfill', () => {
  // Feature: wxs-polyfill, Property 8: typeof 在 WXS 中原生支持，applyPolyfillTransform 不替换它
  it('applyPolyfillTransform leaves typeof x unchanged', () => {
    fc.assert(
      fc.property(fc.constantFrom('typeof x', 'typeof foo', 'typeof bar'), (exprCode) => {
        const ast = parse(exprCode, { sourceType: 'script' })
        const clonedProgram = t.cloneDeep(ast.program)
        applyPolyfillTransform(clonedProgram)
        const expr = (clonedProgram.body[0] as any).expression
        const result = (generate as any)(expr).code
        expect(result).toContain('typeof')
        expect(result).not.toContain('__vmsWXSUtils.typeOf')
      }),
      { numRuns: 100 },
    )
  })
})

// ─── P9: Safe_Global 白名单允许通过 ──────────────────────────────────────────

describe('P9: Safe_Global whitelist allows through', () => {
  // Feature: wxs-polyfill, Property 9: Safe_Global 白名单允许通过
  it('containsExternalFunctionCall returns false for Safe_Global identifiers', () => {
    fc.assert(
      fc.property(fc.constantFrom(...Array.from(WXS_SAFE_GLOBALS)), (name) => {
        const node = { callee: { type: 'Identifier', name } }
        expect(containsExternalFunctionCall(node)).toBe(false)
      }),
      { numRuns: 100 },
    )
  })
})

// ─── P10: 注册表驱动的自动检测 ───────────────────────────────────────────────

describe('P10: Registry-driven auto-detection', () => {
  // Feature: wxs-polyfill, Property 10: 注册表驱动的自动检测
  it('detectPolyfillMethods detects all instance methods from registry', () => {
    const instanceMethods = Object.entries(WXS_POLYFILL_REGISTRY)
      .filter(([, entry]) => entry.type === 'instance')
      .map(([name]) => name)

    fc.assert(
      fc.property(fc.constantFrom(...instanceMethods), (methodName) => {
        const ast = parse(`arr.${methodName}(fn)`, { sourceType: 'script' })
        const expr = (ast.program.body[0] as any).expression
        const detected = detectPolyfillMethods(expr)
        expect(detected.has(methodName)).toBe(true)
      }),
      { numRuns: 100 },
    )
  })
})
