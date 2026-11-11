import fs from 'fs-extra'
import path from 'node:path'

/**
 * app.json 读取与页面路径识别。
 *
 * 从 cli.ts 抽出：这部分承载"哪些文件是页面组件"的判断，
 * 历史上出现过缓存不一致问题（OPTIMIZATIONS.md P0-1/P0-2），
 * 但一直没有单元测试。抽出后可以针对路径归一化与分包解析补测试。
 */

export interface AppJson {
  pages?: string[]
  subPackages?: Array<{
    root: string
    pages: string[]
    independent?: boolean
  }>
  /** 微信同时接受小写别名，需一并兼容 */
  subpackages?: Array<{
    root: string
    pages: string[]
    independent?: boolean
  }>
}

/**
 * 读取 app.json 中的全部条目（兼容 subPackages / subpackages 两种写法）。
 *
 * ⚠️ 微信官方 app.json 使用驼峰 `subPackages`，小写 `subpackages` 是别名。
 * 只读其中一种会静默漏掉分包——曾导致独立分包识别失效。
 */
export function getSubPackages(appJson: AppJson): NonNullable<AppJson['subPackages']> {
  return appJson.subPackages ?? appJson.subpackages ?? []
}

/**
 * 从 app.json 内容生成页面路径集合。
 * 主包页面形如 `pages/index/Index`；
 * 分包页面需拼接 root，形如 `subHome/pages/home/HomeIndex`。
 */
export function collectPagePaths(appJson: AppJson): Set<string> {
  const pagePaths = new Set<string>()

  for (const page of appJson.pages ?? []) {
    pagePaths.add(page)
  }

  for (const pkg of getSubPackages(appJson)) {
    for (const page of pkg.pages ?? []) {
      pagePaths.add(`${pkg.root}/${page}`)
    }
  }

  return pagePaths
}

/** 取出标记为独立分包（independent: true）的 root 列表 */
export function collectIndependentPackages(appJson: AppJson): string[] {
  return getSubPackages(appJson)
    .filter((pkg) => pkg.independent)
    .map((pkg) => pkg.root)
}

/**
 * 将源文件绝对路径归一化为 app.json 中的页面路径（去掉 sourceDir 前缀与 .vue 后缀）。
 * 例：/proj/src/pages/index/Index.vue → pages/index/Index
 */
export function normalizePagePath(sourceDir: string, filePath: string): string {
  return path.relative(sourceDir, filePath).replace(/\.vue$/, '')
}

/**
 * 读取 app.json。读取失败时返回 null（由调用方决定是否告警）。
 */
export async function loadAppJson(sourceDir: string): Promise<AppJson | null> {
  try {
    return (await fs.readJson(path.join(sourceDir, 'app.json'))) as AppJson
  } catch {
    return null
  }
}
