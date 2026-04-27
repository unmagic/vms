import config from '@/babel.config'
import { transformVueToMiniProgram } from '@/transformer'
import type { InputOptions } from '@/types/build'
import { OUTPUT_DIR, userConfig } from '@/utils/constants'
import { copyPolyfillFiles, copyProjectConfigFile } from '@/utils/tools'
import { handleCompileError, getErrorMessage } from '@/utils/errorHandler'
import { BabelFileResult, transformAsync, transformFileAsync } from '@babel/core'
import { traverse } from '@/utils/babelTraverse'
import t from '@babel/types'
import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import terser, { type Options } from '@rollup/plugin-terser'
import chokidar from 'chokidar'
import fs from 'fs-extra'
import { bold, green } from 'kolorist'
import { getPackageInfo } from 'local-pkg'
import path from 'node:path'
import process from 'node:process'
import { rollup } from 'rollup'
import { minify } from 'terser'
import { performance } from 'perf_hooks'

const NODE_ENV = process.env.NODE_ENV || 'production'

interface Subpackage {
  independent?: boolean
  root: string
}

interface AppJson {
  pages?: string[]
  subPackages?: Array<{
    root: string
    pages: string[]
  }>
  subpackages?: Subpackage[]
}

// 存储页面路径列表，用于判断组件是否为页面组件
let pagePaths: Set<string> | null = null
// 缓存文件路径到是否为页面组件的映射
const pageComponentCache = new Map<string, boolean>()

/**
 * 读取 app.json 并生成页面路径列表
 * 页面路径格式: pages/index/Index 或 subHome/pages/home/HomeIndex
 */
async function loadPagePaths(): Promise<Set<string>> {
  if (pagePaths) return pagePaths

  const appJsonPath = path.join(sourceDir, 'app.json')
  pagePaths = new Set<string>()

  try {
    const appJson: AppJson = await fs.readJson(appJsonPath)

    // 处理主包 pages
    if (appJson.pages) {
      for (const page of appJson.pages) {
        // page 格式: pages/index/Index
        pagePaths.add(page)
      }
    }

    // 处理分包 subPackages
    if (appJson.subPackages) {
      for (const pkg of appJson.subPackages) {
        const root = pkg.root
        for (const page of pkg.pages) {
          // 分包页面格式: subHome/pages/home/HomeIndex
          pagePaths.add(`${root}/${page}`)
        }
      }
    }

    console.log(bold(green(`加载到 ${pagePaths.size} 个页面路径`)))
  } catch (error: unknown) {
    console.warn('读取 app.json 失败:', getErrorMessage(error))
  }

  return pagePaths
}

/**
 * 判断文件路径是否为页面组件
 * @param filePath 文件路径，如 src/pages/index/Index.vue
 * @returns 是否为页面组件
 */
function isPageComponent(filePath: string): boolean {
  // 检查缓存
  const cached = pageComponentCache.get(filePath)
  if (typeof cached === 'boolean') return cached

  if (!pagePaths || pagePaths.size === 0) {
    pageComponentCache.set(filePath, false)
    return false
  }

  // 移除 sourceDir 前缀和 .vue 后缀
  const normalizedPath = path.relative(sourceDir, filePath).replace(/\.vue$/, '')

  const isPage = pagePaths.has(normalizedPath)
  pageComponentCache.set(filePath, isPage)
  return isPage
}

interface PackageJson {
  dependencies?: Record<string, string>
}

// 使用用户配置或默认值
const sourceDir = userConfig.sourceDir as string

// copyOnly 模式：跳过 Babel、直接复制的文件匹配规则
const copyOnlyPatterns: string[] = userConfig.copyOnly ?? []

// 判断文件是否应跳过 Babel 编译直接复制
function isCopyOnly(filePath: string): boolean {
  // .min.js 是已压缩的第三方文件，无需 Babel 编译
  if (filePath.endsWith('.min.js')) return true
  // .d.ts 类型声明文件不需要输出，直接跳过
  // （在 cb 中单独处理为 skip）
  // 用户自定义的 copyOnly 规则
  return copyOnlyPatterns.some((pattern) => filePath.includes(pattern))
}

// 获取 @/ 路径替换配置
const aliasPath = userConfig.alias?.['@'] || `./${sourceDir}`

// 更新 babel 配置中的别名
if (config.plugins) {
  const moduleResolverPlugin = config.plugins.find(
    (plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'module-resolver',
  )

  if (
    moduleResolverPlugin &&
    Array.isArray(moduleResolverPlugin) &&
    moduleResolverPlugin[1] &&
    typeof moduleResolverPlugin[1] === 'object'
  ) {
    const options = moduleResolverPlugin[1] as { alias?: Record<string, string> }
    if (options.alias) {
      options.alias['@'] = aliasPath
    }
  }
}

let topLevelJobs: Array<Promise<any>> | null = []
let bundleJobs: Array<Promise<any>> | null = []
const startTime = Date.now()
let __PROD__ = false
const terserOptions: Options = {
  ecma: 2016,
  toplevel: true,
  safari10: true,
  format: { comments: false },
}

let independentPackages: string[] = []

// 文件忽略规则 - 提取为常量避免重复定义
const IGNORED_FILES = (file: string, stats?: fs.Stats) => {
  if (!stats?.isFile()) return false
  return (
    file.endsWith('.gitkeep') ||
    file.endsWith('.DS_Store') ||
    file.endsWith('.d.ts') || // 类型声明文件不需要处理
    file.includes('node_modules') ||
    file.includes('.git')
  )
}

// 并行处理配置
const CONCURRENT_LIMIT = 5 // 同时处理的文件数量限制
// 开发模式使用更高并发（默认 5，可根据 CPU 核心数调整）
const DEV_CONCURRENT_LIMIT = 5

// 批量并行处理函数
async function batchProcess<T>(
  items: T[],
  processor: (item: T) => Promise<void>,
  concurrency: number = CONCURRENT_LIMIT,
): Promise<void> {
  // 将 items 分成多个批次，每批并发处理
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    await Promise.all(
      batch.map((item) =>
        processor(item).catch((error) => {
          console.error(`处理失败:`, error)
        }),
      ),
    )
  }
}

// 路径转换缓存 - 避免重复计算
const pathCache = new Map<string, string>()
function getOutputPath(inputPath: string): string {
  let cached = pathCache.get(inputPath)
  if (!cached) {
    cached = inputPath.replace(sourceDir, OUTPUT_DIR)
    pathCache.set(inputPath, cached)
  }
  return cached
}

// 清空路径缓存（在构建完成后调用）
function clearPathCache() {
  pathCache.clear()
}

async function findIndependentPackages() {
  const appJson: AppJson = await fs.readJson(path.resolve(sourceDir, 'app.json'))
  if (appJson.subpackages) {
    independentPackages = appJson.subpackages
      .filter(({ independent }) => independent)
      .map(({ root }) => root)
  }
}

const builtLibraries: string[] = []
const bundledModules = new Map<string, Set<string>>()

// 计算目录中所有源码文件的最大 mtime（用于 workspace 包缓存）
async function computeSourceMaxMtime(dir: string): Promise<number> {
  let maxMtime = 0
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      const subMtime = await computeSourceMaxMtime(fullPath)
      maxMtime = Math.max(maxMtime, subMtime)
    } else if (/\.(vue|ts|js)$/.test(entry.name)) {
      const stat = await fs.stat(fullPath)
      maxMtime = Math.max(maxMtime, stat.mtimeMs)
    }
  }
  return maxMtime
}

async function readCache(targetDir: string): Promise<{ version?: string; mtime?: number } | null> {
  const cachePath = path.join(targetDir, '.vms-cache')
  if (!(await fs.pathExists(cachePath))) return null
  try {
    return await fs.readJson(cachePath)
  } catch {
    return null
  }
}

async function writeCache(
  targetDir: string,
  cache: { version?: string; mtime?: number },
): Promise<void> {
  const cachePath = path.join(targetDir, '.vms-cache')
  await fs.ensureDir(targetDir)
  await fs.writeJson(cachePath, { ...cache, timestamp: Date.now() })
}

async function bundleModule(module: string, pkg: string) {
  const bundled = bundledModules.get(pkg)
  if (bundled?.has(module) || builtLibraries.some((library) => module.startsWith(library))) {
    return false
  }
  if (bundled) {
    bundled.add(module)
  } else {
    bundledModules.set(pkg, new Set([module]))
  }
  const pkInfo = await getPackageInfo(module)
  if (pkInfo) {
    const {
      rootPath,
      packageJson: { peerDependencies, version },
    } = pkInfo

    const targetDir = path.resolve(pkg.replace(sourceDir, OUTPUT_DIR), 'miniprogram_npm', module)

    // 检测是否为 monorepo workspace 包
    const isWorkspacePackage = rootPath && !rootPath.includes('node_modules')

    // 检查缓存
    const cache = await readCache(targetDir)
    if (cache) {
      if (isWorkspacePackage && cache.mtime) {
        const currentMtime = await computeSourceMaxMtime(rootPath)
        if (cache.mtime === currentMtime) {
          return true
        }
      } else if (!isWorkspacePackage && version && cache.version === version) {
        return true
      }
    }

    // 清空旧内容
    await fs.remove(targetDir)
    await fs.ensureDir(targetDir)

    if (isWorkspacePackage) {
      // Workspace 包：优先使用 dist/，否则直接编译源码
      const distDir = path.join(rootPath, 'dist')
      const hasDist = await fs.pathExists(distDir)

      if (hasDist) {
        await fs.copy(distDir, targetDir)
      } else {
        // 没有 dist/，复制源码并编译
        await fs.copy(rootPath, targetDir)

        const processWorkspaceFiles = async (dir: string): Promise<void> => {
          const entries = await fs.readdir(dir, { withFileTypes: true })
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              if (entry.name === 'node_modules') continue
              await processWorkspaceFiles(fullPath)
              continue
            }

            if (entry.name.endsWith('.vue')) {
              try {
                await transformVueToMiniProgram(
                  fullPath,
                  targetDir,
                  false,
                  async (generatedCode) => {
                    const result = await transformAsync(generatedCode, {
                      filename: fullPath.replace('.vue', '.js'),
                      ...config,
                    })
                    return result?.code ?? generatedCode
                  },
                  targetDir,
                )
                // 转换成功后才删除源 .vue 文件
                await fs.remove(fullPath)
              } catch (error: unknown) {
                handleCompileError('', error, fullPath)
                if (__PROD__) throw error
              }
            } else if (entry.name.endsWith('.ts')) {
              try {
                const result = await transformFileAsync(fullPath, { ast: true, ...config })
                if (result) {
                  let code = result.code as string
                  // 去除 require() 中的 .vue 扩展名
                  code = code.replace(/require\(['"]([^'"]+?)\.vue['"]\)/g, "require('$1')")
                  if (__PROD__) {
                    code = (await minify(code, terserOptions)).code as string
                  }
                  await fs.writeFile(fullPath.replace(/\.ts$/, '.js'), code)
                }
                // 编译成功后才删除源 .ts 文件
                await fs.remove(fullPath)
              } catch (error: unknown) {
                handleCompileError('', error, fullPath)
                if (__PROD__) throw error
              }
            } else if (entry.name.endsWith('.js')) {
              try {
                const result = await transformFileAsync(fullPath, { ast: true, ...config })
                if (result) {
                  let code = result.code as string
                  // 去除 require() 中的 .vue 扩展名
                  code = code.replace(/require\(['"]([^'"]+?)\.vue['"]\)/g, "require('$1')")
                  if (__PROD__) {
                    code = (await minify(code, terserOptions)).code as string
                  }
                  await fs.writeFile(fullPath, code)
                }
              } catch (error: unknown) {
                handleCompileError('', error, fullPath)
                if (__PROD__) throw error
              }
            }
          }
        }

        await processWorkspaceFiles(targetDir)
      }

      // 写入 workspace 包缓存（mtime）
      const currentMtime = await computeSourceMaxMtime(rootPath)
      await writeCache(targetDir, { mtime: currentMtime })
      return true
    }

    // 普通 npm 包：rollup 打包
    const bundle = await rollup({
      input: module,
      external: peerDependencies ? Object.keys(peerDependencies) : undefined,
      plugins: [
        commonjs(),
        replace({
          preventAssignment: true,
          values: {
            'process.env.NODE_ENV': JSON.stringify(NODE_ENV),
          },
        }),
        resolve(),
        __PROD__ && terser(terserOptions),
      ].filter(Boolean),
    })
    await bundle.write({
      exports: 'named',
      file: path.join(targetDir, 'index.js'),
      format: 'cjs',
    })

    // 写入 npm 包缓存（version）
    await writeCache(targetDir, { version })
    return true
  } else {
    console.warn(`未找到 ${module} 的依赖信息`)
    return false
  }
}

function traverseAST(ast: t.File, pkg: string, babelOnly = false) {
  traverse(ast, {
    CallExpression({ node }) {
      if (
        !t.isIdentifier(node.callee) ||
        node.callee.name !== 'require' ||
        !t.isStringLiteral(node.arguments[0]) ||
        node.arguments[0].value.startsWith('.') ||
        (babelOnly && !node.arguments[0].value.startsWith('@babel/runtime'))
      ) {
        return
      }

      const module = node.arguments[0].value

      let promise = bundleModule(module, pkg)
      if (babelOnly) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        promise = promise.then((valid) => {
          if (!valid) return
          return Promise.all(
            independentPackages.map((item) => {
              const bundled = bundledModules.get(item)
              if (bundled) {
                bundled.add(module)
              } else {
                bundledModules.set(item, new Set([module]))
              }
              return fs.copy(
                path.join(OUTPUT_DIR, 'miniprogram_npm', module),
                path.join(OUTPUT_DIR, item, 'miniprogram_npm', module),
              )
            }),
          )
        })
      }
      bundleJobs?.push(promise)
    },
  })
}

async function buildComponentLibrary(name: string) {
  const pkInfo = await getPackageInfo(name)
  if (pkInfo) {
    const {
      rootPath,
      packageJson: { miniprogram },
    } = pkInfo
    let source = ''
    if (miniprogram) {
      source = path.join(rootPath, miniprogram)
    } else {
      try {
        const dist = path.join(rootPath, 'miniprogram_dist')
        const stats = await fs.stat(dist)
        if (stats.isDirectory()) {
          source = dist
        }
      } catch {
        // Empty
      }
    }
    if (!source) return
    const destination = path.resolve(OUTPUT_DIR, 'miniprogram_npm', name)
    builtLibraries.push(name)
    // ✅ 检查目标位置是否已存在文件夹
    const destinationExists = await fs.pathExists(destination)

    if (destinationExists) {
      return
    }

    await fs.copy(source, destination)

    // 递归获取所有 .js 文件并处理（替代 watcher，更简洁可靠）
    const processJsFiles = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const jsFiles: string[] = []

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await processJsFiles(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          jsFiles.push(fullPath)
        }
      }

      // 并行处理所有 .js 文件
      await Promise.all(
        jsFiles.map(async (filePath) => {
          try {
            const result = await transformFileAsync(filePath, { ast: true, ...config })
            if (result) {
              traverseAST(result.ast!, sourceDir, true)
              const code = (
                __PROD__ ? (await minify(result.code!, terserOptions)).code : result.code
              ) as string
              await fs.writeFile(filePath, code)
            }
          } catch (error: unknown) {
            console.error(`处理 ${filePath} 失败:`, getErrorMessage(error))
          }
        }),
      )
    }

    await processJsFiles(destination)

    // 复制到独立包
    if (independentPackages.length > 0) {
      await Promise.all(
        independentPackages.map(async (item) => {
          const independentDestination = path.join(OUTPUT_DIR, item, 'miniprogram_npm', name)
          const independentDestExists = await fs.pathExists(independentDestination)
          if (!independentDestExists) {
            return fs.copy(destination, independentDestination)
          }
        }),
      )
    }
  } else {
    console.warn(`未找到 ${name} 的依赖信息`)
  }
}

async function scanDependencies() {
  try {
    const { dependencies }: PackageJson = await fs.readJson('package.json')
    if (dependencies) {
      // 并行处理所有依赖，提高启动速度
      const depNames = Object.keys(dependencies)
      console.log(bold(green(`扫描到 ${depNames.length} 个依赖，开始并行处理...`)))
      const startDepTime = Date.now()

      // 使用批量并行处理依赖
      await batchProcess(
        depNames,
        async (name) => {
          await buildComponentLibrary(name)
        },
        5,
      ) // 依赖构建限制为 5 个并发，避免过多资源占用

      console.log(bold(green(`依赖处理完成，耗时：${Date.now() - startDepTime}ms`)))
    }
  } catch (error: unknown) {
    console.warn('读取 package.json 失败:', getErrorMessage(error))
  }
}

// 缓存独立包路径的 normalize 结果
const normalizedPkgPaths = new Map<string, string>()

async function dealScriptCode(filePath: string, result: BabelFileResult) {
  const ast = result.ast as t.File
  let code = result.code as string

  // 使用缓存避免重复 path.normalize 计算
  let pkg = independentPackages.find((item) => {
    let normalized = normalizedPkgPaths.get(item)
    if (!normalized) {
      normalized = path.normalize(`${sourceDir}/${item}`)
      normalizedPkgPaths.set(item, normalized)
    }
    return filePath.startsWith(normalized)
  })

  // The `src/` prefix is added to to distinguish `src` and `src/src`.
  traverseAST(ast, pkg ? path.join(sourceDir, pkg) : sourceDir)

  if (__PROD__) {
    code = (await minify(code, terserOptions)).code as string
  }
  return code
}

async function processScript(filePath: string) {
  try {
    const result = await transformFileAsync(path.resolve(filePath), {
      ast: true,
      ...config,
    })
    if (result) {
      const code = await dealScriptCode(filePath, result)
      const destination = path.join(getOutputPath(filePath).replace(/\.ts$/, '.js'))
      // 确保目录存在
      await fs.ensureDir(path.dirname(destination))
      // 直接写入，不需要先复制源文件
      await fs.writeFile(destination, code)
    }
  } catch (error: unknown) {
    // 使用统一的编译错误处理（支持 code-frame 定位）
    handleCompileError('', error, filePath)
    if (__PROD__) throw error
    // 开发模式：打印后继续，不中断整个构建
  }
}

const cb = async (
  filePath: string,
  callbacks?: {
    vueCb?: (elapsed: number) => void
    jsCb?: (elapsed: number) => void
    othersCb?: (elapsed: number) => void
  },
) => {
  if (filePath.endsWith('.vue')) {
    const t = performance.now()
    try {
      await transformVueToMiniProgram(
        filePath,
        OUTPUT_DIR,
        isPageComponent(filePath),
        async (generatedCode) => {
          try {
            // 先生成代码，再进行转换，这样可以更好地利用默认配置
            const result = await transformAsync(generatedCode, {
              filename: filePath.replace('.vue', '.js'),
              ...config,
            })
            if (result) {
              return dealScriptCode(filePath, result)
            }
            return `Failed to transformAsync ${filePath}`
          } catch (error: any) {
            // 使用统一的编译错误处理（支持 code-frame 定位）
            handleCompileError('', error, filePath)
            // 返回错误占位代码，保证输出文件存在，开发模式下不中断构建
            return `console.error('Failed to compile ${filePath}: ${error.message?.replace(/'/g, "\\'")}');`
          }
        },
      )
    } catch (error: unknown) {
      // transformer.ts 内部已调用 handleCompileError 输出带 code-frame 的错误信息
      // 此处仅在生产模式下 rethrow，开发模式静默继续，不重复打印
      if (__PROD__) throw error
      return
    } finally {
      callbacks?.vueCb?.(performance.now() - t)
    }
    return
  }
  // .d.ts 类型声明文件不需要输出，直接跳过
  if (filePath.endsWith('.d.ts')) return
  // copyOnly 模式：跳过 Babel、直接复制（.min.js 及用户配置的 copyOnly 规则）
  if (isCopyOnly(filePath)) {
    const t = performance.now()
    const destinationPath = getOutputPath(filePath)
    await fs.ensureDir(path.dirname(destinationPath))
    await fs.copy(filePath, destinationPath)
    callbacks?.othersCb?.(performance.now() - t)
    return
  }
  if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
    const t = performance.now()
    await processScript(filePath)
    callbacks?.jsCb?.(performance.now() - t)
    return
  }

  const t = performance.now()
  const destinationPath = path.join(getOutputPath(filePath))
  await fs.copy(filePath, path.normalize(destinationPath))
  callbacks?.othersCb?.(performance.now() - t)
}

async function dev() {
  __PROD__ = false

  const t0 = Date.now()
  // 复制polyfill文件
  copyPolyfillFiles()
    .then(() => {
      console.log(bold(green(`[timing] copyPolyfillFiles: ${Date.now() - t0}ms`)))
      return copyProjectConfigFile()
    })
    .then(() => {
      console.log(bold(green(`[timing] copyProjectConfigFile: ${Date.now() - t0}ms`)))
      return loadPagePaths()
    })
    .then(() => {
      console.log(bold(green(`[timing] loadPagePaths: ${Date.now() - t0}ms`)))
      return findIndependentPackages()
    })
    .then(() => {
      console.log(bold(green(`[timing] findIndependentPackages: ${Date.now() - t0}ms`)))
      return scanDependencies()
    })
    .then(() => {
      console.log(bold(green(`[timing] scanDependencies: ${Date.now() - t0}ms`)))
      // 用于跟踪正在处理的文件，避免重复处理
      const processingFiles = new Set<string>()
      // 用于排队：编译期间又触发了 change 的文件
      const pendingFiles = new Set<string>()
      // 用于收集初始扫描的文件，进行批量并行处理
      const initialFiles: string[] = []
      let isInitialScan = true

      chokidar
        .watch([sourceDir], {
          awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
          ignored: IGNORED_FILES,
          usePolling: false,
          interval: 100,
        })
        .on('add', (filePath) => {
          if (isInitialScan) {
            // 初始扫描阶段，收集文件用于批量处理
            initialFiles.push(filePath)
          } else {
            // 运行时新增文件，立即处理
            const promise = cb(filePath)
            topLevelJobs?.push(promise)
          }
        })
        .on('addDir', (dirPath) => {
          // 新建目录时，在输出目录同步创建
          const outputDir = getOutputPath(dirPath)
          const promise = fs.ensureDir(outputDir)
          topLevelJobs?.push(promise)
        })
        .on('unlink', async (filePath) => {
          // 文件删除时同步删除目标文件
          const outputPath = getOutputPath(filePath)
          const basePath = outputPath.replace(/\.vue$/, '')
          const filesToDelete = filePath.endsWith('.vue')
            ? [`${basePath}.js`, `${basePath}.wxml`, `${basePath}.wxss`, `${basePath}.json`]
            : [path.join(outputPath)]

          try {
            await Promise.all(filesToDelete.map((f) => fs.remove(f)))
            // 同步移除 pathCache 中的缓存
            pathCache.delete(filePath)
          } catch (error: unknown) {
            console.warn(`删除目标文件失败：${filesToDelete.join(', ')}`, getErrorMessage(error))
          }
        })
        .on('unlinkDir', async (dirPath) => {
          // 目录删除时同步删除输出目录
          const outputDir = getOutputPath(dirPath)
          try {
            await fs.remove(outputDir)
          } catch (error: unknown) {
            console.warn(`删除目标目录失败：${outputDir}`, getErrorMessage(error))
          }
        })
        .on('change', async (filePath) => {
          // 如果文件正在处理中，标记需要重新处理（排队一次），不直接丢弃
          if (processingFiles.has(filePath)) {
            pendingFiles.add(filePath)
            return
          }

          // 使用循环代替递归，避免调用栈过深
          const runCompile = async (initialPath: string) => {
            let targetPath: string | null = initialPath
            while (targetPath) {
              processingFiles.add(targetPath)
              const date = Date.now()
              console.log(bold(green(`文件已修改：${targetPath}`)))
              let shouldContinue = false
              try {
                await cb(targetPath)
                console.log(bold(green(`文件已处理完毕，耗时：${Date.now() - date}ms`)))
              } finally {
                processingFiles.delete(targetPath)
                // 如果编译期间又有新的保存，继续循环处理
                if (pendingFiles.has(targetPath)) {
                  pendingFiles.delete(targetPath)
                  shouldContinue = true
                }
              }
              if (!shouldContinue) {
                break
              }
            }
          }

          await runCompile(filePath)
        })
        .on('ready', async () => {
          // 标记初始扫描完成
          isInitialScan = false
          console.log(
            bold(
              green(
                `[timing] chokidar ready（文件扫描完成）: ${Date.now() - t0}ms，共 ${initialFiles.length} 个文件`,
              ),
            ),
          )

          // 统计文件类型
          const vueFiles = initialFiles.filter((f) => f.endsWith('.vue'))
          const tsFiles = initialFiles.filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
          const otherFiles = initialFiles.filter(
            (f) => !f.endsWith('.vue') && !f.endsWith('.ts') && !f.endsWith('.js'),
          )
          console.log(
            bold(
              green(
                `[timing] 文件分布：vue=${vueFiles.length}, ts/js=${tsFiles.length}, 其他=${otherFiles.length}`,
              ),
            ),
          )

          // 文件处理器（带计时）
          let vueTime = 0,
            tsTime = 0,
            otherTime = 0
          const fileProcessor = async (filePath: string) => {
            await cb(filePath, {
              vueCb: (elapsed) => {
                vueTime += elapsed
              },
              jsCb: (elapsed) => {
                tsTime += elapsed
              },
              othersCb: (elapsed) => {
                otherTime += elapsed
              },
            })
          }

          // 使用批量并行处理初始文件（开发模式使用更高并发）
          if (initialFiles.length > 0) {
            console.log(
              bold(
                green(
                  `开始并行处理 ${initialFiles.length} 个文件（并发=${DEV_CONCURRENT_LIMIT}）...`,
                ),
              ),
            )
            const processStartTime = Date.now()
            await batchProcess(initialFiles, fileProcessor, DEV_CONCURRENT_LIMIT)
            console.log(
              bold(
                green(
                  `[timing] 并行处理完成：${Date.now() - processStartTime}ms（总耗时 ${Date.now() - t0}ms）`,
                ),
              ),
            )
            console.log(
              bold(
                green(
                  `[timing] 耗时分布：vue=${vueTime}ms, ts/js=${tsTime}ms, 其他=${otherTime}ms`,
                ),
              ),
            )
          }

          await Promise.all(bundleJobs!)
          console.log(bold(green(`启动完成，耗时：${Date.now() - startTime}ms`)))
          console.log(bold(green('监听文件变化中...')))
          // Release memory.
          topLevelJobs = null
          bundleJobs = null
          // 开发模式下不清空缓存，保持性能优势
        })
    })
}

async function prod(options: InputOptions) {
  __PROD__ = true

  return new Promise<void>((resolve, reject) => {
    fs.remove(OUTPUT_DIR)
      .then(() => copyPolyfillFiles())
      .then(() => copyProjectConfigFile())
      .then(() => loadPagePaths())
      .then(() => findIndependentPackages())
      .then(() => scanDependencies())
      .then(() => {
        const initialFiles: string[] = []
        let isInitialScan = true

        const watcher = chokidar.watch([sourceDir], {
          ignored: IGNORED_FILES,
        })
        watcher.on('add', (filePath) => {
          if (isInitialScan) {
            initialFiles.push(filePath)
          } else {
            const promise = cb(filePath)
            topLevelJobs!.push(promise)
          }
        })
        watcher.on('ready', async () => {
          isInitialScan = false
          // 文件处理器
          const fileProcessor = async (filePath: string) => {
            await cb(filePath)
          }

          // 使用批量并行处理初始文件（生产环境使用更高的并发数）
          if (initialFiles.length > 0) {
            console.log(bold(green(`开始并行处理 ${initialFiles.length} 个文件...`)))
            const processStartTime = Date.now()
            await batchProcess(initialFiles, fileProcessor, CONCURRENT_LIMIT)
            console.log(bold(green(`并行处理完成，耗时：${Date.now() - processStartTime}ms`)))
          }

          const promise = watcher.close()
          topLevelJobs!.push(promise)
          await Promise.all(topLevelJobs!)
          await Promise.all(bundleJobs!)
          // Release memory and clear cache.
          topLevelJobs = null
          bundleJobs = null
          clearPathCache()
          normalizedPkgPaths.clear()

          if (options.upload) {
            const { default: ci } = await import('miniprogram-ci')
            const project = new ci.Project({
              appid: userConfig.wx.appid,
              type: 'miniProgram',
              projectPath: OUTPUT_DIR,
              privateKeyPath: userConfig.wx.privateKeyPath,
              ignores: [],
            })
            console.log(bold(green('上传中...')))
            // 读取位于 projectPath 下的 project.config.json
            const uploadResult = await ci.upload({
              project,
              version: userConfig.wx.version,
              desc: userConfig.wx.description,
              setting: {
                useProjectConfig: true,
              },
              onProgressUpdate: void 0,
            })
            console.log(bold(green(`上传结果：`)), uploadResult, '当前编译环境：', NODE_ENV)
          }
          resolve()
        })
      })
      .catch(reject)
  })
}

export { dev, prod }
