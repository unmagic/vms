import * as t from '@babel/types'

// Polyfill 注册表条目类型
interface PolyfillEntry {
  type: 'instance' | 'static'
  object?: string // 仅 static 类型需要，如 'Object'、'Number'
}

// 注册表：方法名 → 转换元数据
export const WXS_POLYFILL_REGISTRY: Record<string, PolyfillEntry> = {
  // ── 数组实例方法 ──────────────────────────────
  find: { type: 'instance' },
  findLast: { type: 'instance' },
  findIndex: { type: 'instance' },
  findLastIndex: { type: 'instance' },
  includes: { type: 'instance' },
  filter: { type: 'instance' },
  map: { type: 'instance' },
  reduce: { type: 'instance' },
  reduceRight: { type: 'instance' },
  some: { type: 'instance' },
  every: { type: 'instance' },
  flat: { type: 'instance' },
  flatMap: { type: 'instance' },
  at: { type: 'instance' },
  // ── 字符串实例方法 ────────────────────────────
  padStart: { type: 'instance' },
  padEnd: { type: 'instance' },
  trimStart: { type: 'instance' },
  trimEnd: { type: 'instance' },
  replaceAll: { type: 'instance' },
  // ── Object 静态方法 ───────────────────────────
  entries: { type: 'static', object: 'Object' },
  fromEntries: { type: 'static', object: 'Object' },
  assign: { type: 'static', object: 'Object' },
  // ── Number 静态方法 ───────────────────────────
  isNaN: { type: 'static', object: 'Number' },
  isFinite: { type: 'static', object: 'Number' },
  isInteger: { type: 'static', object: 'Number' },
}

const WXS_UTILS_NAMESPACE = '__vmsWXSUtils'

/**
 * 通用子节点遍历器（共享骨架，供 walkNode 和 transformNode 复用）
 * 跳过 AST 元数据字段（type/start/end/loc），递归处理 Array 和 object 子节点
 */
type ChildCallback = (child: any, key?: string, index?: number) => any

function walkChildren(node: any, callback: ChildCallback): any {
  if (!node || typeof node !== 'object') return node
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue
    const child = node[key]
    if (Array.isArray(child)) {
      for (let i = 0; i < child.length; i++) {
        if (child[i] && typeof child[i] === 'object' && child[i].type) {
          const result = callback(child[i], key, i)
          if (result !== undefined) child[i] = result
        }
      }
    } else if (child && typeof child === 'object' && child.type) {
      const result = callback(child, key)
      if (result !== undefined) node[key] = result
    }
  }
}

/**
 * 简单递归遍历 AST 节点，对每个节点调用 visitor
 * 不依赖 @babel/traverse 的 scope 机制，避免 "Couldn't find a Program" 错误
 */
function walkNode(node: any, visitor: (node: any) => void): void {
  if (!node || typeof node !== 'object') return
  visitor(node)
  walkChildren(node, (child) => {
    walkNode(child, visitor)
  })
}

/**
 * 检测 AST 中使用了哪些需要 polyfill 的方法（只读，不修改 AST）
 */
export function detectPolyfillMethods(ast: t.Node): Set<string> {
  const detected = new Set<string>()

  walkNode(ast, (node) => {
    if (node.type === 'CallExpression') {
      const callee = node.callee
      if (
        callee &&
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property &&
        callee.property.type === 'Identifier'
      ) {
        const methodName = callee.property.name
        if (methodName in WXS_POLYFILL_REGISTRY) {
          detected.add(methodName)
        }
      }
    } else if (node.type === 'UnaryExpression' && node.operator === 'typeof') {
      // typeof 在 WXS 中原生支持，无需替换节点，但需要标记以触发 WXS 函数生成路径
      detected.add('__typeof__')
    }
  })

  return detected
}

/**
 * 在 AST 上原地替换所有 polyfill 方法调用（应在深拷贝上调用）
 * 使用迭代方式处理，支持链式调用和嵌套回调
 */
export function applyPolyfillTransform(node: t.Node): t.Node {
  if (!node || typeof node !== 'object') return node

  // 先递归处理子节点（深度优先，确保内层先处理）
  walkChildren(node, (child) => applyPolyfillTransform(child))

  // 然后处理当前节点
  if (node.type === 'CallExpression') {
    const callee = node.callee
    if (callee && callee.type === 'MemberExpression' && !callee.computed) {
      const property = callee.property
      if (property && property.type === 'Identifier') {
        const methodName = property.name
        const entry = WXS_POLYFILL_REGISTRY[methodName]
        if (entry) {
          if (entry.type === 'instance') {
            // 跳过已转换的节点
            if (
              callee.object &&
              callee.object.type === 'Identifier' &&
              callee.object.name === WXS_UTILS_NAMESPACE
            ) {
              return node
            }
            // receiver.method(args) → __vmsWXSUtils.method(receiver, args)
            return t.callExpression(
              t.memberExpression(t.identifier(WXS_UTILS_NAMESPACE), t.identifier(methodName)),
              [callee.object, ...node.arguments],
            )
          } else if (entry.type === 'static' && entry.object) {
            const objectNode = callee.object
            if (
              objectNode &&
              objectNode.type === 'Identifier' &&
              objectNode.name === entry.object
            ) {
              const wxsName =
                entry.object.toLowerCase() + methodName[0].toUpperCase() + methodName.slice(1)
              return t.callExpression(
                t.memberExpression(t.identifier(WXS_UTILS_NAMESPACE), t.identifier(wxsName)),
                [...node.arguments],
              )
            }
          }
        }
      }
    }
  }
  // typeof 在 WXS 中原生支持，不需要替换
  return node
}
