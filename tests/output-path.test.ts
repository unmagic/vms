import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { createOutputPathMapper } from '../src/utils/outputPath'

/**
 * 源→输出路径映射原先内联在 cli.ts 中且无测试覆盖。
 * 它是所有产物写盘的必经之路，历史 P0 缓存一致性问题（P0-2）就出在这里。
 */

const SOURCE = 'src'
const OUTPUT = path.resolve('/proj/dist/prod')

describe('createOutputPathMapper', () => {
  it('1.1 sourceDir 下的路径映射到输出目录', () => {
    const mapper = createOutputPathMapper(SOURCE, OUTPUT)
    expect(mapper.toOutput('src/pages/a.ts')).toBe(path.join(OUTPUT, 'pages/a.ts'))
  })

  it('1.2 嵌套子目录正确保留', () => {
    const mapper = createOutputPathMapper(SOURCE, OUTPUT)
    expect(mapper.toOutput('src/subHome/pages/home/Home.vue')).toBe(
      path.join(OUTPUT, 'subHome/pages/home/Home.vue'),
    )
  })

  it('1.3 不在 sourceDir 下的路径原样返回', () => {
    const mapper = createOutputPathMapper(SOURCE, OUTPUT)
    expect(mapper.toOutput('other/a.ts')).toBe('other/a.ts')
  })

  // 回归：旧实现用裸 startsWith(sourceDir)，导致同前缀的兄弟目录被误映射：
  //   src-extra/a.ts -> <output>-extra/a.ts
  //   srcfoo/a.ts    -> <output>foo/a.ts
  // 会产生错误的输出路径（写到预期之外的位置）。
  it('1.4 同前缀的兄弟目录（src-extra）不被误映射', () => {
    const mapper = createOutputPathMapper(SOURCE, OUTPUT)
    expect(mapper.toOutput('src-extra/a.ts')).toBe('src-extra/a.ts')
  })

  it('1.5 同前缀目录（srcfoo）不被误映射', () => {
    const mapper = createOutputPathMapper(SOURCE, OUTPUT)
    expect(mapper.toOutput('srcfoo/a.ts')).toBe('srcfoo/a.ts')
  })

  it('1.6 完全等于 sourceDir 的路径可映射', () => {
    const mapper = createOutputPathMapper(SOURCE, OUTPUT)
    expect(mapper.toOutput('src')).toBe(OUTPUT)
  })

  // 回归：抽取实现时最初用 `inputPath.slice(sourceDir.length)` 去掉前缀，
  // sourceDir 以分隔符结尾时会丢掉分隔符，输出路径变成 `dist/prodpages/a.ts`。
  it('1.7 带结尾分隔符的 sourceDir 也能正确处理', () => {
    const mapper = createOutputPathMapper(`src${path.sep}`, OUTPUT)
    expect(mapper.toOutput(`src${path.sep}pages${path.sep}a.ts`)).toBe(
      path.join(OUTPUT, `pages${path.sep}a.ts`),
    )
    expect(mapper.toOutput('src-extra/a.ts')).toBe('src-extra/a.ts')
  })

  it('2.1 缓存命中：同一输入返回同一结果', () => {
    const mapper = createOutputPathMapper(SOURCE, OUTPUT)
    const first = mapper.toOutput('src/a.ts')
    const second = mapper.toOutput('src/a.ts')
    expect(second).toBe(first)
  })

  it('2.2 clear 后结果不变（纯映射，无副作用）', () => {
    const mapper = createOutputPathMapper(SOURCE, OUTPUT)
    const before = mapper.toOutput('src/a.ts')
    mapper.clear()
    expect(mapper.toOutput('src/a.ts')).toBe(before)
  })

  it('2.3 invalidate 后重新计算结果一致', () => {
    const mapper = createOutputPathMapper(SOURCE, OUTPUT)
    const before = mapper.toOutput('src/a.ts')
    mapper.invalidate('src/a.ts')
    expect(mapper.toOutput('src/a.ts')).toBe(before)
  })

  it('2.4 空字符串输入不崩溃', () => {
    const mapper = createOutputPathMapper(SOURCE, OUTPUT)
    expect(mapper.toOutput('')).toBe('')
  })
})
