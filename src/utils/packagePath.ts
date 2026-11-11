import path from 'node:path'

/**
 * 独立分包路径归属判断。
 *
 * 从 cli.ts 抽出：该判断决定"某个源文件属于哪个独立分包"，
 * 进而决定该文件引用的 npm 依赖要复制到哪个分包的 miniprogram_npm 下。
 * 判断错误会导致依赖复制到错误位置，属产物正确性问题。
 */

/**
 * 判断 filePath 是否位于 rootDir 之内。
 *
 * 不能用裸 startsWith：`src/subLock2/a.ts` 会被误判为属于 `src/subLock`，
 * 从而把依赖复制到错误的分包目录。要求前缀之后紧跟路径分隔符（或完全相等）。
 */
export function isPathInside(filePath: string, rootDir: string): boolean {
  if (filePath === rootDir) return true
  const prefix = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep
  return filePath.startsWith(prefix)
}

/**
 * 找出文件所属的独立分包 root。
 *
 * @param filePath 源文件路径
 * @param sourceDir 源码目录（如 'src'）
 * @param independentPackages 独立分包 root 列表（如 ['subLock']）
 * @returns 命中的分包 root；不属于任何独立分包时返回 undefined
 */
export function findOwningIndependentPackage(
  filePath: string,
  sourceDir: string,
  independentPackages: string[],
): string | undefined {
  return independentPackages.find((item) =>
    isPathInside(filePath, path.normalize(`${sourceDir}/${item}`)),
  )
}
