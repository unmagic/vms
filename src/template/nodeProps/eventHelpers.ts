import t from '@babel/types'
import type { VForInfo } from '@/types/node'
import type { ScriptScope } from '@/types/scope'
import { getVForItemName, getVForIndexName, getVForSourceExpression } from '@/utils/tools'
import { isImportVariable } from '@/script/scopeAnalyzer'

export const EVENT_PARAM_NAME = '__vms_event'

// ==================== 类型定义 ====================

export interface CallExpressionInfo {
  dataKey: string
  dataArgsAst: t.CallExpression['arguments'] | null
  returnValueBodyAst: t.BlockStatement | t.CallExpression | null
  isAsync?: boolean
}

export interface VForItemUsage {
  itemName: string
  usageCount: number
  usages: Array<{
    type: string
    isMemberExpression: boolean
    isReassignment: boolean
    isUpdate: boolean
  }>
  shouldCreateReference: boolean
}

// ==================== 辅助函数 ====================

/**
 * 生成函数索引字符
 */
export function getFunctionIndexChar(index: number): string {
  let result = ''
  let num = index

  while (num >= 0) {
    result = String.fromCharCode(97 + (num % 26)) + result
    num = Math.floor(num / 26) - 1
    if (num < 0) break
  }

  return result
}

/**
 * 构建从 __vmsProxyRefs 或 __vmsProps 访问 v-for item 的表达式
 * 例：__vmsProxyRefs.statCards[_statCards_index]
 * 嵌套 v-for 例：__vmsProxyRefs.props.fields[_fields_index].stringKey[_stringKey__index]
 * 复杂 source 例：__vmsProxyRefs.groupedSelectedItemsMap[field.stringKey][_stringKey__index]
 *
 * 对于复杂的 source 表达式（如 groupedSelectedItemsMap[field.stringKey]），
 * 返回的表达式会依赖之前已声明的 v-for item 变量
 * 现在支持 scriptScope 来判断 source 中的变量是否是 props
 */
export function buildProxyRefsItemAccess(
  vForInfoList: VForInfo[],
  targetItemIndex: number,
  scriptScope?: ScriptScope,
  useProxyRefsBase: boolean = false,
): t.Expression {
  const indices = vForInfoList.map((info) => getVForIndexName(info) || 'index')
  const targetInfo = vForInfoList[targetItemIndex]
  const sourceExpr = getVForSourceExpression(targetInfo)

  // 解析 source 表达式，识别其中的 v-for item 引用
  // 例如："groupedSelectedItemsMap[field.stringKey]" 需要识别出 "field"
  const outerVForItems = vForInfoList.slice(0, targetItemIndex)
  const outerVForItemNames = new Set(outerVForItems.map((info) => getVForItemName(info)))

  // 将 source 表达式按 '[' 分割，处理索引访问
  // 例如："groupedSelectedItemsMap[field.stringKey]" -> ["groupedSelectedItemsMap", "field.stringKey]"]
  // 或者 "group.items" -> ["group.items"]（没有方括号）
  const bracketParts = sourceExpr.split('[')

  // 处理第一部分（属性访问链）
  const firstPart = bracketParts[0]
  const firstPartProps = firstPart ? firstPart.split('.') : []
  const firstProp = firstPartProps[0]

  let expr: t.Expression

  // useProxyRefsBase=true 时强制从 __vmsProxyRefs 开始（用于 createLocalReference 场景，
  // 因为外层 item 不会先声明为局部变量，而是由 replaceVariableAccess 替换）
  if (useProxyRefsBase) {
    expr = t.identifier('__vmsProxyRefs')
    for (const prop of firstPartProps) {
      expr = t.memberExpression(expr, t.identifier(prop))
    }
  } else if (firstProp && outerVForItemNames.has(firstProp)) {
    // 以 v-for item 开头，如 "group.items"
    expr = t.identifier(firstProp)
    // 添加剩余的部分
    for (let i = 1; i < firstPartProps.length; i++) {
      expr = t.memberExpression(expr, t.identifier(firstPartProps[i]))
    }
  } else if (firstProp && scriptScope?.props.has(firstProp)) {
    // 以 props 变量开头，如 "columns"
    const propsVarName = scriptScope.propsVarName || '__vmsProps'
    expr = t.identifier(propsVarName)
    for (const prop of firstPartProps) {
      expr = t.memberExpression(expr, t.identifier(prop))
    }
  } else if (firstProp && scriptScope && isImportVariable(firstProp, scriptScope)) {
    // 以 import 变量开头 — import 在模块作用域可直接访问，不经过 __vmsProxyRefs
    expr = t.identifier(firstProp)
    for (let i = 1; i < firstPartProps.length; i++) {
      expr = t.memberExpression(expr, t.identifier(firstPartProps[i]))
    }
  } else {
    // 以 __vmsProxyRefs 的属性开头
    expr = t.identifier('__vmsProxyRefs')
    for (const prop of firstPartProps) {
      expr = t.memberExpression(expr, t.identifier(prop))
    }
  }

  // 处理方括号内的索引访问
  for (let i = 1; i < bracketParts.length; i++) {
    const part = bracketParts[i]
    // 去掉末尾的 ']'
    const indexContent = part.endsWith(']') ? part.slice(0, -1) : part

    // 检查索引内容是否是 v-for item 或包含 v-for item
    // 例如："field.stringKey" 中的 "field" 是 v-for item
    const indexParts = indexContent.split('.')
    const firstIndexPart = indexParts[0]

    if (outerVForItemNames.has(firstIndexPart)) {
      // 以 v-for item 开头，如 "field.stringKey"
      let indexExpr: t.Expression = t.identifier(firstIndexPart)
      for (let j = 1; j < indexParts.length; j++) {
        indexExpr = t.memberExpression(indexExpr, t.identifier(indexParts[j]))
      }
      expr = t.memberExpression(expr, indexExpr, true)
    } else {
      // 普通索引，直接从 __vmsProxyRefs 获取
      // 这种情况不应该发生，因为 v-for source 中的索引通常引用外层 item
      expr = t.memberExpression(expr, t.identifier(indexContent), true)
    }
  }

  // 添加当前层级的索引访问
  expr = t.memberExpression(expr, t.identifier(indices[targetItemIndex]), true)

  return expr
}

/**
 * 将一个调用参数 AST 节点转换为桥接函数内的访问表达式：
 * - v-for item 标识符 → __vmsProxyRefs.list[index]
 * - v-for item 成员表达式（card.id）→ __vmsProxyRefs.list[index].id
 * - props 变量 → __vmsProps.varName
 * - 外部变量标识符 → __vmsProxyRefs.varName
 * - $event / __vms_event → __vms_event
 * - 字面量 / 其他 → 原样保留
 * 现在支持 scriptScope 进行变量来源分析
 */
export function buildProxyRefsArgument(
  arg: t.Expression | t.SpreadElement | t.JSXNamespacedName | t.ArgumentPlaceholder,
  vForInfoList: VForInfo[] | undefined,
  vForItemNames: Set<string>,
  arrowFunctionArgumentNames?: Set<string>,
  localVarNames?: Set<string>,
  scriptScope?: ScriptScope,
): t.Expression | t.SpreadElement {
  if (t.isSpreadElement(arg)) return arg

  if (t.isIdentifier(arg)) {
    if (arg.name === '$event' || arg.name === EVENT_PARAM_NAME) {
      return t.identifier(EVENT_PARAM_NAME)
    }

    // 已声明为局部变量（如 const card = ...）→ 直接使用
    if (localVarNames && localVarNames.has(arg.name)) {
      return arg
    }

    if (vForInfoList && vForItemNames.has(arg.name)) {
      const itemIndex = vForInfoList.findIndex((info) => getVForItemName(info) === arg.name)
      if (itemIndex !== -1) {
        return buildProxyRefsItemAccess(vForInfoList, itemIndex, scriptScope)
      }
    }

    if (arrowFunctionArgumentNames && arrowFunctionArgumentNames.has(arg.name)) {
      return t.memberExpression(t.identifier(EVENT_PARAM_NAME), t.identifier('detail'))
    }

    if (vForInfoList) {
      const indices = vForInfoList.map((info) => getVForIndexName(info) || 'index')
      if (indices.includes(arg.name)) return arg
    }

    // 检查是否是 props 变量
    if (scriptScope?.props.has(arg.name)) {
      const propsVarName = scriptScope.propsVarName || '__vmsProps'
      return t.memberExpression(t.identifier(propsVarName), t.identifier(arg.name))
    }

    // 检查是否是 import 变量 — import 在模块作用域可直接访问
    if (scriptScope && isImportVariable(arg.name, scriptScope)) {
      return arg
    }

    return t.memberExpression(t.identifier('__vmsProxyRefs'), t.identifier(arg.name))
  }

  // 处理可选链成员表达式（如 e?.detail）
  if (t.isOptionalMemberExpression(arg)) {
    const processedObject = buildProxyRefsArgument(
      arg.object,
      vForInfoList,
      vForItemNames,
      arrowFunctionArgumentNames,
      localVarNames,
      scriptScope,
    )
    return t.optionalMemberExpression(
      processedObject as t.Expression,
      arg.property,
      arg.computed,
      arg.optional,
    )
  }

  // 处理成员表达式（包括嵌套的，如 e.detail.checked）
  if (t.isMemberExpression(arg)) {
    // 递归处理 object 部分
    const processedObject = buildProxyRefsArgument(
      arg.object,
      vForInfoList,
      vForItemNames,
      arrowFunctionArgumentNames,
      localVarNames,
      scriptScope,
    )
    return t.memberExpression(processedObject as t.Expression, arg.property, arg.computed)
  }

  if (t.isObjectExpression(arg)) {
    const processedProperties = arg.properties.map((prop) => {
      if (t.isObjectProperty(prop)) {
        const processedValue = buildProxyRefsArgument(
          prop.value as t.Expression,
          vForInfoList,
          vForItemNames,
          arrowFunctionArgumentNames,
          localVarNames,
        )
        return t.objectProperty(prop.key, processedValue as t.Expression, prop.computed)
      }
      return prop
    })
    return t.objectExpression(processedProperties)
  }

  // 处理 TypeScript 类型断言表达式 (如: value as unknown as Type)
  if (t.isTSAsExpression(arg)) {
    const processedExpression = buildProxyRefsArgument(
      arg.expression,
      vForInfoList,
      vForItemNames,
      arrowFunctionArgumentNames,
      localVarNames,
      scriptScope,
    )
    return t.tsAsExpression(processedExpression as t.Expression, arg.typeAnnotation)
  }

  // 处理 TypeScript 非空断言表达式 (如: value!)
  if (t.isTSNonNullExpression(arg)) {
    const processedExpression = buildProxyRefsArgument(
      arg.expression,
      vForInfoList,
      vForItemNames,
      arrowFunctionArgumentNames,
      localVarNames,
      scriptScope,
    )
    return t.tsNonNullExpression(processedExpression as t.Expression)
  }

  // 处理数组表达式 (如: [a, b, c])
  if (t.isArrayExpression(arg)) {
    const processedElements = arg.elements.map((el) => {
      if (el === null) return null
      return buildProxyRefsArgument(
        el,
        vForInfoList,
        vForItemNames,
        arrowFunctionArgumentNames,
        localVarNames,
        scriptScope,
      ) as t.Expression | t.SpreadElement
    })
    return t.arrayExpression(processedElements)
  }

  // 处理条件表达式 (如: flag ? a : b)
  if (t.isConditionalExpression(arg)) {
    return t.conditionalExpression(
      buildProxyRefsArgument(
        arg.test,
        vForInfoList,
        vForItemNames,
        arrowFunctionArgumentNames,
        localVarNames,
        scriptScope,
      ) as t.Expression,
      buildProxyRefsArgument(
        arg.consequent,
        vForInfoList,
        vForItemNames,
        arrowFunctionArgumentNames,
        localVarNames,
        scriptScope,
      ) as t.Expression,
      buildProxyRefsArgument(
        arg.alternate,
        vForInfoList,
        vForItemNames,
        arrowFunctionArgumentNames,
        localVarNames,
        scriptScope,
      ) as t.Expression,
    )
  }

  // 处理逻辑表达式 (如: flag && onClick(e))
  if (t.isLogicalExpression(arg)) {
    return t.logicalExpression(
      arg.operator,
      buildProxyRefsArgument(
        arg.left,
        vForInfoList,
        vForItemNames,
        arrowFunctionArgumentNames,
        localVarNames,
        scriptScope,
      ) as t.Expression,
      buildProxyRefsArgument(
        arg.right,
        vForInfoList,
        vForItemNames,
        arrowFunctionArgumentNames,
        localVarNames,
        scriptScope,
      ) as t.Expression,
    )
  }

  return arg as t.Expression
}

// ==================== v-for item 声明辅助函数 ====================

/**
 * 解析需要声明为局部变量的 v-for item 集合
 * 从种子 item 出发，递归检查每个 item 的 source 是否依赖其他 v-for item，
 * 将所有依赖项也加入集合（确保声明顺序正确）
 */
function resolveItemsToDeclare(
  seedItems: Set<string> | string[],
  vForInfoList: VForInfo[],
): Set<string> {
  const itemsToDeclare = new Set<string>(seedItems)

  let changed = true
  while (changed) {
    changed = false
    vForInfoList.forEach((info) => {
      const name = getVForItemName(info)
      if (name && itemsToDeclare.has(name)) {
        const sourceExpr = getVForSourceExpression(info)
        const sourceFirstPart = sourceExpr.split(/[.[]/)[0]
        if (sourceFirstPart) {
          const parentItem = vForInfoList.find((i) => getVForItemName(i) === sourceFirstPart)
          if (parentItem && !itemsToDeclare.has(sourceFirstPart)) {
            itemsToDeclare.add(sourceFirstPart)
            changed = true
          }
        }
      }
    })
  }

  return itemsToDeclare
}

/**
 * 按 v-for 嵌套顺序将需要的 item 声明推入 statements
 * 外层先声明，确保内层可以引用外层 item
 */
function declareVForItems(
  itemsToDeclare: Set<string>,
  vForInfoList: VForInfo[],
  statements: t.Statement[],
  scriptScope?: ScriptScope,
): void {
  vForInfoList.forEach((info, idx) => {
    const name = getVForItemName(info)
    if (name && itemsToDeclare.has(name)) {
      const expr = buildProxyRefsItemAccess(vForInfoList, idx, scriptScope)
      statements.push(
        t.variableDeclaration('const', [t.variableDeclarator(t.identifier(name), expr)]),
      )
    }
  })
}

/**
 * 从 dataset 解构 v-for 索引并推入 statements
 */
function declareDatasetIndices(
  dataKey: string,
  vForInfoList: VForInfo[],
  statements: t.Statement[],
): void {
  const indices = vForInfoList.map((info) => getVForIndexName(info) || 'index')
  const indexVars = indices.map((idx) => t.identifier(idx))
  statements.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.objectPattern([
          t.objectProperty(t.identifier(dataKey), t.arrayPattern(indexVars), false, false),
        ]),
        t.memberExpression(
          t.memberExpression(t.identifier(EVENT_PARAM_NAME), t.identifier('currentTarget')),
          t.identifier('dataset'),
        ),
      ),
    ]),
  )
}

// ==================== AST生成函数 ====================

/**
 * 生成通过 __vmsProxyRefs 访问 v-for item 方法的桥接函数体
 * data-a 只传 v-for 索引，item 和参数均从 __vmsProxyRefs 取
 * 现在支持 scriptScope 来判断变量是否是 props
 */
export function getASTWithVForItemFromProxyRefs(
  dataKey: string,
  calleeAst: t.MemberExpression,
  argumentsAst: t.CallExpression['arguments'] | null,
  vForInfoList: VForInfo[],
  arrowFunctionArgumentNames?: Set<string>,
  scriptScope?: ScriptScope,
): t.BlockStatement {
  const vForItemNames = new Set(
    vForInfoList.map((info) => getVForItemName(info)).filter(Boolean) as string[],
  )
  const itemName = (calleeAst.object as t.Identifier).name
  const statements: t.Statement[] = []

  // const {dataKey: [_statCards_index, ...]} = __vms_event.currentTarget.dataset
  declareDatasetIndices(dataKey, vForInfoList, statements)

  // 按 v-for 嵌套顺序声明所有需要的 item（从外层到内层）
  const itemsToDeclare = resolveItemsToDeclare([itemName], vForInfoList)
  declareVForItems(itemsToDeclare, vForInfoList, statements, scriptScope)

  // 构建参数列表（全部从 __vmsProxyRefs 或 __vmsProps 取，不走 data-a）
  // itemName 已声明为局部变量，传入 localVarNames 避免重复展开
  const localVarNames = new Set([itemName])
  let callArgs: t.Expression[]
  if (!argumentsAst || argumentsAst.length === 0) {
    // @tap="card.onClick" 或 @tap="card.onClick()" → 传 __vms_event
    callArgs = [t.identifier(EVENT_PARAM_NAME)]
  } else {
    callArgs = argumentsAst.map((arg) =>
      buildProxyRefsArgument(
        arg,
        vForInfoList,
        vForItemNames,
        arrowFunctionArgumentNames,
        localVarNames,
        scriptScope,
      ),
    ) as t.Expression[]
  }

  // return card.onClick(...)
  statements.push(
    t.returnStatement(
      t.callExpression(
        t.memberExpression(t.identifier(itemName), calleeAst.property, calleeAst.computed),
        callArgs,
      ),
    ),
  )

  return t.blockStatement(statements)
}

/**
 * 生成通过 __vmsProxyRefs 访问外部变量的桥接函数体（非 v-for 场景）
 * 如果在 v-for 中，data-a 传递索引，桥接函数中需要从 dataset 解构索引
 * 现在支持 scriptScope 来判断变量是否是 props
 */
export function getASTWithoutVForItemFromProxyRefs(
  calleeAst: t.Expression,
  argumentsAst: t.CallExpression['arguments'] | null,
  arrowFunctionArgumentNames?: Set<string>,
  vForInfoList?: VForInfo[],
  vForItemNames?: Set<string>,
  dataKey?: string,
  shouldPassIndices?: boolean,
  scriptScope?: ScriptScope,
): t.BlockStatement {
  const effectiveVForItemNames = vForItemNames || new Set<string>()
  const statements: t.Statement[] = []

  // 收集参数中使用的 v-for item 变量名（递归检查嵌套表达式）
  const usedVForItems = new Set<string>()
  function collectVForItems(node: t.Node | null | undefined): void {
    if (!node) return
    if (t.isIdentifier(node) && effectiveVForItemNames.has(node.name)) {
      usedVForItems.add(node.name)
    } else if (t.isMemberExpression(node)) {
      collectVForItems(node.object)
    } else if (t.isObjectExpression(node)) {
      node.properties.forEach((prop) => {
        if (t.isObjectProperty(prop)) {
          collectVForItems(prop.value as t.Expression)
        }
      })
    } else if (t.isArrayExpression(node)) {
      node.elements.forEach((el) => collectVForItems(el))
    }
  }

  if (argumentsAst && vForInfoList && effectiveVForItemNames.size > 0) {
    argumentsAst.forEach((arg) => collectVForItems(arg))
  }

  // 如果需要传递索引（在 v-for 中），从 dataset 解构索引
  if (shouldPassIndices && vForInfoList && vForInfoList.length > 0 && dataKey) {
    declareDatasetIndices(dataKey, vForInfoList, statements)

    // 为参数中使用的每个 v-for item 创建局部变量声明（含递归依赖解析）
    const itemsToDeclare = resolveItemsToDeclare(usedVForItems, vForInfoList)
    declareVForItems(itemsToDeclare, vForInfoList, statements, scriptScope)
  }

  // 创建局部变量名集合，用于避免重复展开
  const localVarNames = new Set(usedVForItems)

  let callArgs: t.Expression[]
  if (!argumentsAst || argumentsAst.length === 0) {
    callArgs = [t.identifier(EVENT_PARAM_NAME)]
  } else {
    callArgs = argumentsAst.map((arg) =>
      buildProxyRefsArgument(
        arg,
        vForInfoList,
        effectiveVForItemNames,
        arrowFunctionArgumentNames,
        localVarNames,
        scriptScope,
      ),
    ) as t.Expression[]
  }

  statements.push(t.returnStatement(t.callExpression(calleeAst, callArgs)))
  return t.blockStatement(statements)
}

/**
 * 检查是否应该创建局部引用
 */
export function shouldCreateLocalReference(usages: VForItemUsage['usages']): boolean {
  if (usages.length <= 1) return false
  if (usages.some((u) => u.isReassignment)) return false
  if (usages.some((u) => u.isUpdate && !u.isMemberExpression)) return false
  return true
}
