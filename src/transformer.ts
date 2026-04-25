import { parse as parseSFC, type SFCDescriptor } from '@vue/compiler-sfc'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { parseStyles } from '@/style'
import { parseScript, analyzeScriptScope, createEmptyScriptScope } from '@/script'
import { parseTemplate } from '@/template'
import type { VueComponentImport } from '@/types/node'
import { handleCompileError, getErrorMessage } from '@/utils/errorHandler'
import { deepMerge } from '@/utils/merge'
import { userConfig } from './utils/constants'

const srcDir = join(process.cwd(), userConfig.sourceDir as string)

// 处理组件路径，将@/转换为相对路径
function resolveComponentPath(importPath: string): string {
  if (importPath.startsWith('@/')) {
    return importPath.replace('@/', '/')
  }
  return importPath
}

// 处理组件导入，生成usingComponents配置
function generateUsingComponents(
  imports: VueComponentImport[],
  thirdPartyComponents: Map<string, string>,
): Record<string, string> {
  const usingComponents: Record<string, string> = {}

  imports.forEach((imp) => {
    if (imp.path.endsWith('.vue')) {
      const componentName = imp.name
      const componentPath = resolveComponentPath(imp.path)
      // 移除.vue后缀
      usingComponents[componentName] = componentPath.replace(/\.vue$/, '')
    }
  })
  thirdPartyComponents.forEach((value, key) => {
    usingComponents[key] = value
  })
  return usingComponents
}

export async function transformVueToMiniProgram(
  filePath: string,
  outputDir: string,
  isPage: boolean = false,
  cb: (script: string) => Promise<string>,
) {
  const vueContent = readFileSync(filePath, 'utf-8')
  const { descriptor } = parseSFC(vueContent, {
    filename: filePath,
    templateParseOptions: { comments: false },
  })
  const { template, scriptSetup, styles } = descriptor as SFCDescriptor

  if (!template?.ast) {
    return
  }

  try {
    // 1. 先分析 script 作用域（提取 props、宏、导入等信息）
    // 纯模板组件使用空的 scriptScope
    const scriptScope = !scriptSetup
      ? createEmptyScriptScope()
      : analyzeScriptScope(scriptSetup.content, filePath)

    // 2. 转换 template（传入 scriptScope 用于变量来源分析）
    const {
      wxmlContent,
      returnValue,
      thirdPartyComponents,
      bridgedFunctions,
      internalVars,
      renderVars,
      needsProxyRefs,
    } = parseTemplate(template.ast, filePath, isPage, scriptScope)

    // 3. 转换 script（纯模板组件传递 null 作为 scriptSetup）
    const result = await parseScript(
      descriptor,
      returnValue,
      bridgedFunctions,
      internalVars,
      renderVars,
      needsProxyRefs,
      isPage,
      scriptScope,
    )

    // 4. 转换 styles
    const css = parseStyles(styles)

    // 5. 生成文件夹
    const componentDir = join(outputDir, relative(srcDir, dirname(filePath)))
    if (!existsSync(componentDir)) {
      await mkdir(componentDir, { recursive: true })
    }

    // 生成json配置
    const baseJsonConfig: Record<string, unknown> = {
      component: true,
      styleIsolation: 'apply-shared',
      usingComponents: generateUsingComponents(result.vueComponentImports, thirdPartyComponents),
    }
    const jsonConfig = result.defineOptionsObject
      ? deepMerge(baseJsonConfig, result.defineOptionsObject)
      : baseJsonConfig
    // const script = result.script
    const script = await cb(result.script)

    // 5. 输出文件（仅在内容发生变化时）
    const componentName = basename(filePath, '.vue')
    const wxmlPath = join(componentDir, `${componentName}.wxml`)
    const jsPath = join(componentDir, `${componentName}.js`)
    const wxssPath = join(componentDir, `${componentName}.wxss`)
    const jsonPath = join(componentDir, `${componentName}.json`)

    const jsonContent = JSON.stringify(jsonConfig, null, 2)

    // 批量异步写入文件（仅在内容变化时）
    return Promise.all([
      writeFileIfChangedAsync(wxmlPath, wxmlContent),
      writeFileIfChangedAsync(jsPath, script),
      writeFileIfChangedAsync(wxssPath, css),
      writeFileIfChangedAsync(jsonPath, jsonContent),
    ])
  } catch (e: any) {
    handleCompileError(descriptor.source, e, filePath)
    return Promise.reject(e)
  }
}

// 流式计算文件 MD5 哈希（避免大文件内存占用）
function streamHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// 计算字符串 MD5 哈希
function stringHash(content: string): string {
  return createHash('md5').update(content).digest('hex')
}

// 仅在内容变化时写入文件的辅助函数 - 异步版本
// 优化策略：
// 1. 文件不存在时直接写入（首次编译）
// 2. 文件大小不同时直接写入（快速路径）
// 3. 文件大小相同时，使用流式 MD5 哈希比较（避免大文件内存占用）
//    注意：即使新内容很小，旧文件可能曾经很大，所以统一使用流式读取
async function writeFileIfChangedAsync(filePath: string, newContent: string): Promise<void> {
  try {
    // 如果文件不存在，直接写入（首次编译场景）
    if (!existsSync(filePath)) {
      await writeFile(filePath, newContent, 'utf-8')
      return
    }

    // 获取现有文件的统计信息
    const existingStat = await stat(filePath)
    const newContentLength = Buffer.byteLength(newContent, 'utf8')

    // 快速路径：文件大小不同，内容肯定不同，直接写入
    if (existingStat.size !== newContentLength) {
      await writeFile(filePath, newContent, 'utf-8')
      return
    }

    // 文件大小相同，使用流式 MD5 哈希比较
    // 使用流式读取避免大文件内存占用（如旧文件曾达到 500KB+）
    const [existingHash, newHash] = await Promise.all([
      streamHash(filePath),
      Promise.resolve(stringHash(newContent)),
    ])
    if (existingHash === newHash) {
      return // 内容相同，跳过写入
    }

    // 内容不同，写入文件
    await writeFile(filePath, newContent, 'utf-8')
  } catch (error: unknown) {
    console.error(`❌ 写入文件失败 ${filePath}:`, getErrorMessage(error))
    throw error
  }
}
