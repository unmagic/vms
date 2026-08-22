import type { VForInfo, VMSRootNode, VMSTemplateChildNode, VMSEnhancedNode } from '@/types/node'
import path from 'node:path'
import fs from 'fs-extra'
import { red } from 'kolorist'
import { getErrorMessage } from '@/utils/errorHandler'
import {
  POLYFILL_OUTPUT_DIR,
  POLYFILL_VMS_DIR,
  userConfig,
  OUTPUT_DIR,
  __IS_PROD__,
} from '@/utils/constants'
import { NodeTypes } from '@vue/compiler-core'

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
      // 检查目标目录是否已存在
      const outputExists = await fs.pathExists(POLYFILL_OUTPUT_DIR)
      if (outputExists) {
        // 如果目标目录已存在，跳过复制
        return
      }
      // 复制所有polyfill文件到目标目录
      await fs.copy(POLYFILL_VMS_DIR, POLYFILL_OUTPUT_DIR)
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
    config.projectName = config.projectName + (__IS_PROD__ ? '-prod' : '-dev')
    await fs.writeFile(
      path.join(OUTPUT_DIR, 'project.config.json'),
      JSON.stringify(config, null, 2),
    )
  } catch (error: unknown) {
    console.error(red('❌ 复制 project.config.json 失败：' + getErrorMessage(error)))
  }
}
