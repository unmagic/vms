import {
  collectBindingVarsWithExpression,
  collectBindingVarsWithVarNameList,
  getCodegenNodeProps,
  setCodegenNode,
} from '../tools'
import { downlevelExpressionCode, fallbackParseExpression } from '../expression'
import * as t from '@babel/types'
import type {
  VMSCounter,
  VMSRootNode,
  VMSTemplateChildNode,
  VMSTransformContext,
} from '@/types/node'
import type { AttributeNode, DirectiveNode } from '@vue/compiler-core'
import { NodeTypes } from '@vue/compiler-core'
import { extractVariablesFromExpressionAST } from '@/utils/ast'
import { WXS_NAMESPACE } from '@/utils/constants'
import { parse } from '@babel/parser'

export function transformTemplateClass(
  node: VMSRootNode | VMSTemplateChildNode,
  returnValue: t.ObjectExpression,
  counter: VMSCounter,
  wxsExpressionStatements: t.ExpressionStatement[],
  ctx: VMSTransformContext,
  isPage: boolean = false,
): void {
  if (node.type === NodeTypes.ROOT) {
    const rootChildren = (node as any).children.filter(
      (child: any) => child.type === NodeTypes.ELEMENT,
    )
    if (!isPage && rootChildren.length === 1) {
      ctx.rootElementNode = rootChildren[0]
    }
    return
  }

  if (node.type !== NodeTypes.ELEMENT) return

  const props = node.props
  // 是否需要添加父组件传入的 class
  const isPushParentClass = !isPage && ctx.rootElementNode === node

  const classPropContent: string[] = []

  if (props) {
    const classBindProp = props.find(
      (prop: any) => prop.type === NodeTypes.DIRECTIVE && prop.rawName === ':class',
    ) as DirectiveNode | undefined
    const classStaticProp = props.find(
      (prop: any) => prop.type === NodeTypes.ATTRIBUTE && prop.name === 'class',
    ) as AttributeNode | undefined

    // 优先级：静态 class < 父组件传入 class < 动态 class
    if (classStaticProp && classStaticProp.value) {
      classPropContent.push(classStaticProp.value.content.replace(/\s+/g, ' ').trim())
    }

    // 非页面组件的单根节点，自动添加父组件传入的 class
    if (isPushParentClass) {
      classPropContent.push('class')
    }

    if (classBindProp) {
      const exp = classBindProp.exp
      if (exp && exp.type === NodeTypes.SIMPLE_EXPRESSION) {
        const classBindPropExpContent = exp.content
        const rawAst = exp.ast
        // ast === false 时 Vue compiler 解析失败，尝试用 babel 重新解析
        const ast = fallbackParseExpression(rawAst, classBindPropExpContent)

        if (ast) {
          const allElements = transformClassAst(ast)
          const dynamicElements = allElements.filter((item) => !t.isStringLiteral(item))
          const stringLiteralElements = allElements.filter((item) => t.isStringLiteral(item))
          if (stringLiteralElements.length > 0) {
            classPropContent.push(...stringLiteralElements.map((item) => (item as any).value))
          }
          if (dynamicElements.length > 0) {
            // 先从原始 AST 提取变量名
            const variables = extractVariablesFromArrayElements(dynamicElements)
            const functionName = counter.generateWxsFunctionName()

            // 对每个动态元素做 babel 降级，得到代码字符串和 var 声明
            const downleveled = dynamicElements.map((el) => downlevelExpressionCode(el))

            // 收集所有 var 声明，去重后放入 WXS 函数体顶部
            // （可选链降级会产生 var _x;，WXS 中未声明赋值会变成全局变量）
            const allDeclarations = [
              ...new Set(downleveled.map((d) => d.declarations).filter(Boolean)),
            ]
            const declarationsBlock =
              allDeclarations.length > 0 ? allDeclarations.join(' ') + ' ' : ''

            // 用降级后的代码字符串构建 WXS 函数源码
            const params = variables.join(', ')
            const returnExpr =
              downleveled.length === 1
                ? downleveled[0].code
                : `[${downleveled.map((d) => d.code).join(', ')}].filter(function (v) { return v; }).join(' ')`
            const wxsFuncCode = `module.exports.${functionName} = function (${params}) { ${declarationsBlock}return ${returnExpr}; }`

            // 将完整函数源码 parse 为 AST，确保 generate 输出时保留降级后的结构
            const funcAst = parse(wxsFuncCode, { sourceType: 'script' }).program.body[0]
            if (funcAst?.type === 'ExpressionStatement') {
              wxsExpressionStatements.push(funcAst as t.ExpressionStatement)
            }

            collectBindingVarsWithVarNameList(
              variables,
              node as VMSTemplateChildNode,
              returnValue,
              ctx,
            )
            const wxsCallParams = variables.length > 0 ? `${variables.join(', ')}` : ''
            classPropContent.push(`{{${WXS_NAMESPACE}.${functionName}(${wxsCallParams})}}`)
          }
        } else {
          classPropContent.push(`{{${classBindPropExpContent}}}`)
          collectBindingVarsWithExpression(
            classBindPropExpContent,
            node as VMSTemplateChildNode,
            returnValue,
            ctx,
          )
        }
      }
    }
  } else if (isPushParentClass) {
    // 添加父组件传入的 class（当没有 props 时）
    classPropContent.push('class')
  }

  // 如果有 class 内容，更新 codegenNode
  if (classPropContent.length > 0) {
    const existingCodegenProps = getCodegenNodeProps(node)

    // 检查是否已有 class 属性
    existingCodegenProps.set('class', { content: classPropContent.join(' ') })

    setCodegenNode(node, {
      type: node.type,
      tag: node.tag,
      props: existingCodegenProps,
      // children 由 buildCodegenNodesForTree 统一处理
      loc: node.loc,
    })
  }
}

function extractVariablesFromArrayElements(arrayElements: t.Expression[]): string[] {
  const allVariables = new Set<string>()
  arrayElements.forEach((element) => {
    const variables = extractVariablesFromExpressionAST(element)
    variables.forEach((v) => allVariables.add(v))
  })
  return Array.from(allVariables)
}

function isConditionEqualTo(condition: t.Expression, expectedValue: boolean): boolean {
  return t.isBooleanLiteral(condition) && condition.value === expectedValue
}

/**
 * 将模板字符串（TemplateLiteral）转换为字符串拼接表达式（BinaryExpression）
 * 例：`stat-card--${card.color}` → "stat-card--" + card.color
 */
function templateLiteralToConcat(node: t.TemplateLiteral): t.Expression {
  // quasis: 静态字符串片段，expressions: 动态表达式
  // 结构为 quasis[0] expressions[0] quasis[1] expressions[1] ... quasis[n]
  const parts: t.Expression[] = []
  node.quasis.forEach((quasi, i) => {
    const raw = quasi.value.cooked ?? quasi.value.raw
    if (raw) {
      parts.push(t.stringLiteral(raw))
    }
    if (i < node.expressions.length) {
      parts.push(node.expressions[i] as t.Expression)
    }
  })
  if (parts.length === 0) return t.stringLiteral('')
  return parts.reduce((acc, cur) => t.binaryExpression('+', acc, cur))
}

function transformClassAst(ast: t.Node) {
  const arrayElements: t.Expression[] = []

  if (ast.type === 'ArrayExpression') {
    ast.elements.forEach((element) => {
      if (!element) return

      if (t.isConditionalExpression(element)) {
        if (isConditionEqualTo(element.test, false)) return
        if (isConditionEqualTo(element.test, true)) {
          arrayElements.push(element.consequent)
          return
        }
        arrayElements.push(element)
      } else if (t.isStringLiteral(element)) {
        arrayElements.push(element)
      } else if (t.isIdentifier(element)) {
        arrayElements.push(element)
      } else if (t.isTemplateLiteral(element)) {
        arrayElements.push(templateLiteralToConcat(element))
      } else if (t.isObjectExpression(element)) {
        transformObjectProperties(element, arrayElements)
      } else {
        arrayElements.push(element as t.Expression)
      }
    })
  } else if (t.isObjectExpression(ast)) {
    transformObjectProperties(ast, arrayElements)
  } else {
    const expr = ast as t.Expression
    arrayElements.push(t.isTemplateLiteral(expr) ? templateLiteralToConcat(expr) : expr)
  }
  return arrayElements
}

/**
 * 将 ObjectExpression 的属性展开为条件表达式数组
 * 提取自 transformClassAst 中两处重复的对象属性处理逻辑
 */
function transformObjectProperties(
  objExpr: t.ObjectExpression,
  arrayElements: t.Expression[],
): void {
  objExpr.properties.forEach((property) => {
    if (!t.isObjectProperty(property)) return

    const condition = property.value
    if (!t.isExpression(condition)) return
    if (isConditionEqualTo(condition, false)) return

    let classNameExpression: t.Expression
    if (property.computed && t.isExpression(property.key)) {
      classNameExpression = property.key
    } else if (t.isIdentifier(property.key)) {
      classNameExpression = t.stringLiteral(property.key.name)
    } else if (t.isStringLiteral(property.key)) {
      classNameExpression = property.key
    } else {
      return
    }

    if (isConditionEqualTo(condition, true)) {
      arrayElements.push(classNameExpression)
      return
    }
    arrayElements.push(t.conditionalExpression(condition, classNameExpression, t.stringLiteral('')))
  })
}
