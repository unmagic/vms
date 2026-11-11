import { describe, it, expect } from 'vitest'
import { createModuleDedupRegistry, isCoveredByBuiltLibrary } from '../src/utils/moduleDedup'

/**
 * 依赖构建去重判定原先内联在 cli.ts 的 bundleModule 中，无测试覆盖。
 * 它的边界行为（foo 与 foo-bar、foo 与 foo/plugin）直接影响
 * 哪些依赖会被构建与复制，判断过宽会导致产物缺依赖。
 */

describe('isCoveredByBuiltLibrary', () => {
  it('1.1 同名模块视为已覆盖', () => {
    expect(isCoveredByBuiltLibrary('dayjs', ['dayjs'])).toBe(true)
  })

  it('1.2 子路径视为已覆盖', () => {
    expect(isCoveredByBuiltLibrary('dayjs/plugin/customParseFormat', ['dayjs'])).toBe(true)
  })

  // 回归：裸前缀匹配会把 foo-bar 误判为 foo 的子路径而跳过构建
  it('1.3 同前缀的其它包（foo-bar）不被误判为已覆盖', () => {
    expect(isCoveredByBuiltLibrary('foo-bar', ['foo'])).toBe(false)
    expect(isCoveredByBuiltLibrary('dayjsx', ['dayjs'])).toBe(false)
  })

  it('1.4 无已构建库时返回 false', () => {
    expect(isCoveredByBuiltLibrary('lodash', [])).toBe(false)
  })

  it('1.5 多个已构建库中命中任一即覆盖', () => {
    expect(isCoveredByBuiltLibrary('b/sub', ['a', 'b', 'c'])).toBe(true)
    expect(isCoveredByBuiltLibrary('d/sub', ['a', 'b', 'c'])).toBe(false)
  })

  it('1.6 支持 Set 等任意可迭代对象', () => {
    expect(isCoveredByBuiltLibrary('dayjs', new Set(['dayjs']))).toBe(true)
  })
})

describe('createModuleDedupRegistry', () => {
  it('2.1 首次不跳过，同上下文重复调用则跳过', () => {
    const registry = createModuleDedupRegistry(() => [])
    expect(registry.shouldSkip('lodash', 'root')).toBe(false)
    expect(registry.shouldSkip('lodash', 'root')).toBe(true)
  })

  it('2.2 不同构建上下文各自独立登记', () => {
    const registry = createModuleDedupRegistry(() => [])
    expect(registry.shouldSkip('lodash', 'root')).toBe(false)
    // 同一依赖需要为独立分包各处理一次
    expect(registry.shouldSkip('lodash', 'subLock')).toBe(false)
    expect(registry.shouldSkip('lodash', 'subLock')).toBe(true)
  })

  it('2.3 已构建库覆盖的模块直接跳过，且不改变登记状态', () => {
    const built: string[] = []
    const registry = createModuleDedupRegistry(() => built)
    built.push('dayjs')
    expect(registry.shouldSkip('dayjs', 'root')).toBe(true)
    // 后续即使移除覆盖标记，也应回到"未登记"状态
    built.length = 0
    expect(registry.shouldSkip('dayjs', 'root')).toBe(false)
  })

  it('2.4 register 后 shouldSkip 返回 true', () => {
    const registry = createModuleDedupRegistry(() => [])
    registry.register('lodash', 'subLock')
    expect(registry.shouldSkip('lodash', 'subLock')).toBe(true)
  })

  it('2.5 register 不影响其它上下文', () => {
    const registry = createModuleDedupRegistry(() => [])
    registry.register('lodash', 'subLock')
    expect(registry.shouldSkip('lodash', 'subCost')).toBe(false)
  })

  it('2.6 builtLibraries 为动态 getter（构建过程中新增库即时生效）', () => {
    const built: string[] = []
    const registry = createModuleDedupRegistry(() => built)
    expect(registry.shouldSkip('newlib', 'root')).toBe(false)
    built.push('newlib')
    expect(registry.shouldSkip('newlib/sub', 'root')).toBe(true)
  })
})
