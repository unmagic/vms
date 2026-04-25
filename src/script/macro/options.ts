import * as t from '@babel/types'
import { NodePath } from '@babel/traverse'
import { bold, red } from 'kolorist'
import { createCompileError } from '@/utils/errorHandler'

/**
 * 将 Babel AST 节点转换为普通 JS 值（仅支持字面量、数组、对象）
 */
function astToValue(node: t.Node): unknown {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node)) {
    return node.value
  }
  if (t.isNullLiteral(node)) {
    return null
  }
  if (t.isArrayExpression(node)) {
    return node.elements.map((el) => {
      if (!el) return null
      if (t.isSpreadElement(el)) {
        throw createCompileError('defineOptions 数组中不支持展开运算符', el.loc || undefined)
      }
      return astToValue(el)
    })
  }
  if (t.isObjectExpression(node)) {
    const obj: Record<string, unknown> = {}
    for (const prop of node.properties) {
      if (!t.isObjectProperty(prop)) {
        throw createCompileError('defineOptions 对象中不支持方法或展开属性', prop.loc || undefined)
      }
      const key = t.isIdentifier(prop.key)
        ? prop.key.name
        : t.isStringLiteral(prop.key)
          ? prop.key.value
          : null
      if (key === null) {
        throw createCompileError(
          'defineOptions 对象的属性名必须是标识符或字符串',
          prop.loc || undefined,
        )
      }
      obj[key] = astToValue(prop.value as t.Node)
    }
    return obj
  }
  throw createCompileError(
    `defineOptions 不支持动态值（如变量、函数调用等），请使用字面量。节点类型：${node.type}`,
    (node as any).loc || undefined,
  )
}

/**
 * 处理 defineOptions 宏，提取参数对象并移除调用节点
 */
export function dealMacroOptions(
  path: NodePath<t.ExpressionStatement>,
  expression: t.CallExpression,
): Record<string, unknown> | null {
  if (!t.isIdentifier(expression.callee) || expression.callee.name !== 'defineOptions') {
    return null
  }

  if (!expression.arguments || expression.arguments.length === 0) {
    path.remove()
    return null
  }

  const arg = expression.arguments[0]
  if (!t.isObjectExpression(arg)) {
    console.log(bold(red('defineOptions 的参数必须是对象字面量')))
    path.remove()
    return null
  }

  const result = astToValue(arg) as Record<string, unknown>
  path.remove()
  return result
}
