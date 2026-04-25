import type { VForInfo, VMSRootNode, VMSTemplateChildNode } from '@/types/node'
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
 * 从 VForInfo 中提取 item 名称
 */
export function getVForItemName(vForInfo: VForInfo): string {
  const forParseResult = vForInfo.forParseResult
  if (forParseResult.value && forParseResult.value.type === NodeTypes.SIMPLE_EXPRESSION) {
    return forParseResult.value.content
  }
  return ''
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
  const vForInfoList = (node as any).vForInfoList
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
  const list: VForInfo[] | undefined = (node as any).vForInfoList
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
  const list: VForInfo[] | undefined = (node as any).vForInfoList
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
  const list: VForInfo[] | undefined = (node as any).vForInfoList
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

export function copyProjectConfigFile() {
  return fs.readJson(path.join(process.cwd(), 'project.config.json')).then((config) => {
    // 读取根目录下的project.config.json，并修改miniprogramRoot字段为：'./'，后写入到输出目录
    Reflect.deleteProperty(config, 'miniprogramRoot')
    Reflect.deleteProperty(config, 'srcMiniprogramRoot')
    config.projectName = config.projectName + (__IS_PROD__ ? '-prod' : '-dev')
    return fs.writeFile(
      path.join(OUTPUT_DIR, 'project.config.json'),
      JSON.stringify(config, null, 2),
    )
  })
}
