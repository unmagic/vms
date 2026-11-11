import path from 'node:path'

/**
 * 源路径 → 输出路径映射。
 *
 * 从 cli.ts 抽出：该映射带缓存，是所有产物写盘的必经之路，
 * 但一直没有单元测试。历史 P0 问题（OPTIMIZATIONS.md P0-2）正是
 * 这条缓存的一致性缺陷。
 */

export interface OutputPathMapper {
  /** 源路径 → 输出路径（带缓存） */
  toOutput: (inputPath: string) => string
  /** 清空缓存（构建结束或 app.json 变更时调用） */
  clear: () => void
  /** 使单个路径失效（文件被删除时调用） */
  invalidate: (inputPath: string) => void
}

/**
 * 判断 inputPath 是否位于 sourceDir 之内。
 *
 * 不能用裸 startsWith：`src-extra/a.ts`、`srcfoo/a.ts` 都会被误判为
 * `src` 的子路径，从而被改写成 `dist/prod-extra/a.ts` 这类错误输出路径。
 * 因此要求前缀之后紧跟路径分隔符（或完全相等）。
 */
function isInsideSourceDir(inputPath: string, sourceDir: string): boolean {
  if (inputPath === sourceDir) return true
  const prefix = sourceDir.endsWith(path.sep) ? sourceDir : sourceDir + path.sep
  return inputPath.startsWith(prefix)
}

/**
 * 去掉 sourceDir 前缀，并保证剩余部分以路径分隔符开头。
 *
 * 直接 `inputPath.slice(sourceDir.length)` 在 sourceDir 以分隔符结尾时
 * 会丢掉分隔符：`src/` + `src/pages/a.ts` → `pages/a.ts`，
 * 拼到输出目录后变成 `dist/prodpages/a.ts`。
 *
 * 调用方需先通过 isInsideSourceDir 校验。
 */
function stripSourceDir(inputPath: string, sourceDir: string): string {
  if (inputPath === sourceDir) return ''

  const normalizedSource = sourceDir.endsWith(path.sep) ? sourceDir.slice(0, -1) : sourceDir
  const rest = inputPath.slice(normalizedSource.length)

  return rest.startsWith(path.sep) ? rest : path.sep + rest
}

/**
 * 创建源→输出路径映射器。
 *
 * @param sourceDir 源码目录（相对于项目根，如 'src'）
 * @param outputDir 输出目录（绝对路径，如 /proj/dist/prod）
 */
export function createOutputPathMapper(sourceDir: string, outputDir: string): OutputPathMapper {
  const cache = new Map<string, string>()

  const toOutput = (inputPath: string): string => {
    const cached = cache.get(inputPath)
    if (cached !== undefined) return cached

    // 只替换前缀（避免 sourceDir 含正则特殊字符时替换失败）
    const mapped = isInsideSourceDir(inputPath, sourceDir)
      ? outputDir + stripSourceDir(inputPath, sourceDir)
      : inputPath

    cache.set(inputPath, mapped)
    return mapped
  }

  return {
    toOutput,
    clear: () => cache.clear(),
    invalidate: (inputPath: string) => {
      cache.delete(inputPath)
    },
  }
}
