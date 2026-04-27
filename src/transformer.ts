import { parse as parseSFC, type SFCDescriptor } from '@vue/compiler-sfc'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve as pathResolve } from 'node:path'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { parse as babelParse } from '@babel/parser'
import * as t from '@babel/types'
import { getPackageInfo } from 'local-pkg'
import { parseStyles } from '@/style'
import { parseScript, analyzeScriptScope, createEmptyScriptScope } from '@/script'
import { parseTemplate } from '@/template'
import type { VueComponentImport, PackageNamedImport } from '@/types/node'
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

// 包入口解析缓存：source -> Map<exportedName, 相对于包 rootPath 的路径（不带 .vue 后缀）>
const packageExportMapCache = new Map<string, Promise<Map<string, string> | null>>()

/**
 * 解析某个包入口，收集 `export { default as X } from './xxx.vue'` 这类 re-export
 * 返回一个 Map：exportedName -> 相对于包 rootPath 的路径（不含 .vue 后缀）
 */
async function resolvePackageVueExports(source: string): Promise<Map<string, string> | null> {
  if (packageExportMapCache.has(source)) {
    return packageExportMapCache.get(source)!
  }
  const promise = (async (): Promise<Map<string, string> | null> => {
    try {
      const pkInfo = await getPackageInfo(source)
      if (!pkInfo) return null
      const { rootPath, packageJson } = pkInfo
      if (!rootPath) return null

      // 定位包入口文件
      const mainField = (packageJson.main as string) || 'index.js'
      const entryFile = pathResolve(rootPath, mainField)
      if (!existsSync(entryFile)) return null

      const content = readFileSync(entryFile, 'utf-8')
      const ast = babelParse(content, {
        sourceType: 'module',
        plugins: ['typescript'],
        errorRecovery: true,
      })

      const map = new Map<string, string>()
      for (const node of ast.program.body) {
        // 形如 export { default as AppEmpty } from './components/AppEmpty.vue'
        if (
          t.isExportNamedDeclaration(node) &&
          node.source &&
          typeof node.source.value === 'string' &&
          node.source.value.endsWith('.vue')
        ) {
          const relPath = node.source.value // 相对于入口文件所在目录
          const resolved = pathResolve(dirname(entryFile), relPath)
          const relFromRoot = relative(rootPath, resolved).replace(/\.vue$/, '')
          for (const spec of node.specifiers) {
            if (t.isExportSpecifier(spec) && t.isIdentifier(spec.exported)) {
              map.set(spec.exported.name, relFromRoot)
            }
          }
        }
      }
      return map
    } catch (error) {
      console.warn(`⚠️  解析包入口失败 ${source}:`, getErrorMessage(error))
      return null
    }
  })()
  packageExportMapCache.set(source, promise)
  return promise
}

/**
 * 基于 packageImports 生成 usingComponents：
 * 对于 re-export 的 .vue 组件，使用 `<pkgName>/<relativePath>` 形式
 * （可被微信小程序自动解析到 miniprogram_npm 下对应目录）
 */
async function resolvePackageUsingComponents(
  packageImports: PackageNamedImport[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  // 先按 source 分组，避免重复解析
  const bySource = new Map<string, PackageNamedImport[]>()
  for (const imp of packageImports) {
    const list = bySource.get(imp.source)
    if (list) list.push(imp)
    else bySource.set(imp.source, [imp])
  }
  await Promise.all(
    Array.from(bySource.entries()).map(async ([source, imports]) => {
      const exportMap = await resolvePackageVueExports(source)
      if (!exportMap) return
      for (const imp of imports) {
        const relPath = exportMap.get(imp.imported)
        if (relPath) {
          // 形如 @wechat/ui-components/src/components/AppEmpty
          // 使用 posix 分隔符
          result[imp.name] = `${source}/${relPath.split(/[\\/]/).join('/')}`
        }
      }
    }),
  )
  return result
}

// 处理组件导入，生成usingComponents配置
function generateUsingComponents(
  imports: VueComponentImport[],
  thirdPartyComponents: Map<string, string>,
  packageComponents: Record<string, string>,
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
  // package 导入的 Vue 组件（来自 workspace/npm 包的 re-export）
  Object.entries(packageComponents).forEach(([key, value]) => {
    usingComponents[key] = value
  })
  return usingComponents
}

export async function transformVueToMiniProgram(
  filePath: string,
  outputDir: string,
  isPage: boolean = false,
  cb: (script: string) => Promise<string>,
  baseDir?: string,
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
    const componentDir = join(outputDir, relative(baseDir ?? srcDir, dirname(filePath)))
    if (!existsSync(componentDir)) {
      await mkdir(componentDir, { recursive: true })
    }

    // 解析 package 导入对应的 Vue 组件（异步、带缓存）
    const packageComponents = await resolvePackageUsingComponents(result.packageImports ?? [])

    // 生成json配置
    const baseJsonConfig: Record<string, unknown> = {
      component: true,
      styleIsolation: 'apply-shared',
      usingComponents: generateUsingComponents(
        result.vueComponentImports,
        thirdPartyComponents,
        packageComponents,
      ),
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
