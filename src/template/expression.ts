import { extractVariablesFromExpressionAST } from '@/utils/ast'
import {
  collectBindingVarsWithAST,
  collectBindingVarsWithVarName,
  collectBindingVarsWithVarNameList,
  containsExternalFunctionInExpression,
  isComplexExpression,
  type ExpressionCacheEntry,
} from './tools'
import { detectPolyfillMethods, applyPolyfillTransform } from './wxsPolyfill'
import * as t from '@babel/types'
import { type DirectiveNode, NodeTypes } from '@vue/compiler-core'
import type { VMSCounter, VMSTemplateChildNode, VMSTransformContext } from '@/types/node'
import { transformFromAstSync } from '@babel/core'
import { parse } from '@babel/parser'
import { WXS_NAMESPACE } from '@/utils/constants'
import { createCompileError } from '@/utils/errorHandler'

/**
 * 对 babel 输出的代码进行 WXS 兼容性清理
 * - $ → _（WXS 不支持 $ 标识符）
 * - void 0 → undefined（WXS 不支持 void 关键字）
 */
export function sanitizeWxsCode(code: string): string {
  return code
    .replace(/[_a-zA-Z][$\w]*/g, (match) => match.replace(/[$]/g, '_'))
    .replace(/void\s+0/g, 'undefined')
}

export function makeBabelOptions() {
  return {
    filename: 'temp.ts',
    presets: ['@babel/preset-env', '@babel/preset-typescript'],
    plugins: [
      '@babel/plugin-transform-arrow-functions',
      '@babel/plugin-transform-template-literals',
    ],
    generatorOpts: {
      jsescOption: {
        minimal: true,
      },
    },
  }
}

/**
 * 将表达式 AST 节点通过 babel 降级为 ES5 兼容的代码字符串
 * 处理可选链(?.)、箭头函数、模板字符串等现代语法
 *
 * 返回代码字符串而非 AST 节点，因为 @babel/generator 会在输出时
 * 将降级后的条件表达式反向优化回 ?. 等简写形式。
 *
 * 后处理：$ → _（WXS 不支持 $）、void 0 → undefined（WXS 不支持 void）
 */
export function downlevelExpressionCode(
  expr: t.Expression,
): { code: string; declarations: string } {
  const programAST = t.program([t.expressionStatement(expr)])
  const result = transformFromAstSync(programAST, undefined, makeBabelOptions())
  if (!result?.code) {
    throw createCompileError('无法将表达式转换为 WXS 兼容语法', expr.loc)
  }
  // babel 输出可能包含 var 声明（如可选链降级产生的 var _x;）
  // 分离声明和表达式语句——声明需要放入 WXS 函数体顶部，
  // 否则 WXS 中赋值未声明变量会成为模块级全局变量
  const lines = result.code.trim().split('\n')
  const declarations: string[] = []
  const exprLines: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^\s*var\s+/.test(trimmed)) {
      declarations.push(trimmed)
    } else if (trimmed) {
      exprLines.push(trimmed)
    }
  }
  const code = exprLines
    .join('\n')
    .trim()
    .replace(/;?\s*$/, '')
  return { code: sanitizeWxsCode(code), declarations: declarations.join('\n') }
}

/**
 * 将降级后的代码字符串解析为 AST 语句列表
 * parse 回 AST 是为了锁定展开形式，避免 @babel/generator 反向优化回 ?. 等简写
 */
export function parseDownleveledCode(code: string): t.Statement[] {
  return parse(code, { sourceType: 'script' }).program.body
}

/**
 * Vue compiler 解析失败时的 fallback：用 babel 重新解析表达式
 *
 * prop.exp.ast 有四种值：
 *   null  — Vue compiler 判定为简单标识符，无需解析
 *   false — Vue compiler 解析失败（语法错误），需要 fallback 重新解析
 *   undefined — 静态节点或 filter 语法（极少见）
 *   Program | Expression — 正常解析结果
 *
 * 当 rawAst === false 时，尝试用 @babel/parser 重新解析。
 * 返回解析后的 AST 表达式节点，或 null（解析也失败）。
 */
export function fallbackParseExpression(rawAst: any, expression: string): t.Node | null | undefined {
  if (rawAst !== false) {
    return rawAst as t.Node | null | undefined
  }
  try {
    const stmt = parse(expression, {
      sourceType: 'script',
      plugins: ['typescript'],
    }).program.body[0]
    return stmt?.type === 'ExpressionStatement' ? (stmt as t.ExpressionStatement).expression : null
  } catch {
    // 解析仍然失败，返回 null，走简单路径
    return null
  }
}

function getTemplateNodeProp(
  node: VMSTemplateChildNode,
  prop: Pick<DirectiveNode, 'exp' | 'loc'>,
  returnValue: t.ObjectExpression,
  counter: VMSCounter,
  wxsExpressionStatements: t.ExpressionStatement[],
  ctx: VMSTransformContext,
  wxsStatementsFun?: (statements: t.Statement[], lastIndex: number) => t.Statement[],
): ExpressionCacheEntry {
  if (prop.exp?.type !== NodeTypes.SIMPLE_EXPRESSION) {
    return { content: '' }
  }

  const originalExpression = prop.exp.content
  const rawAst = prop.exp.ast

  // ast === false 说明 Vue compiler 解析失败，尝试用 babel 重新解析
  const ast = fallbackParseExpression(rawAst, originalExpression)

  const notSupportMethodsSet = ast ? detectPolyfillMethods(ast) : new Set<string>()

  if (ast) {
    if (isComplexExpression(ast) || notSupportMethodsSet.size > 0) {
      const hasExternalFunction = containsExternalFunctionInExpression(ast)
      if (!hasExternalFunction) {
        const wxsFunctionName = counter.generateWxsFunctionName()
        const variables = extractVariablesFromExpressionAST(ast)
        const clonedAst = t.cloneNode(ast as unknown as t.Expression)
        const programAST = t.program([t.expressionStatement(clonedAst)])
        if (notSupportMethodsSet.size > 0) {
          applyPolyfillTransform(programAST)
        }
        const result = transformFromAstSync(programAST, originalExpression, makeBabelOptions())
        if (result?.code) {
          const processedCode = sanitizeWxsCode(result.code)
          const statements = parseDownleveledCode(processedCode)
          const lastIndex = statements.length - 1
          const wxsStmt = t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(
                t.memberExpression(t.identifier('module'), t.identifier('exports')),
                t.identifier(wxsFunctionName),
              ),
              t.functionExpression(
                null,
                variables.map((item) => t.identifier(item)),
                t.blockStatement(
                  typeof wxsStatementsFun === 'function'
                    ? wxsStatementsFun(statements, lastIndex)
                    : statements.map((item, index) => {
                        if (index === lastIndex) {
                          return item.type === 'ExpressionStatement'
                            ? t.returnStatement(item.expression)
                            : item
                        }
                        return item
                      }),
                ),
              ),
            ),
          )
          wxsExpressionStatements.push(wxsStmt)
          const wxsCallParams = variables.length > 0 ? `${variables.join(', ')}` : ''
          collectBindingVarsWithVarNameList(variables, node, returnValue, ctx)
          return {
            content: `{{${WXS_NAMESPACE}.${wxsFunctionName}(${wxsCallParams})}}`,
            wxsStatement: wxsStmt,
          }
        } else {
          throw createCompileError('无法将表达式转换为es5语法', prop.loc)
        }
      } else {
        throw createCompileError('无法处理表达式', prop.loc)
      }
    } else {
      collectBindingVarsWithAST(ast, node, returnValue, ctx)
      return { content: `{{${originalExpression}}}` }
    }
  } else {
    // ast === null 表示简单标识符（Vue compiler 已确认），或 babel 重新解析也失败
    if (originalExpression === 'true' || originalExpression === 'false') {
      return { content: `{{${originalExpression}}}` }
    } else {
      collectBindingVarsWithVarName(originalExpression, node, returnValue, ctx)
      return { content: `{{${originalExpression}}}` }
    }
  }
}

export { getTemplateNodeProp }
