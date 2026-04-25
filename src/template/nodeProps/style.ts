import * as t from '@babel/types'
import type {
  VMSCounter,
  VMSRootNode,
  VMSTemplateChildNode,
  VMSTransformContext,
} from '@/types/node'
import type { AttributeNode, DirectiveNode } from '@vue/compiler-core'
import { NodeTypes } from '@vue/compiler-core'
import { getTemplateNodeProp } from '@/template/expression'
import { getCodegenNodeProps, setCodegenNode } from '../tools'

function toKebabCase(keyName: string): string {
  if (keyName.includes('-')) return keyName
  return keyName.replace(/([A-Z])/g, (_, c) => `-${c.toLowerCase()}`).replace(/^-/, '')
}

function buildStyleStringFromObject(objectExpression: t.ObjectExpression): t.Expression | null {
  const keyValueExpressions: t.Expression[] = []

  objectExpression.properties.forEach((prop) => {
    if (prop.type !== 'ObjectProperty') return
    const valueExpression = prop.value
    if (
      t.isRestElement(valueExpression) ||
      t.isAssignmentPattern(valueExpression) ||
      t.isArrayPattern(valueExpression) ||
      t.isObjectPattern(valueExpression) ||
      t.isVoidPattern(valueExpression)
    ) {
      return
    }

    if (prop.computed && t.isExpression(prop.key)) {
      keyValueExpressions.push(
        t.binaryExpression(
          '+',
          t.binaryExpression('+', prop.key, t.stringLiteral(':')),
          valueExpression,
        ),
      )
    } else if (prop.key.type === 'Identifier' || prop.key.type === 'StringLiteral') {
      const keyName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value
      const kebabKey = toKebabCase(keyName)
      keyValueExpressions.push(
        t.binaryExpression('+', t.stringLiteral(`${kebabKey}:`), valueExpression),
      )
    }
  })

  if (keyValueExpressions.length === 0) return null

  return keyValueExpressions.reduce((acc, cur) =>
    t.binaryExpression('+', t.binaryExpression('+', acc, t.stringLiteral(';')), cur),
  )
}

function buildStyleStringFromArray(arrayExpression: t.ArrayExpression): t.Expression | null {
  const parts: t.Expression[] = []

  arrayExpression.elements.forEach((element) => {
    if (!element) return
    if (t.isObjectExpression(element)) {
      const expr = buildStyleStringFromObject(element)
      if (expr) parts.push(expr)
    } else if (t.isStringLiteral(element) || t.isTemplateLiteral(element)) {
      parts.push(element)
    } else if (t.isIdentifier(element) || t.isMemberExpression(element)) {
      parts.push(
        t.callExpression(
          t.memberExpression(t.identifier('__vmsWXSUtils'), t.identifier('styleToString')),
          [element],
        ),
      )
    } else if (t.isExpression(element)) {
      parts.push(element)
    }
  })

  if (parts.length === 0) return null

  return parts.reduce((acc, cur) =>
    t.binaryExpression('+', t.binaryExpression('+', acc, t.stringLiteral(';')), cur),
  )
}

export function transformTemplateStyle(
  node: VMSRootNode | VMSTemplateChildNode,
  returnValue: t.ObjectExpression,
  counter: VMSCounter,
  wxsExpressionStatements: t.ExpressionStatement[],
  ctx: VMSTransformContext,
  isPage: boolean = false,
): void {
  if (node.type !== NodeTypes.ELEMENT) return

  // 非页面组件的根节点，自动添加父组件传入的 style
  // 检查当前节点是否是 ROOT 的直接子元素（即组件根节点）
  const parentStyleContent = !isPage && ctx.rootElementNode === node ? '{{style}}' : null
  const props = node.props

  const styleContentList: string[] = []

  if (props) {
    const styleBindProp = props.find(
      (prop: any) => prop.type === NodeTypes.DIRECTIVE && prop.rawName === ':style',
    ) as DirectiveNode | undefined
    const styleStaticProp = props.find(
      (prop: any) => prop.type === NodeTypes.ATTRIBUTE && prop.name === 'style',
    ) as AttributeNode | undefined

    if (!styleBindProp && !styleStaticProp && !parentStyleContent) {
      return
    }

    if (styleStaticProp && styleStaticProp.value) {
      // 裸 style 属性（无值），跳过处理
      const styleStaticPropValue = styleStaticProp.value.content
        .replace(/\s+/g, ' ')
        .replace(/;\s+/g, ';')
        .trim()
      styleContentList.push(
        styleStaticPropValue.endsWith(';')
          ? styleStaticPropValue.slice(0, -1)
          : styleStaticPropValue,
      )
    }
    // 添加父组件传入的 style（在静态之后，动态之前）
    if (parentStyleContent) {
      styleContentList.push(parentStyleContent)
    }
    if (styleBindProp) {
      const { content } = getTemplateNodeProp(
        node as VMSTemplateChildNode,
        styleBindProp,
        returnValue,
        counter,
        wxsExpressionStatements,
        ctx,
        (statements, lastIndex) => {
          return statements.map((item, index) => {
            if (index !== lastIndex) return item
            if (item.type !== 'ExpressionStatement') return item
            const expr = item.expression
            if (expr.type === 'ObjectExpression') {
              const finalExpr = buildStyleStringFromObject(expr)
              if (finalExpr) return t.returnStatement(finalExpr)
            }
            if (expr.type === 'ArrayExpression') {
              const finalExpr = buildStyleStringFromArray(expr)
              if (finalExpr) return t.returnStatement(finalExpr)
            }
            if (expr.type === 'StringLiteral' || expr.type === 'TemplateLiteral') {
              return t.returnStatement(expr)
            }
            if (t.isExpression(expr)) {
              return t.returnStatement(expr)
            }
            return item
          })
        },
      )
      styleContentList.push(content)
    }
  }

  // 添加父组件传入的 style（当没有 props 时）
  if (!props && parentStyleContent) {
    styleContentList.push(parentStyleContent)
  }

  // 如果有 style 内容，更新 codegenNode
  const attributePropContent = styleContentList.join(';')
  if (attributePropContent) {
    const codegenProps = getCodegenNodeProps(node)
    codegenProps.set('style', { content: attributePropContent })

    setCodegenNode(node, {
      type: node.type,
      tag: node.tag,
      props: codegenProps,
      // children 由 buildCodegenNodesForTree 统一处理
      loc: node.loc,
    })
  }
}
