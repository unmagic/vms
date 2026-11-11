import type { VForInfo, VMSRootNode, VMSTemplateChildNode, VMSEnhancedNode } from '@/types/node'
import path from 'node:path'
import fs from 'fs-extra'
import { red } from 'kolorist'
import { createCompileError, getErrorMessage } from '@/utils/errorHandler'
import {
  POLYFILL_OUTPUT_DIR,
  POLYFILL_VMS_DIR,
  userConfig,
  OUTPUT_DIR,
  __IS_PROD__,
} from '@/utils/constants'
import { NodeTypes, type SimpleExpressionNode } from '@vue/compiler-core'

/**
 * 判断 v-for 的 item 是否为解构式（ObjectPattern / ArrayPattern）
 */
export function isDestructuredVFor(vForInfo: VForInfo): boolean {
  const ast = vForInfo.forParseResult?.value?.ast
  if (!ast || ast.type !== 'ArrowFunctionExpression') return false
  const param = ast.params?.[0]
  return param?.type === 'ObjectPattern' || param?.type === 'ArrayPattern'
}

/**
 * 解析解构式 v-for 的变量映射。
 * 返回 Map<解构变量名, item 属性访问路径>，非解构式返回空 Map。
 */
export function parseDestructuredVars(vForInfo: VForInfo): Map<string, string> {
  const result = new Map<string, string>()
  if (!isDestructuredVFor(vForInfo)) return result

  const param = vForInfo.forParseResult.value.ast.params[0]

  const walkObjectProps = (props: any[], prefix: string) => {
    for (const prop of props) {
      if (prop?.type !== 'ObjectProperty') continue
      const key = prop.key?.type === 'Identifier' ? prop.key.name : null
      if (key === null) continue
      const path = prefix ? `${prefix}.${key}` : key
      if (prop.value?.type === 'Identifier') {
        result.set(prop.value.name, path)
      } else if (prop.value?.type === 'ObjectPattern') {
        walkObjectProps(prop.value.properties, path)
      } else if (prop.value?.type === 'ArrayPattern') {
        prop.value.elements.forEach((el: any, i: number) => {
          if (el?.type === 'Identifier') result.set(el.name, `${path}[${i}]`)
        })
      }
    }
  }

  if (param.type === 'ObjectPattern') {
    walkObjectProps(param.properties, '')
  } else if (param.type === 'ArrayPattern') {
    param.elements.forEach((el: any, i: number) => {
      if (el?.type === 'Identifier') result.set(el.name, `[${i}]`)
    })
  }

  return result
}

/**
 * 从 VForInfo 中提取 item 名称
 * 解构式 v-for 统一返回 'item'（WXML 的默认 for-item 名）
 */
export function getVForItemName(vForInfo: VForInfo): string {
  const forParseResult = vForInfo.forParseResult
  if (forParseResult.value && forParseResult.value.type === NodeTypes.SIMPLE_EXPRESSION) {
    if (isDestructuredVFor(vForInfo)) return 'item'
    return forParseResult.value.content
  }
  return 'item'
}

/**
 * 从 VForInfo 中提取 index 名称
 */
export function getVForIndexName(vForInfo: VForInfo): string | undefined {
  const forParseResult = vForInfo.forParseResult
  if (forParseResult.key && forParseResult.key.type === NodeTypes.SIMPLE_EXPRESSION) {
    return forParseResult.key.content
  }
  return undefined
}

/**
 * 收集一层嵌套中每级 v-for 的 index 变量名。
 *
 * 嵌套 wx:for 若各级使用同名 index，WXML 中内层会遮蔽外层，
 * 而编译期需要在同一作用域内按序解构出各级索引，会生成非法的重复声明：
 *   const { a: [index, index] } = e.currentTarget.dataset
 * 同时 WXML 侧 `{{[index,index]}}` 也只能取到内层值，无法携带外层索引。
 *
 * 这种情况下无法在保持用户原有变量名的前提下正确转译（重命名外层会破坏
 * 外层作用域中对 index 的引用），因此直接报编译错误，由用户显式改名。
 */
export function getVForIndexNames(vForInfoList: VForInfo[]): string[] {
  return vForInfoList.map((info) => getVForIndexName(info) || 'index')
}

/**
 * 校验同一嵌套链上"显式书写"的 index 变量名互不重复。
 *
 * 仅检查用户显式写出的 index 名：未显式书写时编译器会生成唯一的
 * `_<item>_<n>_index`，不会冲突。只有两级都显式写成同名（如都用 index）
 * 时才无法正确转译。
 *
 * @throws CompileError 存在显式重名时抛出，提示用户为其中一层改名
 */
export function assertUniqueVForIndexNames(vForInfoList: VForInfo[]): void {
  const explicitNames = vForInfoList
    .filter((info) => info.forParseResult.key?.type === NodeTypes.SIMPLE_EXPRESSION)
    .map((info) => (info.forParseResult.key as SimpleExpressionNode).content)

  const duplicated = explicitNames.find((name, i) => explicitNames.indexOf(name) !== i)
  if (duplicated) {
    throw createCompileError(
      `嵌套 v-for 的 index 变量名重复（"${duplicated}"）：小程序中内层会遮蔽外层，` +
        `无法同时取到各级索引。请为其中一层指定不同的变量名，` +
        `例如 v-for="(item, index) in list" 与 v-for="(child, childIndex) in item.children"。`,
    )
  }
}

/**
 * 从 VForInfo 中提取源表达式
 */
export function getVForSourceExpression(vForInfo: VForInfo): string {
  const forParseResult = vForInfo.forParseResult
  if (forParseResult.source && forParseResult.source.type === NodeTypes.SIMPLE_EXPRESSION) {
    return forParseResult.source.content
  }
  return ''
}

/**
 * 判断是否是成员表达式（如 item.children）
 */
export function isMemberExpression(vForInfo: VForInfo): boolean {
  const source = getVForSourceExpression(vForInfo)
  return source.includes('.')
}

/**
 * 获取源表达式的对象和属性部分（对于 item.children 类型）
 */
export function getVForSourceParts(vForInfo: VForInfo): { object?: string; property?: string } {
  const source = getVForSourceExpression(vForInfo)
  const parts = source.split('.')
  if (parts.length === 2) {
    return { object: parts[0], property: parts[1] }
  }
  return {}
}

/**
 * 获取父级 v-for
 * @param node
 */
export function getParentVFor(node: VMSRootNode): VForInfo | null {
  // Legacy: reads from node directly — only used outside transform context
  const vForInfoList = (node as VMSEnhancedNode).vForInfoList
  if (Array.isArray(vForInfoList)) {
    return vForInfoList.at(-1) || null
  }
  return null
}

/**
 * 获取节点中包含的v-for变量集合（从节点直接读取，仅供 eventProcessor 等内部使用）
 * @param node
 */
export function getVForVariablesFromNode(node: VMSRootNode | VMSTemplateChildNode): Set<string> {
  const vForVariables = new Set<string>()
  const list: VForInfo[] | undefined = (node as VMSEnhancedNode).vForInfoList
  list?.forEach((vForInfo) => {
    const itemName = getVForItemName(vForInfo)
    if (itemName) vForVariables.add(itemName)
    const indexName = getVForIndexName(vForInfo)
    if (indexName) vForVariables.add(indexName)
  })
  return vForVariables
}

/**
 * 获取节点中包含的v-for item变量集合
 * @param node
 */
export function getVForItemNameFromNode(node: VMSRootNode | VMSTemplateChildNode): Set<string> {
  const vForVariables = new Set<string>()
  const list: VForInfo[] | undefined = (node as VMSEnhancedNode).vForInfoList
  list?.forEach((vForInfo) => {
    const itemName = getVForItemName(vForInfo)
    if (itemName) vForVariables.add(itemName)
  })
  return vForVariables
}

/**
 * 获取节点中包含的v-for index变量集合
 * @param node
 * @returns {Set<string>}
 */
export function getVForIndexNameFromNode(node: VMSRootNode): Set<string> {
  const vForVariables = new Set<string>()
  const list: VForInfo[] | undefined = (node as VMSEnhancedNode).vForInfoList
  list?.forEach((vForInfo) => {
    const indexName = getVForIndexName(vForInfo)
    if (indexName) vForVariables.add(indexName)
  })
  return vForVariables
}

/**
 * 添加polyfill文件复制功能
 */
export async function copyPolyfillFiles() {
  try {
    // 指向项目根目录下的 polyfill 文件夹

    // 检查源目录是否存在
    if (await fs.pathExists(POLYFILL_VMS_DIR)) {
      // 目标目录存在时也必须覆盖复制，不能直接跳过：
      // polyfill 文件（wxsUtils.wxs）会随编译器版本更新，
      // 若因"产物目录已存在"而跳过，改动后的 polyfill **永远不会**进入
      // dist——表现为修复了 polyfill 但真机行为不变，属静默失效。
      // fs.copy 默认 overwrite: true，可安全地覆盖同名文件。
      await fs.copy(POLYFILL_VMS_DIR, POLYFILL_OUTPUT_DIR, { overwrite: true })
    } else {
      console.log(red('Polyfill源文件夹不存在：' + POLYFILL_VMS_DIR))
    }
  } catch (error: unknown) {
    console.error(red('❌ 复制polyfill文件失败：' + getErrorMessage(error)))
  }
}

/**
 * 获取polyfill文件在当前文件的相对路径
 * @param polyfillFileName polyfill文件名
 * @param filePath 当前文件路径
 */
export function getPolyfillFileRelativePath(polyfillFileName: string, filePath: string) {
  // 使用系统默认路径分隔符处理路径，然后统一转换为 POSIX 风格（正斜杠）
  return path
    .relative(
      path.dirname(filePath.replace(userConfig.sourceDir as string, OUTPUT_DIR)),
      path.join(OUTPUT_DIR, 'polyfill', polyfillFileName),
    )
    .split(path.sep)
    .join('/')
}

export async function copyProjectConfigFile() {
  try {
    const config = await fs.readJson(path.join(process.cwd(), 'project.config.json'))
    // 移除 miniprogramRoot/srcMiniprogramRoot，因为输出目录即为小程序根目录
    Reflect.deleteProperty(config, 'miniprogramRoot')
    Reflect.deleteProperty(config, 'srcMiniprogramRoot')

    // 项目名附加 -dev / -prod，便于在开发者工具中区分两个产物目录。
    // 注意字段名是**全小写** `projectname`（官方《项目配置文件》定义），
    // 不是 `projectName`——此前误用驼峰，导致读不到原值而生成
    // `"projectName": "undefined-dev"` 这样的字段（多余且值无意义）。
    const suffix = __IS_PROD__ ? '-prod' : '-dev'
    const baseName =
      typeof config.projectname === 'string' && config.projectname !== ''
        ? config.projectname
        : // 未配置 projectname 时退回用源目录名，避免产生 "undefined-*"
          path.basename(process.cwd())
    config.projectname = baseName.endsWith(suffix) ? baseName : baseName + suffix
    await fs.writeFile(
      path.join(OUTPUT_DIR, 'project.config.json'),
      JSON.stringify(config, null, 2),
    )
  } catch (error: unknown) {
    console.error(red('❌ 复制 project.config.json 失败：' + getErrorMessage(error)))
  }
}
