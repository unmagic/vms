/**
 * 变量收集工具 - 从 AST 中提取外部变量和局部变量信息
 * 从 eventProcessor.ts 拆分而来
 */

import t from '@babel/types'
import type { VForInfo, VMSTransformContext } from '@/types/node'
import { addProperty } from '../tools'
import { getVForIndexName } from '@/utils/tools'
import {
  isPropsVariable,
  isMacroVariable,
  isImportVariable,
  isGlobalVariableInScope,
} from '@/script/scopeAnalyzer'
import { GLOBAL_WHITELIST } from '@/utils/globalWhitelist'
import { EVENT_PARAM_NAME } from './eventHelpers'

/**
 * 检查变量是否应该被跳过（不收集到 internalVars）
 * 统一封装 scriptScope 变量来源分析，避免散布在多处的四连判断
 */
export function shouldSkipVariable(name: string, scriptScope: any): boolean {
  if (!scriptScope) return false
  return (
    isPropsVariable(name, scriptScope) ||
    isMacroVariable(name, scriptScope) ||
    isImportVariable(name, scriptScope) ||
    isGlobalVariableInScope(name, scriptScope)
  )
}

/**
 * 创建局部变量声明收集 visitor
 * 将 AST 遍历中重复的变量声明收集逻辑（VariableDeclarator、FunctionDeclaration、
 * CatchClause、ForStatement）提取为可复用的 visitor 工厂
 */
export function createLocalVarCollector(localVars: Set<string>) {
  return {
    VariableDeclarator(path: any) {
      const id = path.node.id
      if (t.isIdentifier(id)) {
        localVars.add(id.name)
      } else if (t.isObjectPattern(id)) {
        id.properties.forEach((prop: any) => {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
            localVars.add(prop.value.name)
          } else if (t.isRestElement(prop) && t.isIdentifier(prop.argument)) {
            localVars.add(prop.argument.name)
          }
        })
      } else if (t.isArrayPattern(id)) {
        id.elements.forEach((elem: any) => {
          if (elem && t.isIdentifier(elem)) {
            localVars.add(elem.name)
          }
        })
      }
    },
    FunctionDeclaration(path: any) {
      if (path.node.id) {
        localVars.add(path.node.id.name)
      }
      path.node.params.forEach((param: any) => {
        if (t.isIdentifier(param)) {
          localVars.add(param.name)
        }
      })
    },
    CatchClause(path: any) {
      if (path.node.param && t.isIdentifier(path.node.param)) {
        localVars.add(path.node.param.name)
      }
    },
    ForStatement(path: any) {
      const init = path.node.init
      if (t.isVariableDeclaration(init)) {
        init.declarations.forEach((decl: any) => {
          if (t.isIdentifier(decl.id)) {
            localVars.add(decl.id.name)
          }
        })
      }
    },
  }
}

/**
 * 扫描调用参数中的外部变量（非 v-for item、非字面量、非 $event），
 * 注册到 returnValue 和 ctx.internalVars，确保 __vmsProxyRefs 能访问到
 * 现在使用 scriptScope 进行更精确的变量来源分析
 */
export function collectExternalVarsFromArgs(
  args: t.CallExpression['arguments'],
  vForItemNames: Set<string>,
  vForInfoList: VForInfo[] | undefined,
  returnValue: t.ObjectExpression,
  ctx: VMSTransformContext,
  arrowFunctionArgumentNames?: Set<string>,
): void {
  const vForIndices = new Set(
    vForInfoList ? vForInfoList.map((info) => getVForIndexName(info) || 'index') : [],
  )

  function scanNode(node: t.Node): void {
    if (t.isIdentifier(node)) {
      const name = node.name
      if (
        name === EVENT_PARAM_NAME ||
        name === '$event' ||
        vForItemNames.has(name) ||
        vForIndices.has(name) ||
        GLOBAL_WHITELIST.has(name) ||
        (arrowFunctionArgumentNames && arrowFunctionArgumentNames.has(name))
      ) {
        return
      }

      // 使用封装的函数检查变量是否应该被收集
      if (shouldSkipVariable(name, ctx.scriptScope)) {
        return
      }

      addProperty(returnValue, name)
      ctx.internalVars.add(name)
    } else if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
      // 只扫描 object 部分（根标识符）
      scanNode(node.object)
    } else if (t.isObjectExpression(node)) {
      node.properties.forEach((prop) => {
        if (t.isObjectProperty(prop)) {
          scanNode(prop.value as t.Node)
        }
      })
    } else if (t.isArrayExpression(node)) {
      node.elements.forEach((el) => el && scanNode(el))
    } else if (t.isSpreadElement(node)) {
      scanNode(node.argument)
    }
  }

  args.forEach((arg) => scanNode(arg as t.Node))
}

/**
 * 从条件/逻辑表达式中收集外部变量
 */
export function collectExternalVarsFromExpression(
  body: t.ConditionalExpression | t.LogicalExpression,
  arrowFunctionArgumentNames: Set<string> | undefined,
  vForVars: Set<string>,
): Set<string> {
  const varsToCollect = new Set<string>()

  const collectVarsFromNode = (node: t.Node): void => {
    if (t.isIdentifier(node)) {
      const name = node.name
      if (
        name !== EVENT_PARAM_NAME &&
        name !== '$event' &&
        !GLOBAL_WHITELIST.has(name) &&
        !(arrowFunctionArgumentNames && arrowFunctionArgumentNames.has(name)) &&
        !vForVars.has(name)
      ) {
        varsToCollect.add(name)
      }
    } else if (t.isMemberExpression(node)) {
      collectVarsFromNode(node.object)
    } else if (t.isCallExpression(node)) {
      collectVarsFromNode(node.callee)
      node.arguments.forEach((arg) => collectVarsFromNode(arg as t.Node))
    } else if (t.isConditionalExpression(node)) {
      collectVarsFromNode(node.test)
      collectVarsFromNode(node.consequent)
      collectVarsFromNode(node.alternate)
    } else if (t.isLogicalExpression(node) || t.isBinaryExpression(node)) {
      collectVarsFromNode(node.left)
      collectVarsFromNode(node.right)
    } else if (t.isUnaryExpression(node)) {
      collectVarsFromNode(node.argument)
    } else if (t.isAssignmentExpression(node)) {
      collectVarsFromNode(node.left)
      collectVarsFromNode(node.right)
    }
  }

  // 收集对应表达式类型的节点
  if (t.isConditionalExpression(body)) {
    collectVarsFromNode(body.test)
    collectVarsFromNode(body.consequent)
    collectVarsFromNode(body.alternate)
  } else {
    // LogicalExpression
    collectVarsFromNode(body.left)
    collectVarsFromNode(body.right)
  }

  return varsToCollect
}
