/**
 * Script 阶段作用域分析器
 * 收集脚本中声明的所有变量及其来源
 */

import { parse as babelParse } from '@babel/parser'
import * as t from '@babel/types'
import { traverse } from '@/utils/babelTraverse'
import type { ScriptScope, VariableInfo } from '@/types/scope'
import { isGlobalVariable } from '@/utils/globalWhitelist'
import { createCompileError, extractErrorLoc, getErrorMessage } from '@/utils/errorHandler'

/**
 * 创建空的 ScriptScope
 */
export function createEmptyScriptScope(): ScriptScope {
  return {
    props: new Map(),
    macros: new Map(),
    imports: new Map(),
    declarations: new Map(),
    globals: new Set(),
  }
}

/**
 * 脚本解析结果类型，包含作用域信息和 AST
 */
export interface ScriptAnalysisResult {
  scope: ScriptScope
  ast: t.File
}

/**
 * 分析脚本作用域
 *
 * 解析失败时**只抛错、不打印**——调用链上层（transformer.ts → cli.ts）
 * 有统一的错误展示，重复打印会导致同一错误出现多份（含多份堆栈），干扰排查。
 *
 * @param scriptContent script 内容
 * @param _filePath 文件路径。保留该形参是为了维持调用签名稳定；
 *   错误展示已由上层统一处理，此处不再使用。
 * @returns ScriptAnalysisResult（包含 scope 和解析后的 AST，供后续阶段复用，避免重复解析）
 */
export function analyzeScriptScope(
  scriptContent: string,
  _filePath?: string,
): ScriptAnalysisResult {
  const scope = createEmptyScriptScope()

  let ast: t.File
  try {
    ast = babelParse(scriptContent, {
      sourceType: 'module',
      plugins: ['typescript'],
    })

    // 单次遍历 AST，收集所有变量信息
    traverse(ast, {
      // 1. 收集导入
      ImportDeclaration(path) {
        path.node.specifiers.forEach((spec) => {
          if (t.isImportSpecifier(spec) && t.isIdentifier(spec.imported)) {
            const name = spec.local.name
            scope.imports.set(name, {
              name,
              source: {
                type: 'import',
                accessPath: name,
                originalName: spec.imported.name,
              },
            })
          } else if (t.isImportDefaultSpecifier(spec) || t.isImportNamespaceSpecifier(spec)) {
            const name = spec.local.name
            scope.imports.set(name, {
              name,
              source: {
                type: 'import',
                accessPath: name,
              },
            })
          }
        })
      },

      // 2. 收集变量声明（包括宏和 props）
      VariableDeclaration(path) {
        path.node.declarations.forEach((decl) => {
          // 宏声明（defineProps/defineEmits/defineContext）的 id 可能是
          // ObjectPattern（解构式 defineProps），需在 isIdentifier 判断前处理
          if (decl.init && t.isCallExpression(decl.init)) {
            const calleeName = t.isIdentifier(decl.init.callee) ? decl.init.callee.name : ''

            switch (calleeName) {
              case 'defineProps':
                handleDefineProps(decl, scope)
                return // 跳过 declarations 收集
              case 'defineEmits':
                handleDefineEmits(decl, scope)
                return // 跳过 declarations 收集
              case 'defineContext':
                handleDefineContext(decl, scope)
                return // 跳过 declarations 收集
            }
          }

          if (!t.isIdentifier(decl.id)) return

          const name = decl.id.name

          // 普通变量声明
          scope.declarations.set(name, {
            name,
            source: {
              type: 'declaration',
              accessPath: '__vmsProxyRefs',
            },
          })
        })
      },

      // 3. 收集函数声明
      FunctionDeclaration(path) {
        if (path.node.id) {
          const name = path.node.id.name
          scope.declarations.set(name, {
            name,
            source: {
              type: 'declaration',
              accessPath: '__vmsProxyRefs',
            },
          })
        }
      },
    })
  } catch (error: unknown) {
    // 这里**不打印**，只负责把错误规范化后向上抛：
    // 调用链上层（transformer.ts → cli.ts）已有统一的错误展示。
    // 此前本函数既打印又 rethrow，导致同一个语法错误被输出**两次**
    // （一次带脚本片段、一次带完整 SFC 片段），且各带一份完整堆栈，
    // 与 cli.ts 中"transformer 内部已调用 handleCompileError、此处不重复打印"
    // 的注释相矛盾。
    const loc = extractErrorLoc(error)
    if (loc) {
      throw createCompileError(getErrorMessage(error), loc)
    }
    throw error
  }

  return { scope, ast }
}

/**
 * 处理 defineProps
 */
function handleDefineProps(decl: t.VariableDeclarator, scope: ScriptScope): void {
  // 情况1: const props = defineProps()
  if (t.isIdentifier(decl.id)) {
    scope.propsVarName = decl.id.name
    return
  }

  // 情况2: const { foo, bar } = defineProps()
  if (t.isObjectPattern(decl.id)) {
    decl.id.properties.forEach((prop) => {
      if (t.isRestElement(prop) && t.isIdentifier(prop.argument)) {
        // const { ...rest } = defineProps()
        scope.propsRestName = prop.argument.name
      } else if (t.isObjectProperty(prop)) {
        // const { foo } = defineProps() 或 const { foo: bar } = defineProps()
        const keyName = t.isIdentifier(prop.key) ? prop.key.name : ''
        const valueName = t.isIdentifier(prop.value) ? prop.value.name : ''

        if (keyName && valueName) {
          scope.props.set(valueName, {
            name: valueName,
            source: {
              type: 'props',
              accessPath: '__vmsProps',
              originalName: keyName,
            },
          })
        }
      }
    })
  }
}

/**
 * 处理 defineEmits
 */
function handleDefineEmits(decl: t.VariableDeclarator, scope: ScriptScope): void {
  if (t.isIdentifier(decl.id)) {
    const name = decl.id.name
    scope.macros.set(name, {
      name,
      source: {
        type: 'macro',
        accessPath: name,
      },
    })
  }
}

/**
 * 处理 defineContext
 */
function handleDefineContext(decl: t.VariableDeclarator, scope: ScriptScope): void {
  if (t.isIdentifier(decl.id)) {
    const name = decl.id.name
    scope.macros.set(name, {
      name,
      source: {
        type: 'macro',
        accessPath: name,
      },
    })
  }
}

/**
 * 检查变量名是否是全局变量
 */
export function checkAndMarkGlobal(name: string, scope: ScriptScope): boolean {
  if (isGlobalVariable(name)) {
    scope.globals.add(name)
    return true
  }
  return false
}

/**
 * 获取变量的完整信息
 */
export function getVariableInfo(name: string, scope: ScriptScope): VariableInfo | undefined {
  // 按优先级查找
  if (scope.props.has(name)) return scope.props.get(name)
  if (scope.macros.has(name)) return scope.macros.get(name)
  if (scope.imports.has(name)) return scope.imports.get(name)
  if (scope.declarations.has(name)) return scope.declarations.get(name)

  // 检查全局变量（同时缓存到 scope.globals，供 isGlobalVariableInScope 复用）
  if (checkAndMarkGlobal(name, scope)) {
    return {
      name,
      source: {
        type: 'global',
        accessPath: name,
      },
    }
  }

  return undefined
}

/**
 * 判断变量是否需要从 __vmsProxyRefs 获取
 */
export function needsProxyRefsAccess(name: string, scope: ScriptScope): boolean {
  const info = getVariableInfo(name, scope)
  if (!info) return false

  return info.source.accessPath === '__vmsProxyRefs'
}

/**
 * 判断变量是否应该被收集到 render state
 * 只有 declaration 类型的变量需要加入 render state
 */
export function shouldCollectToRenderState(name: string, scope: ScriptScope): boolean {
  const info = getVariableInfo(name, scope)
  if (!info) return false

  return info.source.type === 'declaration'
}

/**
 * 判断变量是否是 props
 */
export function isPropsVariable(name: string, scope: ScriptScope): boolean {
  return scope.props.has(name)
}

/**
 * 判断变量是否是宏变量
 */
export function isMacroVariable(name: string, scope: ScriptScope): boolean {
  return scope.macros.has(name)
}

/**
 * 判断变量是否是导入的变量
 */
export function isImportVariable(name: string, scope: ScriptScope): boolean {
  return scope.imports.has(name)
}

/**
 * 判断变量是否是全局变量
 */
export function isGlobalVariableInScope(name: string, scope: ScriptScope): boolean {
  return scope.globals.has(name) || isGlobalVariable(name)
}

/**
 * 判断变量是否是 v-for 临时变量
 * (需要在 template 阶段确定)
 */
export function isVForVariable(name: string, vForVars: Set<string>): boolean {
  return vForVars.has(name)
}
