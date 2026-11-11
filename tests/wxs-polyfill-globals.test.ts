import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'

/**
 * polyfill 自身不得使用 WXS 中不存在的全局。
 *
 * 模拟器实测（round 75 / 78 / 79）:
 *   typeof Object / Array / String === 'undefined'（均不存在）
 *   typeof Math / JSON / Number === 'object'/'function'（存在）
 *
 * 回归背景（均为静默失效）:
 *   1. getOwnKeys 用 Object.keys → objectEntries/objectAssign/styleToString 全空
 *   2. assignKey 用 Object.defineProperty → Object.fromEntries 无法写 __proto__ 键
 *   3. padStart/padEnd 用 String(x) → 两个方法整体失效（返回空）
 *
 * 这类问题最难发现：polyfill 的单元测试跑在 Node 里，Node 有 Object/String，
 * 测试全绿，只有真机才暴露。因此这里用静态分析兜底。
 */
const WXS_GLOBALS = new Set([
  'Math',
  'JSON',
  'Number',
  'Date',
  'RegExp',
  'getDate',
  'getRegExp',
  'console',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'NaN',
  'Infinity',
  'undefined',
  'module',
  'exports',
  'require',
  'arguments',
])

/** 官方 WXS 中**不存在**、但在 Node 中存在的全局（必须避免使用） */
const WXS_MISSING_GLOBALS = [
  'Object',
  'Array',
  'String',
  'Boolean',
  'Function',
  'Symbol',
  'Promise',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
]

function walk(node: any, cb: (n: any, parent: any) => void, parent?: any) {
  if (!node || typeof node !== 'object') return
  cb(node, parent)
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue
    if (Array.isArray(v)) v.forEach((c) => walk(c, cb, node))
    else if (v && typeof v === 'object' && (v as any).type) walk(v, cb, node)
  }
}

describe('polyfill 不得使用 WXS 不存在的全局', () => {
  const src = readFileSync('polyfill/wxsUtils.wxs', 'utf8')
  const ast = parse(src, { sourceType: 'script' })

  it('不引用 Object / String / Array 等 WXS 缺失的全局', () => {
    // 逐个使用点判断，而不是「文件里出现过一次 typeof 就整个放过」——
    // 后者的漏洞是：只要写一句 typeof Object !== 'undefined'，
    // 文件里其它地方真正调用 Object.keys() 也会被漏检（已验证过）。
    //
    // 允许的唯一形态是【该标识符本身】处于 typeof 之下：
    //   typeof Object !== 'undefined'
    // typeof 对未声明标识符安全；配合 && 短路可避免对 undefined 取属性。
    // 允许的第二种形态：位于「条件中校验过该全局存在」的 if 语句内，
    // 例如 if (typeof Object !== 'undefined' && typeof Object.defineProperty === 'function')。
    // 这类使用可依赖 && 短路保证安全。
    const guardedNodes = new Set<any>()
    walk(ast, (node: any) => {
      if (node.type !== 'IfStatement') return
      const guardedNames = new Set<string>()
      walk(node.test, (n: any) => {
        if (n.type === 'Identifier' && WXS_MISSING_GLOBALS.includes(n.name)) {
          guardedNames.add(n.name)
        }
      })
      if (guardedNames.size === 0) return
      walk(node, (n: any) => {
        if (n.type === 'Identifier' && guardedNames.has(n.name)) guardedNodes.add(n)
      })
    })

    const offenders = new Set<string>()
    walk(ast, (node: any, parent: any) => {
      if (node.type !== 'Identifier') return
      if (!WXS_MISSING_GLOBALS.includes(node.name)) return
      // 允许：直接作为 typeof 操作数（typeof Object）
      const isTypeofOperand = parent?.type === 'UnaryExpression' && parent.operator === 'typeof'
      if (isTypeofOperand) return
      // 允许：处于校验过该全局的 if 语句内
      if (guardedNodes.has(node)) return
      offenders.add(node.name)
    })
    expect([...offenders].sort()).toEqual([])
  })

  it('只使用 WXS 官方提供的全局（白名单校验）', () => {
    const declared = new Set<string>()
    walk(ast, (node) => {
      if (node.type === 'FunctionDeclaration' && node.id) declared.add(node.id.name)
      if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
        declared.add(node.id.name)
      }
      for (const p of node.params || []) {
        if (p && p.type === 'Identifier') declared.add(p.name)
      }
    })
    // 仅检查具名全局（首字母大写的常见内建），避免误报局部变量
    const suspects = [
      'Object',
      'String',
      'Array',
      'Boolean',
      'Number',
      'JSON',
      'Math',
      'Date',
      'RegExp',
    ]
    const bad = suspects.filter(
      (g) => !WXS_GLOBALS.has(g) && !declared.has(g) && new RegExp('\\\\b' + g + '\\\\b').test(src),
    )
    expect(bad).toEqual([])
  })

  it('padStart / padEnd 用字符串拼接而非 String() 转字符串', () => {
    // 断言实现里没有调用 String( —— 那是 WXS 缺失的全局。
    // 注意排除自定义的 toWxsString(...)（它不是全局，是本文件内的辅助函数）。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(/(?<!toWxs)\bString\s*\(/.test(code)).toBe(false)
    // 反向确证：转换确实经由 toWxsString 完成
    expect(code).toContain('toWxsString(padString)')
  })
})
