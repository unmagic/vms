import { describe, it, expect, vi } from 'vitest'
import { analyzeScriptScope } from '../src/script/scopeAnalyzer'

/**
 * `analyzeScriptScope` 解析失败时**只抛错、不打印**。
 *
 * 回归背景：它此前既 `handleCompileError` 打印、又 rethrow，
 * 而上层 `transformer.ts` 捕获后**再次打印**——同一个语法错误被输出两次，
 * 各带一份完整堆栈，与 cli.ts 中"此处不重复打印"的注释相矛盾。
 */
describe('analyzeScriptScope 的错误输出职责', () => {
  it('语法错误时抛错，但不自行打印', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => analyzeScriptScope('const x = ((((')).toThrow()

    const printed = errSpy.mock.calls.length + warnSpy.mock.calls.length
    errSpy.mockRestore()
    warnSpy.mockRestore()

    // 打印交给上层统一处理，本函数不应输出任何内容
    expect(printed).toBe(0)
  })

  it('合法脚本正常返回 scope 与 ast', () => {
    const { scope, ast } = analyzeScriptScope("import { ref } from 'x'\nconst a = ref(1)")
    expect(ast).toBeTruthy()
    expect(scope.imports.has('ref')).toBe(true)
  })

  it('保留 filePath 形参（签名稳定），传入也不影响抛错行为', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => analyzeScriptScope('const y = ((((', '/tmp/A.vue')).toThrow()
    expect(errSpy.mock.calls.length).toBe(0)
    errSpy.mockRestore()
  })
})
