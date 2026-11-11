import { extractVariablesFromExpressionAST, getExpressionTSAst } from '@/utils/ast'
import {
  addRenderProperty,
  buildDestructuredAccess,
  collectBindingVarsWithAST,
  collectBindingVarsWithVarName,
  collectBindingVarsWithVarNameList,
  containsExternalFunctionInExpression,
  getVForInfoList,
  getVForVariables,
  isComplexExpression,
  resolveDestructuredVar,
  type ExpressionCacheEntry,
} from './tools'
import { rewriteExpressionVars } from './nodeProps/inlineHandler'
import {
  isGlobalVariableInScope,
  isImportVariable,
  isMacroVariable,
  isPropsVariable,
} from '@/script/scopeAnalyzer'
import { getVForItemName, getVForSourceExpression } from '@/utils/tools'
import { detectPolyfillMethods, applyPolyfillTransform } from './wxsPolyfill'
import * as t from '@babel/types'
import { type DirectiveNode, NodeTypes } from '@vue/compiler-core'
import type { VForInfo, VMSCounter, VMSTemplateChildNode, VMSTransformContext } from '@/types/node'
import type { ScriptScope } from '@/types/scope'
import { transformFromAstSync } from '@babel/core'
import { parse } from '@babel/parser'
import { generate } from '@babel/generator'
import { WXS_NAMESPACE } from '@/utils/constants'
import { createCompileError } from '@/utils/errorHandler'

/**
 * 清理标识符名称中 WXS 不支持的 $ 字符
 */
export function sanitizeWxsIdentifierName(name: string): string {
  return name.replace(/\$/g, '_')
}

/**
 * 对降级后的 AST 进行 WXS 兼容性清理（AST 级处理，不会误伤字符串字面量）
 *
 * 处理内容（每项都以"产物在 WXS 中必须合法"为准）：
 *  - **变量名**中的 `$` → `_`（WXS 不支持 `$` 标识符）
 *  - **属性名**中的 `$` → 改用计算成员/字符串键
 *    （`obj.$v` → `obj["$v"]`，`{ $k: 1 }` → `{ "$k": 1 }`）
 *  - `void 0` → `undefined`（WXS 不支持 `void` 关键字）
 *
 * 为什么属性名既不能改名也不能原样保留：
 *  - 改成 `obj._v` 会读一个**不存在的属性**（数据的键仍是 `$v`），静默取到 undefined
 *  - 原样保留 `obj.$v` 会让 `$` 作为**标识符**出现在 WXS 代码里，
 *    违反 WXS 对 `$` 的限制，产物能否运行取决于工具链的宽松程度
 *  - 计算成员 `obj["$v"]` 两者兼顾：键名精确、语法为 WXS 明确支持的带引号属性访问
 *
 * 使用 VISITOR_KEYS 驱动遍历，只访问有效子节点，避免触碰 loc 等元数据
 */
export function sanitizeWxsAst(node: t.Node): t.Node {
  const visitorKeys = t.VISITOR_KEYS[node.type]
  if (visitorKeys) {
    for (const key of visitorKeys) {
      // 非计算成员表达式的 property 是**属性名**而非变量引用，
      // 不能被重命名：obj.$value 的数据键就是 '$value'，
      // 改成 obj._value 会去读一个不存在的属性（静默取到 undefined）。
      if (
        (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') &&
        key === 'property' &&
        !node.computed
      ) {
        continue
      }
      // 对象字面量的 key 同理（{ $k: 1 } 的键名需保留）
      if (
        (node.type === 'ObjectProperty' || node.type === 'ObjectMethod') &&
        key === 'key' &&
        !node.computed
      ) {
        continue
      }

      const value = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const child = value[i]
          if (child && typeof child === 'object' && Object.hasOwn(child, 'type')) {
            value[i] = sanitizeWxsAst(child as t.Node)
          }
        }
      } else if (value && typeof value === 'object' && Object.hasOwn(value, 'type')) {
        ;(node as unknown as Record<string, unknown>)[key] = sanitizeWxsAst(value as t.Node)
      }
    }
  }

  // 非计算成员 `obj.$v`：属性名含 `$` 时改写为计算成员 `obj["$v"]`。
  // 键名保持不变，且产物中不再出现 `$` 标识符。
  if (
    (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) &&
    !node.computed &&
    t.isIdentifier(node.property) &&
    node.property.name.includes('$')
  ) {
    node.property = t.stringLiteral(node.property.name)
    node.computed = true
  }

  // 对象字面量的非计算 key `{ $k: 1 }`：同样改写为字符串键 `{ "$k": 1 }`
  if (
    (t.isObjectProperty(node) || t.isObjectMethod(node)) &&
    !node.computed &&
    t.isIdentifier(node.key) &&
    node.key.name.includes('$')
  ) {
    node.key = t.stringLiteral(node.key.name)
  }

  // WXS 没有 Date / RegExp 构造函数，必须改用工厂函数：
  //   官方《WXS 语法参考 · 数据类型》：
  //     date  —— "生成 date 对象需要使用 getDate 函数"
  //     regexp —— "生成 regexp 对象需要使用 getRegExp 函数"
  //   而《基础类库》中 Date 只提供 parse / UTC / now 三个静态属性，
  //   并不存在构造函数。因此 new Date(...) / new RegExp(...) 在 WXS 中
  //   无法运行（运行时才会暴露），这里改写为等价的 WXS 写法。
  //   注意保持 Object 等其它构造器不变——它们在 WXS 中存在。
  if (t.isNewExpression(node) && t.isIdentifier(node.callee)) {
    const ctor = node.callee.name
    if (ctor === 'Date' || ctor === 'RegExp') {
      return t.callExpression(
        t.identifier(ctor === 'Date' ? 'getDate' : 'getRegExp'),
        node.arguments,
      )
    }
  }

  // WXS 没有 String / Boolean 这两个全局函数（官方《基础类库》未列出；
  // 已实测：String(123) 与 Boolean(1) 在模板中均渲染为**空字符串**，
  // 而 Number / parseInt / isNaN 正常）。原样输出会静默产出空值，
  // 因此改写为等价的 WXS 写法：
  //   String(x)  ->  '' + x   字符串拼接触发 ToString
  //   Boolean(x) ->  !!x      双重取反触发 ToBoolean
  // 注意 Number 在 WXS 中存在（实测可用），不做改写。
  if (
    t.isCallExpression(node) &&
    t.isIdentifier(node.callee) &&
    (node.callee.name === 'String' || node.callee.name === 'Boolean')
  ) {
    const name = node.callee.name
    if (name === 'String') {
      if (node.arguments.length === 0) return t.stringLiteral('')
      return t.binaryExpression('+', t.stringLiteral(''), node.arguments[0] as t.Expression)
    }
    if (node.arguments.length === 0) return t.booleanLiteral(false)
    return t.unaryExpression('!', t.unaryExpression('!', node.arguments[0] as t.Expression))
  }

  if (t.isIdentifier(node) && node.name.includes('$')) {
    node.name = sanitizeWxsIdentifierName(node.name)
  }
  // void <任意表达式> 降级产物均为 void 0，统一替换为 undefined
  if (t.isUnaryExpression(node) && node.operator === 'void') {
    return t.identifier('undefined')
  }
  return node
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
export function downlevelExpressionCode(expr: t.Expression): {
  code: string
  declarations: string
} {
  const programAST = t.program([t.expressionStatement(expr)])
  const result = transformFromAstSync(programAST, undefined, makeBabelOptions())
  if (!result?.code) {
    throw createCompileError('无法将表达式转换为 WXS 兼容语法', expr.loc)
  }
  // parse 回 AST 锁定展开形式，并在 AST 层做 WXS 兼容清理（不会误伤字符串字面量）
  // babel 输出可能包含 var 声明（如可选链降级产生的 var _x;）
  // 分离声明和表达式语句——声明需要放入 WXS 函数体顶部，
  // 否则 WXS 中赋值未声明变量会成为模块级全局变量
  const statements = parseDownleveledCode(result.code).map(
    (stmt) => sanitizeWxsAst(stmt) as t.Statement,
  )
  const declarations: string[] = []
  const exprCodes: string[] = []
  for (const stmt of statements) {
    const code = generate(stmt, { jsescOption: { quotes: 'single' } }).code.trim()
    if (t.isVariableDeclaration(stmt)) {
      declarations.push(code)
    } else if (code) {
      exprCodes.push(code)
    }
  }
  const code = exprCodes
    .join('\n')
    .trim()
    .replace(/;?\s*$/, '')
  return { code, declarations: declarations.join('\n') }
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
export function fallbackParseExpression(
  rawAst: any,
  expression: string,
): t.Node | null | undefined {
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

/**
 * 递归改写表达式 AST 中的解构变量（如 { id, name } 解构出的 id/name）
 * 为 item 属性访问（item.id / item.name）。用于 WXML 文本插值与属性绑定。
 */
export function rewriteDestructuredVarsInAst(
  expr: t.Expression,
  vForInfoList: VForInfo[],
): t.Expression {
  const process = (node: t.Expression): t.Expression => {
    if (t.isIdentifier(node)) {
      const resolved = resolveDestructuredVar(node.name, vForInfoList)
      if (resolved) return buildDestructuredAccess(t.identifier('item'), resolved.path)
      return node
    }
    if (t.isMemberExpression(node)) {
      // 计算成员（obj[expr]）的 property 是一个**表达式**，其中可能引用解构变量
      // （如 map[id] 的 id 需改写为 item.id）；非计算成员的 property 是属性名，
      // 必须原样保留。
      const property = node.computed ? process(node.property as t.Expression) : node.property
      return t.memberExpression(process(node.object as t.Expression), property, node.computed)
    }
    if (t.isOptionalMemberExpression(node)) {
      const property = node.computed ? process(node.property as t.Expression) : node.property
      return t.optionalMemberExpression(
        process(node.object as t.Expression),
        property,
        node.computed,
        node.optional,
      )
    }
    if (t.isCallExpression(node)) {
      return t.callExpression(
        process(node.callee as t.Expression),
        node.arguments.map((arg) =>
          t.isSpreadElement(arg) || t.isArgumentPlaceholder(arg)
            ? arg
            : process(arg as t.Expression),
        ),
      )
    }
    if (t.isConditionalExpression(node)) {
      return t.conditionalExpression(
        process(node.test),
        process(node.consequent),
        process(node.alternate),
      )
    }
    if (t.isLogicalExpression(node)) {
      return t.logicalExpression(
        node.operator,
        process(node.left as t.Expression),
        process(node.right as t.Expression),
      )
    }
    if (t.isBinaryExpression(node)) {
      return t.binaryExpression(
        node.operator,
        process(node.left as t.Expression),
        process(node.right as t.Expression),
      )
    }
    if (t.isUnaryExpression(node)) {
      return t.unaryExpression(node.operator, process(node.argument as t.Expression))
    }
    if (t.isTemplateLiteral(node)) {
      return t.templateLiteral(
        node.quasis,
        node.expressions.map((e) => process(e as t.Expression)),
      )
    }
    return node
  }
  return process(expr)
}

/**
 * 判断变量是否应被改写为 __vmsProxyRefs 访问。
 * props、props 整体变量、import、macro、global 都不需要改写。
 */
function isCollectableDeclaration(name: string, scriptScope?: ScriptScope): boolean {
  if (!scriptScope) return true
  if (name === scriptScope.propsVarName || name === scriptScope.propsRestName) return false
  return (
    !isPropsVariable(name, scriptScope) &&
    !isImportVariable(name, scriptScope) &&
    !isMacroVariable(name, scriptScope) &&
    !isGlobalVariableInScope(name, scriptScope)
  )
}

/**
 * 确保 v-for 的 index 变量名已生成（供 computed 绑定在 WXML 中按索引取值）。
 * 若 transformVForProp 尚未处理该 v-for，则先补生成并写回 forParseResult，
 * 保证后续 wx:for-index 使用同一名称。
 */
function ensureVForIndexName(vForInfo: VForInfo, counter: VMSCounter): string {
  const key = vForInfo.forParseResult?.key
  if (key?.type === NodeTypes.SIMPLE_EXPRESSION && key.content) {
    return key.content
  }
  const generated = counter.generateVForIndexName(getVForItemName(vForInfo))
  vForInfo.forParseResult.key = {
    type: NodeTypes.SIMPLE_EXPRESSION,
    content: generated,
    isStatic: false,
    constType: 0,
    loc: vForInfo.forParseResult.value?.loc,
  }
  return generated
}

/**
 * 生成 v-for 场景下的 computed 绑定（支持嵌套 v-for）。
 * 例如嵌套 v-for 下的 :title="fmt(col.name)" 会编译为：
 *   computed(() => rows.map(row => row.cols.map(col => fmt(col.name))))
 * WXML 中按多层 index 取值：title="{{__vmsComputed_0[rowIndex][colIndex]}}"
 */
function generateVForComputedBinding(
  ast: t.Expression,
  freeVars: string[],
  vForInfoList: VForInfo[],
  returnValue: t.ObjectExpression,
  counter: VMSCounter,
  ctx: VMSTransformContext,
): ExpressionCacheEntry {
  const scriptScope = ctx.scriptScope

  // 预生成所有层级的 index 名，保证与 wx:for-index 一致
  const indexNames: string[] = []
  for (const info of vForInfoList) {
    indexNames.push(ensureVForIndexName(info, counter))
  }

  // 收集所有 v-for 的 item/index 临时变量名
  const allVForVars = new Set<string>()
  const allItemNames: string[] = []
  for (let i = 0; i < vForInfoList.length; i++) {
    // 与 transformVForProp 的 parseForVariables 保持一致：
    // 非简单标识符的 item（如解构）默认名为 'item'
    const itemName = getVForItemName(vForInfoList[i]) || 'item'
    allVForVars.add(itemName)
    allItemNames.push(itemName)
    allVForVars.add(indexNames[i])
    // 解构变量名也属于 v-for 临时变量，不应被改写为 __vmsProxyRefs
    if (vForInfoList[i].destructuredVars) {
      for (const varName of vForInfoList[i].destructuredVars!.keys()) {
        allVForVars.add(varName)
      }
    }
  }

  // 改写用户表达式中的 setup 变量（排除所有 v-for 临时变量），再改写解构变量为 item 属性访问
  const varsToCollect = new Set(
    freeVars.filter(
      (name) => !allVForVars.has(name) && isCollectableDeclaration(name, scriptScope),
    ),
  )
  const rewrittenExpr = rewriteDestructuredVarsInAst(
    rewriteExpressionVars(ast, varsToCollect, undefined, ctx),
    vForInfoList,
  )

  // 从最内层向外层逐级包裹 .map()
  let innerExpr = rewrittenExpr
  for (let level = vForInfoList.length - 1; level >= 0; level--) {
    const info = vForInfoList[level]
    const sourceExpr = getVForSourceExpression(info)

    // 外层 item 名：source 表达式可能引用它们，不应改写
    const outerItemNames = new Set(allItemNames.slice(0, level))

    const sourceAst = getExpressionTSAst(sourceExpr) as unknown as t.Expression
    const sourceVars = extractVariablesFromExpressionAST(sourceAst)
    const sourceVarsToCollect = new Set(
      sourceVars.filter(
        (name) => !outerItemNames.has(name) && isCollectableDeclaration(name, scriptScope),
      ),
    )
    const rewrittenSource = rewriteExpressionVars(sourceAst, sourceVarsToCollect, undefined, ctx)

    // map 回调参数：始终包含 item，若用户表达式引用该层 index 则追加
    const mapParams: t.Identifier[] = [t.identifier(allItemNames[level])]
    if (freeVars.includes(indexNames[level])) {
      mapParams.push(t.identifier(indexNames[level]))
    }

    innerExpr = t.callExpression(t.memberExpression(rewrittenSource, t.identifier('map')), [
      t.arrowFunctionExpression(mapParams, innerExpr),
    ])

    // 收集 source 中引用的 setup 变量（排除 v-for 临时变量）
    sourceVars.forEach((name) => {
      if (!allVForVars.has(name)) addRenderProperty(returnValue, name, ctx)
    })
  }

  const computedName = counter.generateComputedName()
  const computedCall = t.callExpression(t.identifier('computed'), [
    t.arrowFunctionExpression([], innerExpr),
  ])

  returnValue.properties.push(t.objectProperty(t.identifier(computedName), computedCall))
  ctx.renderVars.add(computedName)
  ctx.needsProxyRefs = true

  // 收集用户表达式引用的 setup 变量（排除 v-for 临时变量）
  freeVars.forEach((name) => {
    if (!allVForVars.has(name)) addRenderProperty(returnValue, name, ctx)
  })

  // WXML：按所有层级 index 依次取值
  let wxmlContent = `{{${computedName}`
  for (const idx of indexNames) {
    wxmlContent += `[${idx}]`
  }
  wxmlContent += `}}`

  return { content: wxmlContent }
}

function getTemplateNodeProp(
  node: VMSTemplateChildNode,
  prop: Pick<DirectiveNode, 'exp' | 'loc'>,
  returnValue: t.ObjectExpression,
  counter: VMSCounter,
  wxsExpressionStatements: t.ExpressionStatement[],
  ctx: VMSTransformContext,
  wxsStatementsFun?: (statements: t.Statement[], lastIndex: number) => t.Statement[],
  forceWxs = false,
): ExpressionCacheEntry {
  if (prop.exp?.type !== NodeTypes.SIMPLE_EXPRESSION) {
    return { content: '' }
  }

  const originalExpression = prop.exp.content
  const rawAst = prop.exp.ast

  // ast === false 说明 Vue compiler 解析失败，尝试用 babel 重新解析
  let ast = fallbackParseExpression(rawAst, originalExpression)

  // 简单标识符（如 :style="objStyle"）的 exp.ast 是 null，会落到下面的
  // "简单路径"分支。但 forceWxs 要求走 WXS 求值（:style 需要把可能为对象的
  // 变量经 styleToString 转成字符串），因此这里按需用 babel 补出 AST。
  if (forceWxs && !ast && typeof originalExpression === 'string' && originalExpression) {
    try {
      const stmt = parse(originalExpression, {
        sourceType: 'script',
        plugins: ['typescript'],
      }).program.body[0]
      ast = stmt?.type === 'ExpressionStatement' ? stmt.expression : null
    } catch {
      ast = null
    }
  }

  const notSupportMethodsSet = ast ? detectPolyfillMethods(ast) : new Set<string>()

  if (ast) {
    // forceWxs：即使表达式很简单（如单个标识符 :style="objStyle"）也强制走
    // WXS 求值路径。:style 需要这种处理——变量可能是**对象**，
    // 原样输出 style="{{objStyle}}" 会把对象塞进字符串属性而静默失效。
    if (isComplexExpression(ast) || notSupportMethodsSet.size > 0 || forceWxs) {
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
          // AST 级 WXS 兼容清理：标识符 $ → _、void 0 → undefined，不会篡改字符串字面量
          const statements = parseDownleveledCode(result.code).map(
            (stmt) => sanitizeWxsAst(stmt) as t.Statement,
          )
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
                // 函数形参同步清理 $，与函数体内被重命名的引用保持一致
                variables.map((item) => t.identifier(sanitizeWxsIdentifierName(item))),
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
        // 表达式包含 setup 函数调用（WXS 无法访问 setup 作用域），
        // 改为在 setup 内生成 computed 求值并暴露为渲染变量
        const scriptScope = ctx.scriptScope
        const freeVars = extractVariablesFromExpressionAST(ast)

        // v-for 场景：函数参数引用了 v-for 临时变量，预计算为数组再按索引取值
        const vForInfoList = getVForInfoList(ctx, node)
        if (vForInfoList && vForInfoList.length > 0) {
          const vForVars = getVForVariables(ctx, node)
          if (freeVars.some((name) => vForVars.has(name))) {
            return generateVForComputedBinding(
              ast as unknown as t.Expression,
              freeVars,
              vForInfoList,
              returnValue,
              counter,
              ctx,
            )
          }
        }

        const computedName = counter.generateComputedName()

        // 仅声明变量改写为 __vmsProxyRefs 访问；props/import/global 由 rewriteExpressionVars 内部处理
        const varsToCollect = new Set(
          freeVars.filter((name) => isCollectableDeclaration(name, scriptScope)),
        )

        const rewritten = rewriteExpressionVars(
          ast as unknown as t.Expression,
          varsToCollect,
          undefined,
          ctx,
        )

        const computedCall = t.callExpression(t.identifier('computed'), [
          t.arrowFunctionExpression([], rewritten),
        ])

        returnValue.properties.push(t.objectProperty(t.identifier(computedName), computedCall))
        ctx.renderVars.add(computedName)
        ctx.needsProxyRefs = true

        // 收集表达式引用的 setup 变量，确保进入 __vmsRenderState 供 __vmsProxyRefs 访问
        freeVars.forEach((name) => addRenderProperty(returnValue, name, ctx))

        return {
          content: `{{${computedName}}}`,
        }
      }
    } else {
      collectBindingVarsWithAST(ast, node, returnValue, ctx)
      // 解构式 v-for 变量改写为 item 属性访问（如 name → item.name）
      const vForInfoList = getVForInfoList(ctx, node)
      if (
        vForInfoList &&
        vForInfoList.some((info) => info.destructuredVars && info.destructuredVars.size > 0)
      ) {
        const rewrittenAst = rewriteDestructuredVarsInAst(ast as t.Expression, vForInfoList)
        return { content: `{{${generate(rewrittenAst).code}}}` }
      }
      return { content: `{{${originalExpression}}}` }
    }
  } else {
    // ast === null 表示简单标识符（Vue compiler 已确认），或 babel 重新解析也失败
    if (originalExpression === 'true' || originalExpression === 'false') {
      return { content: `{{${originalExpression}}}` }
    } else {
      collectBindingVarsWithVarName(originalExpression, node, returnValue, ctx)
      // 解构式 v-for 的单个变量改写为 item 属性访问
      const vForInfoList = getVForInfoList(ctx, node)
      if (vForInfoList && vForInfoList.length > 0) {
        const resolved = resolveDestructuredVar(originalExpression, vForInfoList)
        if (resolved) {
          const access = buildDestructuredAccess(t.identifier('item'), resolved.path)
          return { content: `{{${generate(access).code}}}` }
        }
      }
      return { content: `{{${originalExpression}}}` }
    }
  }
}

export { getTemplateNodeProp }
