import * as t from '@babel/types'

/**
 * defineComponent 第二个参数（vue-mini 的 Config）注入分析。
 *
 * 说明：注入不区分开发/生产构建模式。vue-mini 的页面钩子只有在 defineComponent
 * 第二个参数中提前声明后才会注册，开发模式下未注册只是会打印警告，生产构建下则会
 * 静默失效，因此两种构建模式都需要注入。
 *
 * 只有当前 script setup 顶层真正调用了对应生命周期函数时才会注入。
 */
export interface PageApiConfigInfo {
  listenPageScroll?: true
  canShareToOthers?: true
  canShareToTimeline?: true
}

type PageApiConfigKey = keyof PageApiConfigInfo

/** 核心运行时导出的页面生命周期函数 -> defineComponent 第二参数配置字段 */
const PAGE_API_CONFIG_MAP: Record<string, PageApiConfigKey> = {
  onPageScroll: 'listenPageScroll',
  onShareAppMessage: 'canShareToOthers',
  onShareTimeline: 'canShareToTimeline',
}

/** 注入配置字段的固定输出顺序，保证编译产物稳定 */
const PAGE_API_CONFIG_KEY_ORDER: PageApiConfigKey[] = [
  'listenPageScroll',
  'canShareToOthers',
  'canShareToTimeline',
]

/** 核心运行时包名，页面生命周期函数只从这个包导入 */
const CORE_MODULE_SOURCE = '@unmagic/vue-mini'

/**
 * 分析当前 script 是否需要为 defineComponent 注入第二个参数。
 *
 * 限制（按设计约定）：
 * - 只识别从核心包导入的 onPageScroll / onShareAppMessage / onShareTimeline；
 * - 只判断这些函数在当前 script 顶层的直接调用，函数体、条件分支、回调等嵌套调用不处理。
 */
export function analyzePageApiConfig(program: t.Program): PageApiConfigInfo {
  const hookBindings = new Map<string, PageApiConfigKey>()
  const coreNamespaceBindings = new Set<string>()

  for (const statement of program.body) {
    if (!t.isImportDeclaration(statement) || statement.importKind === 'type') continue
    if (statement.source.value !== CORE_MODULE_SOURCE) continue

    for (const specifier of statement.specifiers) {
      if (t.isImportSpecifier(specifier)) {
        if (specifier.importKind === 'type') continue
        const importedName = t.isIdentifier(specifier.imported)
          ? specifier.imported.name
          : specifier.imported.value
        const configKey = PAGE_API_CONFIG_MAP[importedName]
        if (configKey) {
          hookBindings.set(specifier.local.name, configKey)
        }
      } else if (t.isImportNamespaceSpecifier(specifier)) {
        coreNamespaceBindings.add(specifier.local.name)
      }
    }
  }

  if (hookBindings.size === 0 && coreNamespaceBindings.size === 0) {
    return {}
  }

  const detectedKeys = new Set<PageApiConfigKey>()
  for (const statement of program.body) {
    if (!t.isExpressionStatement(statement)) continue
    const call = asCallExpression(statement.expression)
    if (!call) continue
    const configKey = resolveHookConfigKey(call.callee, hookBindings, coreNamespaceBindings)
    if (configKey) {
      detectedKeys.add(configKey)
    }
  }

  const config: PageApiConfigInfo = {}
  for (const key of PAGE_API_CONFIG_KEY_ORDER) {
    if (detectedKeys.has(key)) {
      config[key] = true
    }
  }
  return config
}

/**
 * 将检测结果转换为 defineComponent 第二个参数的 AST 属性列表。
 * 没有命中任何页面 API 时返回空数组，调用方据此决定是否生成第二个参数。
 */
export function createPageApiConfigProperties(config: PageApiConfigInfo): t.ObjectProperty[] {
  return PAGE_API_CONFIG_KEY_ORDER.filter((key) => config[key] === true).map((key) =>
    t.objectProperty(t.identifier(key), t.booleanLiteral(true)),
  )
}

/** 从顶层语句表达式中取出调用表达式，忽略 TS 断言包装 */
function asCallExpression(node: t.Expression): t.CallExpression | t.OptionalCallExpression | null {
  const unwrapped = unwrapTypeAssertions(node)
  if (t.isCallExpression(unwrapped) || t.isOptionalCallExpression(unwrapped)) {
    return unwrapped
  }
  return null
}

/** 解析调用的 callee 对应哪个页面 API 配置字段 */
function resolveHookConfigKey(
  callee: t.Expression | t.V8IntrinsicIdentifier,
  hookBindings: Map<string, PageApiConfigKey>,
  coreNamespaceBindings: Set<string>,
): PageApiConfigKey | null {
  const target = unwrapTypeAssertions(callee)

  if (t.isIdentifier(target)) {
    return hookBindings.get(target.name) ?? null
  }

  // 支持 import * as vueMini from '@unmagic/vue-mini' 后调用 vueMini.onPageScroll()
  if (
    t.isMemberExpression(target) &&
    t.isIdentifier(target.object) &&
    coreNamespaceBindings.has(target.object.name)
  ) {
    const propertyName = t.isIdentifier(target.property)
      ? target.property.name
      : t.isStringLiteral(target.property)
        ? target.property.value
        : null
    return propertyName ? (PAGE_API_CONFIG_MAP[propertyName] ?? null) : null
  }

  return null
}

/** 去掉 TS 类型断言 / 非空断言包装 */
function unwrapTypeAssertions(node: t.Node): t.Node {
  let current = node
  while (
    t.isTSAsExpression(current) ||
    t.isTSTypeAssertion(current) ||
    t.isTSNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current
}
