import { parse as babelParse } from '@babel/parser'
import type {
  ExpressionStatement,
  ImportDeclaration,
  ObjectMethod,
  ObjectProperty,
} from '@babel/types'
import * as t from '@babel/types'
import { generate } from '@babel/generator'
import { traverse } from '@/utils/babelTraverse'
import { getErrorMessage } from '@/utils/errorHandler'
import { createComponentExport } from '@/script/macro/expose'
import { dealMacroEmits } from '@/script/macro/emits'
import { dealMacroProps, replacePropsVariablesInAST } from '@/script/macro/props'
import { dealMacroOptions } from '@/script/macro/options'
import { collectImports } from '@/script/collectImports'
import { isImportVariable } from '@/script/scopeAnalyzer'
import { type SFCDescriptor } from '@vue/compiler-sfc'
import type { VMSSFCContext } from '@/types/node'
import { ScriptScope } from '@/types/scope'

function checkSlotsUsage(templateContent: string | undefined): boolean {
  // 检查模板中是否使用了插槽
  if (!templateContent) {
    return false
  }
  return templateContent.includes('slot') || templateContent.includes('Slot')
}

/**
 * 确保 @vue-mini/core 中导入了指定的 specifierName。
 * 如果已存在则跳过，否则追加到已有的 @vue-mini/core import 或新建一个。
 */
function ensureCoreImport(sfcContext: VMSSFCContext, specifierName: string): void {
  const hasImport = sfcContext.importAST.some(
    (importNode) =>
      importNode.source.value === '@vue-mini/core' &&
      importNode.specifiers.some(
        (spec) =>
          t.isImportSpecifier(spec) &&
          t.isIdentifier(spec.imported) &&
          spec.imported.name === specifierName,
      ),
  )

  if (hasImport) return

  const vueImport = sfcContext.importAST.find(
    (importNode) =>
      t.isImportDeclaration(importNode) && importNode.source.value === '@vue-mini/core',
  )

  if (vueImport && t.isImportDeclaration(vueImport)) {
    vueImport.specifiers.push(
      t.importSpecifier(t.identifier(specifierName), t.identifier(specifierName)),
    )
  } else {
    sfcContext.importAST.push(
      t.importDeclaration(
        [t.importSpecifier(t.identifier(specifierName), t.identifier(specifierName))],
        t.stringLiteral('@vue-mini/core'),
      ),
    )
  }
}

async function extractSetupBodyUsingAST(
  scriptContent: string | undefined,
  returnValue: t.ObjectExpression,
  bridgedFunctions: Set<string>,
  internalVars: Set<string>,
  renderVars: Set<string>,
  needsProxyRefs: boolean,
  isPage: boolean,
  scriptScope?: ScriptScope,
) {
  let ast: t.File
  try {
    ast = babelParse(scriptContent ?? '', {
      sourceType: 'module',
      plugins: ['typescript'],
      ranges: true,
      tokens: true,
      errorRecovery: true,
    })
  } catch (error: unknown) {
    console.error(`❌ Failed to parse script content: ${getErrorMessage(error)}`)
    // 返回一个默认的AST结构，避免程序崩溃
    ast = {
      type: 'File',
      program: {
        type: 'Program',
        sourceType: 'module',
        directives: [],
        body: [],
      },
    }
  }

  // 创建一个空的 SFC setup上下文对象
  const sfcContext: VMSSFCContext = {
    importAST: [], // 存储导入的模块AST节点
    propsVarName: '__vmsProps', // 存储props变量名
    propsVarRestName: void 0, // 存储解构情况下的rest变量名
    contextVarName: '__vmsContext', // 存储defineContext变量名
    exposeObject: null, // 存储expose对象
    defineOptionsObject: null, // 存储defineOptions对象
    vueComponentImports: [], // 存储导入的Vue组件
    functionVarsAndDecl: new Set(), // 存储函数声明或使用const明确定义的函数
    propsVarsMap: isPage
      ? new Map()
      : new Map([['style', { defaultValue: null, originName: 'style' }]]), // 存储解构的props变量与原始属性的映射关系；非页面组件默认存储style
    macroInfoList: [], // 收集宏信息，延迟处理
  }

  // 阶段1：单次遍历收集所有信息
  traverse(ast, {
    ImportDeclaration(path) {
      collectImports(path, sfcContext)
    },

    VariableDeclaration(path) {
      const decl = path.node.declarations[0]
      if (decl && decl.init && t.isCallExpression(decl.init)) {
        const calleeName = t.isIdentifier(decl.init.callee) ? decl.init.callee.name : ''

        switch (calleeName) {
          case 'defineContext':
            // 立即处理contextVarName，因为其他宏需要用到
            if (t.isIdentifier(decl.id)) {
              sfcContext.contextVarName = decl.id.name
            }
            sfcContext.macroInfoList.push({ path, decl, type: 'defineContext' })
            break

          case 'defineProps':
            sfcContext.macroInfoList.push({ path, decl, type: 'defineProps' })
            break

          case 'defineEmits':
            sfcContext.macroInfoList.push({ path, decl, type: 'defineEmits' })
            break
        }
      }
    },

    FunctionDeclaration(path) {
      const nodeName = path.node.id?.name
      if (nodeName) {
        sfcContext.functionVarsAndDecl.add(nodeName)
      }
    },

    ExpressionStatement(path) {
      const expression = path.node.expression
      if (t.isCallExpression(expression) && t.isIdentifier(expression.callee)) {
        if (expression.callee.name === 'defineExpose') {
          sfcContext.macroInfoList.push({ path, expression, type: 'defineExpose' })
        } else if (expression.callee.name === 'defineOptions') {
          sfcContext.macroInfoList.push({ path, expression, type: 'defineOptions' })
        }
      }
    },
  })

  // 阶段2：基于收集的信息批量处理宏
  sfcContext.macroInfoList.forEach((item) => {
    switch (item.type) {
      case 'defineContext':
        // 移除defineContext声明
        item.path.remove()
        break
      case 'defineProps':
        // 现在可以安全地处理props，contextVarName已经确定
        dealMacroProps(item.path, item.decl, sfcContext)
        break
      case 'defineEmits':
        // 使用已确定的contextVarName处理emits
        dealMacroEmits(item.path, item.decl, sfcContext.contextVarName)
        break
      case 'defineExpose':
        sfcContext.exposeObject = createComponentExport(item.path, item.expression, returnValue)
        break
      case 'defineOptions':
        sfcContext.defineOptionsObject = dealMacroOptions(item.path, item.expression)
        break
    }
  })

  // 如果有解构的props或rest变量，全局替换变量引用
  if (
    [...sfcContext.propsVarsMap.values()].some((v) => v.isDestructured) ||
    sfcContext.propsVarRestName
  ) {
    // 替换script中的变量引用
    replacePropsVariablesInAST(ast.program, sfcContext)

    // 收集需要添加的别名属性
    const aliasPropsToAdd: t.ObjectProperty[] = []
    let needsComputedImport = false

    // 将returnValue中的解构props变量去除（shorthand且同名的key）
    returnValue.properties = returnValue.properties.filter((prop) => {
      if (t.isObjectProperty(prop) && t.isIdentifier(prop.key) && prop.shorthand) {
        const propInfo = sfcContext.propsVarsMap.get(prop.key.name)
        if (propInfo?.isDestructured) {
          // 如果存在别名（别名与变量名不同），需要添加computed包装的别名属性
          if (propInfo.originName !== prop.key.name) {
            needsComputedImport = true
            aliasPropsToAdd.push(
              t.objectProperty(
                t.identifier(prop.key.name),
                t.callExpression(t.identifier('computed'), [
                  t.arrowFunctionExpression(
                    [],
                    t.memberExpression(
                      t.identifier(sfcContext.propsVarName),
                      t.identifier(propInfo.originName),
                    ),
                  ),
                ]),
              ),
            )
          }
          return false
        } else if (sfcContext.propsVarRestName === prop.key.name) {
          aliasPropsToAdd.push(
            t.objectProperty(t.identifier(prop.key.name), t.identifier(sfcContext.propsVarName)),
          )
          return false
        }
      }
      return true
    })

    // 添加别名属性到returnValue
    returnValue.properties.push(...aliasPropsToAdd)

    // 从 renderVars 和 internalVars 中移除 props 变量
    // 这些变量应该从 __vmsProps 获取，而不是 __vmsRenderState/__vmsInternalState
    sfcContext.propsVarsMap.forEach((_, varName) => {
      renderVars.delete(varName)
      internalVars.delete(varName)
    })

    // 如果需要computed，确保导入
    if (needsComputedImport) {
      ensureCoreImport(sfcContext, 'computed')
    }
  }

  // 这里需要将ast转为setupBody,且返回值为returnValue
  const setupBody = ast.program.body

  // 检查是否需要 proxyRefs（如果 returnValue 中有内联函数）
  const hasInlineFunctions = returnValue.properties.some(
    (prop) =>
      t.isObjectProperty(prop) && t.isIdentifier(prop.key) && prop.key.name.startsWith('__fun_'),
  )

  // 预先定义变量收集容器（在 if/else 块外部定义，以便在整个函数中使用）
  const inlineFunctions: t.ObjectProperty[] = []
  const renderProperties: (t.ObjectProperty | t.ObjectMethod | t.SpreadElement)[] = []
  const internalProperties: (t.ObjectProperty | t.ObjectMethod | t.SpreadElement)[] = []
  const importProperties: t.ObjectProperty[] = [] // 导入的变量，需要直接从模块作用域访问

  // 如果有内联函数，需要添加 proxyRefs 支持
  if (hasInlineFunctions) {
    // 只在实际需要 __vmsProxyRefs 时才导入 proxyRefs
    if (needsProxyRefs) {
      ensureCoreImport(sfcContext, 'proxyRefs')
    }

    // 先收集 returnValue 中哪些 key 是"渲染用"（即模板直接绑定的变量）
    // 一个变量如果同时出现在模板绑定和桥接函数内部，它属于渲染用
    const renderKeys = new Set<string>()
    returnValue.properties.forEach((prop) => {
      if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
        if (!prop.key.name.startsWith('__fun_') && renderVars.has(prop.key.name)) {
          renderKeys.add(prop.key.name)
        }
      }
    })

    // 获取所有 props 变量名（包括解构的和 rest 的）
    const allPropsVarNames = new Set<string>([
      ...sfcContext.propsVarsMap.keys(),
      ...(sfcContext.propsVarRestName ? [sfcContext.propsVarRestName] : []),
    ])

    // 替换桥接函数中的 props 变量访问：__vmsProxyRefs.propName -> __vmsProps.propName
    if (allPropsVarNames.size > 0) {
      returnValue.properties.forEach((prop) => {
        if (
          t.isObjectProperty(prop) &&
          t.isIdentifier(prop.key) &&
          prop.key.name.startsWith('__fun_') &&
          (t.isFunctionExpression(prop.value) || t.isArrowFunctionExpression(prop.value))
        ) {
          replacePropsAccessInFunction(prop.value, allPropsVarNames, sfcContext.propsVarName)
        }
      })
    }

    returnValue.properties.forEach((prop) => {
      if (
        t.isObjectProperty(prop) &&
        t.isIdentifier(prop.key) &&
        prop.key.name.startsWith('__fun_')
      ) {
        inlineFunctions.push(prop)
      } else if (
        t.isObjectProperty(prop) &&
        t.isIdentifier(prop.key) &&
        internalVars.has(prop.key.name) &&
        !renderKeys.has(prop.key.name)
      ) {
        // 纯内部变量（只在桥接函数里用，不在模板直接绑定）
        internalProperties.push(prop)
      } else if (
        t.isObjectProperty(prop) &&
        t.isIdentifier(prop.key) &&
        scriptScope &&
        isImportVariable(prop.key.name, scriptScope)
      ) {
        // 导入的变量，直接从模块作用域访问
        importProperties.push(prop)
      } else {
        renderProperties.push(prop)
      }
    })

    // 收集 setup 函数体中的所有函数声明（排除已被桥接函数替代的）
    setupBody.forEach((statement) => {
      if (t.isFunctionDeclaration(statement) && statement.id) {
        if (bridgedFunctions.has(statement.id.name)) return
        const prop = t.objectProperty(
          t.identifier(statement.id.name),
          t.identifier(statement.id.name),
          false,
          true,
        )
        // 函数声明如果只在桥接函数内部用到，归入 internalProperties
        if (internalVars.has(statement.id.name) && !renderKeys.has(statement.id.name)) {
          internalProperties.push(prop)
        } else {
          renderProperties.push(prop)
        }
      }
    })

    // 创建 __vmsRenderState（渲染数据，注入到 data）
    const setupStateDecl = t.variableDeclaration('const', [
      t.variableDeclarator(t.identifier('__vmsRenderState'), t.objectExpression(renderProperties)),
    ])

    // 如果有内部变量，创建 __vmsInternalState 并合并给 proxyRefs
    const hasInternalState = internalProperties.length > 0

    // 将内联函数转换为函数声明，并添加到 __vmsRenderState
    const inlineFunctionDecls: t.Statement[] = []
    inlineFunctions.forEach((prop) => {
      const funcValue = prop.value
      const isArrow = t.isArrowFunctionExpression(funcValue)
      const isFuncExpr = t.isFunctionExpression(funcValue)

      if (isArrow || isFuncExpr) {
        const funcName = (prop.key as t.Identifier).name
        const params = funcValue.params
        const body = funcValue.body
        const isAsync = funcValue.async || false

        const funcDecl = t.functionDeclaration(
          t.identifier(funcName),
          params,
          t.isBlockStatement(body) ? body : t.blockStatement([t.returnStatement(body)]),
          false,
          isAsync,
        )
        inlineFunctionDecls.push(funcDecl)
        inlineFunctionDecls.push(
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(t.identifier('__vmsRenderState'), t.identifier(funcName)),
              t.identifier(funcName),
            ),
          ),
        )
      }
    })

    // 添加到 setupBody
    setupBody.push(setupStateDecl)
    if (hasInternalState) {
      setupBody.push(
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier('__vmsInternalState'),
            t.objectExpression(internalProperties),
          ),
        ]),
      )
    }
    // 只在内联箭头函数需要访问外部变量时才生成 __vmsProxyRefs
    if (needsProxyRefs) {
      const proxyRefsArg = hasInternalState
        ? t.objectExpression([
            t.spreadElement(t.identifier('__vmsRenderState')),
            t.spreadElement(t.identifier('__vmsInternalState')),
          ])
        : t.identifier('__vmsRenderState')
      setupBody.push(
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier('__vmsProxyRefs'),
            t.callExpression(t.identifier('proxyRefs'), [proxyRefsArg]),
          ),
        ]),
      )
    }
    setupBody.push(...inlineFunctionDecls)

    // 构建 return 语句：包含 __vmsRenderState 和导入的变量
    if (importProperties.length > 0) {
      // 如果有导入的变量，需要将它们合并到 return 对象中
      const returnObject = t.objectExpression([
        t.spreadElement(t.identifier('__vmsRenderState')),
        ...importProperties,
      ])
      setupBody.push(t.returnStatement(returnObject))
    } else {
      setupBody.push(t.returnStatement(t.identifier('__vmsRenderState')))
    }
  } else {
    // 没有内联函数，但需要处理导入的变量
    if (importProperties.length > 0) {
      // 从 returnValue 中移除导入的变量，然后重新构建
      const nonImportProperties = returnValue.properties.filter((prop) => {
        if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
          return !(scriptScope && isImportVariable(prop.key.name, scriptScope))
        }
        return true
      })
      const newReturnValue = t.objectExpression([...nonImportProperties, ...importProperties])
      setupBody.push(t.returnStatement(newReturnValue))
    } else {
      // 没有导入的变量，保持原有逻辑
      setupBody.push(t.returnStatement(returnValue))
    }
  }

  const setupFunAst = t.objectMethod(
    'method',
    t.identifier('setup'),
    [t.identifier(sfcContext.propsVarName), t.identifier(sfcContext.contextVarName)],
    t.blockStatement(setupBody),
  )
  return {
    sfcContext,
    setupFunAst,
  }
}

export async function parseScript(
  descriptor: SFCDescriptor,
  returnValue: t.ObjectExpression,
  bridgedFunctions: Set<string> = new Set(),
  internalVars: Set<string> = new Set(),
  renderVars: Set<string> = new Set(),
  needsProxyRefs: boolean = false,
  isPage: boolean = false,
  scriptScope?: ScriptScope,
) {
  const scriptSetup = descriptor.scriptSetup
  const script = scriptSetup?.content

  // 检查插槽使用
  const hasSlots = checkSlotsUsage(descriptor.template?.content)

  // 提取setup函数体
  const { sfcContext, setupFunAst } = await extractSetupBodyUsingAST(
    script,
    returnValue,
    bridgedFunctions,
    internalVars,
    renderVars,
    needsProxyRefs,
    isPage,
    scriptScope,
  )

  // 生成import抽象语法
  const programBody: (ImportDeclaration | ExpressionStatement)[] = [
    t.importDeclaration(
      [t.importSpecifier(t.identifier('defineComponent'), t.identifier('defineComponent'))],
      t.stringLiteral('@vue-mini/core'),
    ),
    ...sfcContext.importAST,
  ]

  // 生成defineComponent参数
  const defineComponentParams: (ObjectProperty | ObjectMethod)[] = [
    // behaviors: ['wx://component-export'],
    t.objectProperty(
      t.identifier('behaviors'),
      t.arrayExpression([t.stringLiteral('wx://component-export')]),
    ),
  ]
  // 生成properties抽象语法
  if (sfcContext.propsVarsMap.size > 0) {
    defineComponentParams.push(
      t.objectProperty(
        t.identifier('properties'),
        t.objectExpression(
          [...sfcContext.propsVarsMap].map(([_aliasName, { defaultValue, originName }]) => {
            return t.objectProperty(
              t.identifier(originName),
              t.objectExpression(
                defaultValue
                  ? [
                      t.objectProperty(t.identifier('type'), t.nullLiteral()),
                      t.objectProperty(t.identifier('value'), defaultValue),
                    ]
                  : [t.objectProperty(t.identifier('type'), t.nullLiteral())],
              ),
            )
          }),
        ),
      ),
    )
  }

  // 生成options
  // 如果有插槽或 defineOptions 中有 virtualHost，添加 options 配置
  const optionsProperties: t.ObjectProperty[] = []
  if (hasSlots) {
    optionsProperties.push(t.objectProperty(t.identifier('multipleSlots'), t.booleanLiteral(true)))
  }
  // 从 defineOptionsObject 中提取顶层 virtualHost，合并进 options
  let isPushVirtualHost = false
  if (sfcContext.defineOptionsObject) {
    if (Object.hasOwn(sfcContext.defineOptionsObject, 'virtualHost')) {
      const virtualHostVal = sfcContext.defineOptionsObject.virtualHost
      optionsProperties.push(
        t.objectProperty(
          t.identifier('virtualHost'),
          typeof virtualHostVal === 'boolean'
            ? t.booleanLiteral(virtualHostVal)
            : (t.valueToNode(virtualHostVal) as t.Expression),
        ),
      )
      isPushVirtualHost = true
      // 从 defineOptionsObject 中移除，避免写入 JSON
      const { virtualHost: _removed, ...rest } = sfcContext.defineOptionsObject
      sfcContext.defineOptionsObject = Object.keys(rest).length > 0 ? rest : null
    }
  }
  // 如果没有 virtualHost，且当前组件不是页面组件，则添加一个默认的，且值为true
  if (!isPushVirtualHost && !isPage) {
    optionsProperties.push(t.objectProperty(t.identifier('virtualHost'), t.booleanLiteral(true)))
  }
  if (optionsProperties.length > 0) {
    defineComponentParams.push(
      t.objectProperty(t.identifier('options'), t.objectExpression(optionsProperties)),
    )
  }
  // 如果当前不是页面组件，且用户没有在props中定义class
  if (!isPage && ![...sfcContext.propsVarsMap.values()].some((v) => v.originName === 'class')) {
    defineComponentParams.push(
      t.objectProperty(
        t.identifier('externalClasses'),
        t.arrayExpression([t.stringLiteral('class')]),
      ),
    )
  }

  // 如果有defineExpose，生成behaviors和导出
  if (sfcContext.exposeObject) {
    defineComponentParams.push(
      t.objectMethod(
        'method',
        t.identifier('export'),
        [],
        t.blockStatement([t.returnStatement(sfcContext.exposeObject)]),
      ),
    )
  }
  defineComponentParams.push(setupFunAst)
  // 生成defineComponent抽象语法
  programBody.push(
    t.expressionStatement(
      t.callExpression(t.identifier('defineComponent'), [
        t.objectExpression(defineComponentParams),
      ]),
    ),
  )

  return {
    script: generate(t.program(programBody)).code,
    vueComponentImports: sfcContext.vueComponentImports,
    hasSlots,
    sfcContext, // 返回sfcContext
    defineOptionsObject: sfcContext.defineOptionsObject,
  }
}

/**
 * 替换函数中的 props 变量访问
 * 将 __vmsProxyRefs.propName 替换为 __vmsProps.propName
 * 使用 Babel VISITOR_KEYS 进行正确的 AST 遍历，
 * 只访问有意义的子节点，避免遍历 Babel 内部属性。
 */
function replacePropsAccessInFunction(
  func: t.FunctionExpression | t.ArrowFunctionExpression,
  propsVarNames: Set<string>,
  propsVarName: string,
): void {
  // 使用 Babel VISITOR_KEYS 遍历，只处理有意义的子节点
  function traverseNode(node: t.Node): void {
    if (!node || typeof node !== 'object') return

    // 处理 MemberExpression：检查并替换 __vmsProxyRefs.propName
    if (t.isMemberExpression(node)) {
      if (
        t.isIdentifier(node.object, { name: '__vmsProxyRefs' }) &&
        t.isIdentifier(node.property) &&
        propsVarNames.has(node.property.name)
      ) {
        node.object = t.identifier(propsVarName)
      }
    }

    // 使用 VISITOR_KEYS 获取该节点类型的有效子节点属性名
    const visitorKeys = t.VISITOR_KEYS[node.type]
    if (!visitorKeys) return

    for (const key of visitorKeys) {
      const value = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === 'object' && Object.hasOwn(child, 'type')) {
            traverseNode(child as t.Node)
          }
        }
      } else if (value && typeof value === 'object' && Object.hasOwn(value, 'type')) {
        traverseNode(value as t.Node)
      }
    }
  }

  traverseNode(func)
}

// 导出作用域分析器
export { analyzeScriptScope, createEmptyScriptScope } from './scopeAnalyzer'
