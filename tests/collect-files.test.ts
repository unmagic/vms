import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectFilesByExtension } from '../src/utils/collectFiles'

/**
 * 递归文件收集原先内联在 cli.ts 的 buildComponentLibrary 中，
 * 与并发转译、minify、写回混在一起，无法单独测试。
 * 抽出后覆盖目录判定、后缀过滤、异常容忍等边界。
 */

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vms-collect-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function seed(files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, content, 'utf-8')
  }
}

describe('collectFilesByExtension', () => {
  it('1.1 只收集匹配后缀的文件', async () => {
    await seed({
      'a.js': '1',
      'b.ts': '2',
      'c.json': '3',
      'd.wxml': '4',
    })
    const files = await collectFilesByExtension(dir, ['.js'])
    expect(files.map((f) => f.replace(dir + '/', ''))).toEqual(['a.js'])
  })

  it('1.2 递归收集子目录中的文件', async () => {
    await seed({
      'a.js': '1',
      'sub/b.js': '2',
      'sub/deep/c.js': '3',
    })
    const files = await collectFilesByExtension(dir, ['.js'])
    expect(files).toHaveLength(3)
    expect(files.some((f) => f.endsWith('sub/deep/c.js'))).toBe(true)
  })

  it('1.3 支持多个后缀', async () => {
    await seed({ 'a.js': '1', 'b.mjs': '2', 'c.cjs': '3' })
    const files = await collectFilesByExtension(dir, ['.js', '.mjs', '.cjs'])
    expect(files).toHaveLength(3)
  })

  it('1.4 后缀按结尾匹配（min.js 也命中 .js）', async () => {
    await seed({ 'lib.min.js': '1', 'nojs.jsx': '2' })
    const files = await collectFilesByExtension(dir, ['.js'])
    // 原实现用 endsWith('.js')，lib.min.js 应当被收集
    expect(files.some((f) => f.endsWith('lib.min.js'))).toBe(true)
    expect(files.some((f) => f.endsWith('nojs.jsx'))).toBe(false)
  })

  it('1.5 空目录返回空数组', async () => {
    expect(await collectFilesByExtension(dir, ['.js'])).toEqual([])
  })

  it('1.6 目录不存在时返回空数组而非抛错', async () => {
    // 原实现在 readdir 失败时会让整个依赖构建失败；
    // 抽出后明确容忍缺失目录，交由调用方决定是否告警
    await expect(collectFilesByExtension(join(dir, 'not-exist'), ['.js'])).resolves.toEqual([])
  })

  it('1.7 不跟随符号链接（避免循环与越界）', async () => {
    await seed({ 'real/a.js': '1' })
    try {
      await symlink(join(dir, 'real'), join(dir, 'link'))
    } catch {
      return // 平台不支持符号链接时跳过
    }
    const files = await collectFilesByExtension(dir, ['.js'])
    // 只应收集 real/ 下的真实文件，不重复收集 link/ 指向的内容
    expect(files).toHaveLength(1)
    expect(files[0]).toContain('real')
  })

  it('1.8 返回绝对路径', async () => {
    await seed({ 'nested/a.js': '1' })
    const files = await collectFilesByExtension(dir, ['.js'])
    expect(files[0].startsWith('/') || /^[A-Za-z]:/.test(files[0])).toBe(true)
  })
})
