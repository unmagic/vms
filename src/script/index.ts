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
import { getErrorMessage, createCompileError } from '@/utils/errorHandler'
import { createComponentExport } from '@/script/macro/expose'
import { dealMacroEmits } from '@/script/macro/emits'
import { dealMacroProps, replacePropsVariablesInAST } from '@/script/macro/props'
import { dealMacroOptions } from '@/script/macro/options'
import { dealMacroModel } from '@/script/macro/model'
import { collectImports } from '@/script/collectImports'
import { isImportVariable } from '@/script/scopeAnalyzer'
import { type SFCDescriptor } from '@vue/compiler-sfc'
import {
  NodeTypes,
  type ElementNode,
  type RootNode,
  type TemplateChildNode,
} from '@vue/compiler-core'
import type { VMSSFCContext } from '@/types/node'
import { ScriptScope } from '@/types/scope'

/**
 * 检查模板 AST 中是否存在 <slot> 出口元素
 * 基于 AST 而非字符串 includes，避免 class="slot-x" 等误判
 */
function checkSlotsUsage(templateAst: RootNode | undefined): boolean {
  if (!templateAst) {
    return false
  }
  const stack: Array<RootNode | TemplateChildNode> = [templateAst]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === NodeTypes.ELEMENT && (node as ElementNode).tag === 'slot') {
      return true
    }
    const children = (node as ElementNode | RootNode).children
    if (Array.isArray(children)) {
      stack.push(...children)
    }
  }
  return false
}

/**
 * 未实现的编译宏：必须报错，否则会以"未定义函数"形式进入产物。
 *
 * 这些宏是 **编译期语法**，运行时并不存在对应函数。若编译器不处理它们，
 * 产物中会保留 `withDefaults(defineProps<...>(), {...})` 这类调用，
 * 小程序运行 setup 时立即抛 `withDefaults is not defined`；
 * `defineSlots<{...}>()` 更会因保留 TS 泛型而产出**非法 JavaScript**，
 * 小程序连文件都无法加载。
 *
 * 按"产物必须能在小程序环境运行"的原则，这里在编译期直接失败。
 */
const UNSUPPORTED_MACROS: Record<string, string> = {
  withDefaults:
    '请改用 Vue 3.5+ 的响应式 Props 解构默认值，如 const { a = "d" } = defineProps<...>()',
  defineSlots: '小程序无插槽类型声明机制，可直接删除该调用',
}

function assertNoUnsupportedMacro(node: t.Node, locNode: t.Node): void {
  let calleeName = ''
  if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
    calleeName = node.callee.name
  } else if (t.isTSInstantiationExpression(node) && t.isIdentifier(node.expression)) {
    // defineSlots<{...}>() 会被解析为 TSInstantiationExpression
    calleeName = node.expression.name
  }
  if (!calleeName) return

  const advice = UNSUPPORTED_MACROS[calleeName]
  if (!advice) return
  throw createCompileError(`${calleeName} 是编译期宏，VMS 尚未实现：${advice}`, locNode.loc ?? null)
}

/**
 * 确保 @unmagic/vue-mini 中导入了指定的 specifierName。
 * 如果已存在则跳过，否则追加到已有的 @unmagic/vue-mini import 或新建一个。
 */
function ensureCoreImport(sfcContext: VMSSFCContext, specifierName: string): void {
  let vueImport: t.ImportDeclaration | undefined

  for (const importNode of sfcContext.importAST) {
    if (!t.isImportDeclaration(importNode) || importNode.source.value !== '@unmagic/vue-mini') {
      continue
    }
    vueImport = importNode
    if (
      importNode.specifiers.some(
        (spec) =>
          t.isImportSpecifier(spec) &&
          t.isIdentifier(spec.imported) &&
          spec.imported.name === specifierName,
      )
    ) {
      return
    }
  }

  if (vueImport) {
    vueImport.specifiers.push(
      t.importSpecifier(t.identifier(specifierName), t.identifier(specifierName)),
    )
  } else {
    sfcContext.importAST.push(
      t.importDeclaration(
        [t.importSpecifier(t.identifier(specifierName), t.identifier(specifierName))],
        t.stringLiteral('@unmagic/vue-mini'),
      ),
    )
  }
}

function extractSetupBodyUsingAST(
  scriptContent: string | undefined,
  returnValue: t.ObjectExpression,
  bridgedFunctions: Set<string>,
  internalVars: Set<string>,
  renderVars: Set<string>,
  needsProxyRefs: boolean,
  isPage: boolean,
  scriptScope?: ScriptScope,
  preParsedAst?: t.File | null,
) {
  let ast: t.File
  try {
    // 复用已解析的 AST，避免重复解析（来自 analyzeScriptScope）
    ast =
      preParsedAst ??
      babelParse(scriptContent ?? '', {
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
      if (decl && decl.init) {
        assertNoUnsupportedMacro(decl.init, decl)
      }
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

          case 'defineModel':
            sfcContext.macroInfoList.push({ path, decl, type: 'defineModel' })
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
      assertNoUnsupportedMacro(expression, path.node)
      if (t.isCallExpression(expression) && t.isIdentifier(expression.callee)) {
        const callee = expression.callee.name
        if (callee === 'defineExpose') {
          sfcContext.macroInfoList.push({ path, expression, type: 'defineExpose' })
        } else if (callee === 'defineOptions') {
          sfcContext.macroInfoList.push({ path, expression, type: 'defineOptions' })
        } else if (
          callee === 'defineProps' ||
          callee === 'defineEmits' ||
          callee === 'defineModel'
        ) {
          // 这三个宏必须"接收其返回值"才有意义：编译器需要知道绑定到哪个变量，
          // 才能生成 properties / emits / model，并把变量替换为运行时访问。
          // 若写成裸调用语句（`defineProps<{...}>()`），此前会被静默跳过：
          //   - props 未生成 → 产物里 `return { title }` 引用未声明变量
          //   - 且该调用**原样保留**（含 TS 泛型）→ 产物是**非法 JavaScript**
          // 属于"静默产出错误产物"，因此这里编译期直接报错。
          throw createCompileError(
            callee +
              ' 必须接收其返回值：裸调用会让该宏被静默忽略并产出错误代码。' +
              '请改为 const props = ' +
              callee +
              '(...) 或解构写法 const { x } = ' +
              callee +
              '(...)。',
            path.node.loc ?? null,
          )
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
      case 'defineModel': {
        const handled = dealMacroModel(item.path, item.decl, sfcContext)
        if (!handled) {
          // 移除残留的宏调用，避免未定义标识符进入产物导致运行时崩溃
          const loc = item.path.node.loc ?? null
          item.path.remove()
          throw createCompileError(
            'defineModel 仅支持 defineModel()、defineModel("propName") 或 defineModel({ default: value }) 形式，' +
              '暂不支持 get/set 转换器等 options',
            loc,
          )
        }
        break
      }
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

  // 检查是否有 computed 绑定（returnValue 中值为 computed(...) 的属性）
  const hasComputedBindings = returnValue.properties.some(
    (prop) =>
      t.isObjectProperty(prop) &&
      t.isCallExpression(prop.value) &&
      t.isIdentifier(prop.value.callee, { name: 'computed' }),
  )

  // 预先定义变量收集容器（在 if/else 块外部定义，以便在整个函数中使用）
  const inlineFunctions: t.ObjectProperty[] = []
  const renderProperties: (t.ObjectProperty | t.ObjectMethod | t.SpreadElement)[] = []
  const internalProperties: (t.ObjectProperty | t.ObjectMethod | t.SpreadElement)[] = []
  const importProperties: t.ObjectProperty[] = [] // 导入的变量，需要直接从模块作用域访问

  // 需要生成 __vmsRenderState / __vmsInternalState / __vmsProxyRefs 的场景：
  // - returnValue 中含 __fun_* 桥接函数（事件、v-model setter）
  // - 含 computed 绑定
  // - 其它路径显式要求 needsProxyRefs（如 v-model 在 v-for 内改写数据源后，
  //   即使目标不是 v-for 变量，桥接函数仍会访问 __vmsProxyRefs）
  if (hasInlineFunctions || hasComputedBindings || needsProxyRefs) {
    // 只在实际需要 __vmsProxyRefs 时才导入 proxyRefs
    if (needsProxyRefs) {
      ensureCoreImport(sfcContext, 'proxyRefs')
    }

    // computed 绑定需要在 setup 内生成 computed
    if (hasComputedBindings) {
      ensureCoreImport(sfcContext, 'computed')
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

    // 获取会被改写为 __vmsProps.xxx 的变量名。
    //
    // 只包含解构式 props 与 rest 变量：它们在模板/setter 中确实映射到
    // __vmsProps.<originName>。defineModel 声明的变量（isDestructured: false）
    // 在 setup 中是真实的 customRef 局部常量，必须保持 __vmsProxyRefs.xxx
    // 访问，由 proxyRefs 解包写入 .value 并触发 triggerEvent。
    // 若把 defineModel 变量也纳入改写，会生成 __vmsProps.<变量名>
    // （既不是真实 property 名，也绕过了 customRef 的 setter）。
    const allPropsVarNames = new Set<string>([
      ...[...sfcContext.propsVarsMap]
        .filter(([, info]) => info.isDestructured)
        .map(([varName]) => varName),
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
        // 已在 returnValue 中收集过的函数（如 computed 绑定引用的函数）不重复添加
        const alreadyInReturn = returnValue.properties.some(
          (p) =>
            t.isObjectProperty(p) && t.isIdentifier(p.key) && p.key.name === statement.id!.name,
        )
        if (alreadyInReturn) return
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
    // 没有内联函数：returnValue 中的 shorthand 属性（含导入变量）在 setup 内
    // 直接引用模块作用域，无需额外处理
    setupBody.push(t.returnStatement(returnValue))
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

export function parseScript(
  descriptor: SFCDescriptor,
  returnValue: t.ObjectExpression,
  bridgedFunctions: Set<string> = new Set(),
  internalVars: Set<string> = new Set(),
  renderVars: Set<string> = new Set(),
  needsProxyRefs: boolean = false,
  isPage: boolean = false,
  scriptScope?: ScriptScope,
  preParsedAst?: t.File | null,
  hasDynamicSlots: boolean = false,
) {
  const scriptSetup = descriptor.scriptSetup
  const script = scriptSetup?.content

  // 检查插槽使用（基于模板 AST 检测 <slot> 出口）
  const hasSlots = checkSlotsUsage(descriptor.template?.ast)

  // 提取setup函数体（复用已解析的 AST，避免重复解析）
  const { sfcContext, setupFunAst } = extractSetupBodyUsingAST(
    script,
    returnValue,
    bridgedFunctions,
    internalVars,
    renderVars,
    needsProxyRefs,
    isPage,
    scriptScope,
    preParsedAst,
  )

  // 生成import抽象语法
  const programBody: (ImportDeclaration | ExpressionStatement)[] = [
    t.importDeclaration(
      [t.importSpecifier(t.identifier('defineComponent'), t.identifier('defineComponent'))],
      t.stringLiteral('@unmagic/vue-mini'),
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
            // 属性名可能不是合法 JS 标识符（如 defineModel('user-name')），
            // 此时必须生成字符串键 { "user-name": ... }，否则是语法错误
            return t.objectProperty(
              t.isValidIdentifier(originName)
                ? t.identifier(originName)
                : t.stringLiteral(originName),
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
  if (hasDynamicSlots) {
    optionsProperties.push(t.objectProperty(t.identifier('dynamicSlots'), t.booleanLiteral(true)))
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
