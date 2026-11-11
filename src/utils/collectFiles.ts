import fs from 'fs-extra'
import path from 'node:path'

/**
 * 递归收集目录下的文件。
 *
 * 从 cli.ts 的 buildComponentLibrary 抽出：原实现把"递归遍历目录"
 * 与"并发转译 + minify + 写回"混在同一个函数里，
 * 遍历逻辑本身（目录判定、后缀过滤、符号链接）无法单独测试。
 */

/**
 * 递归收集 dir 下所有以 extensions 结尾的文件（返回绝对路径）。
 *
 * - 只返回普通文件（`entry.isFile()`），跳过目录与符号链接等其它类型
 * - extensions 形如 ['.js']，匹配文件名后缀
 * - 目录不存在或不可读时返回空数组（由调用方决定是否告警），不抛错
 *
 * @param dir 起始目录
 * @param extensions 允许的文件后缀列表
 */
export async function collectFilesByExtension(
  dir: string,
  extensions: string[],
): Promise<string[]> {
  const result: string[] = []

  const walk = async (current: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      // 目录不存在或权限不足：跳过该分支，避免整个依赖构建失败
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
        result.push(fullPath)
      }
    }
  }

  await walk(dir)
  return result
}
