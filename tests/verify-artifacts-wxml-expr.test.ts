import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * verify-artifacts.mjs 的 WXML 表达式检查。
 *
 * 该脚本此前**没有任何单元测试**。这里针对本轮新增的
 * 「WXML 不支持的运算符」检查做覆盖，并同时验证
 * 不会对 WXML 支持的运算符误报（假阳性会让人不敢用这个校验）。
 *
 * 背景：一元 + / ** / >>> 原样输出到 WXML 会让微信编译器报
 * "unexpected token"，且**整个页面无法加载**。
 */

const SCRIPT = join(process.cwd(), 'scripts', 'verify-artifacts.mjs')
let dir = ''

function runValidator(extraArgs: string[] = []): string {
  try {
    return execFileSync('node', [SCRIPT, dir, ...extraArgs], { encoding: 'utf8' })
  } catch (e: any) {
    return (e.stdout ?? '') + (e.stderr ?? '')
  }
}

function writeWxml(content: string) {
  writeFileSync(join(dir, 'probe.wxml'), content)
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'vms-verify-'))
})
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('WXML 表达式检查：必须报告不支持的运算符', () => {
  for (const [name, expr] of [
    ['幂运算 **', 'num ** 2'],
    ['无符号右移 >>>', 'num >>> 1'],
    ['一元 +', '+str'],
  ]) {
    it('报告 ' + name, () => {
      writeWxml('<view>{{ ' + expr + ' }}</view>')
      const out = runValidator()
      expect(out).toContain('WXML 表达式含')
    })
  }
})

describe('WXML 表达式检查：不得对支持的运算符误报', () => {
  const OK = [
    'a + b',
    "'x' + a",
    'a + 1',
    'fn(a) + b',
    'a - b',
    'a * 2',
    'a / 2',
    'a % 2',
    'a << 1',
    'a >> 1',
    'a & 1',
    'a | 1',
    'a ^ 1',
    '!a',
    '-a',
    '~a',
    '!!a',
    'a === b',
  ]
  for (const expr of OK) {
    it('不报告 ' + expr, () => {
      writeWxml('<view>{{ ' + expr + ' }}</view>')
      const out = runValidator()
      expect(out).not.toContain('WXML 表达式含')
    })
  }
})

describe('strict 模式对不支持的运算符以非 0 退出', () => {
  it('exit code != 0', () => {
    writeWxml('<view>{{ num ** 2 }}</view>')
    let code = 0
    try {
      execFileSync('node', [SCRIPT, dir, '--strict'], { encoding: 'utf8' })
    } catch (e: any) {
      code = e.status ?? 1
    }
    expect(code).not.toBe(0)
  })
})
