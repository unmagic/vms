/**
 * 统一的错误处理工具
 * 使用 @babel/code-frame 输出友好的错误信息
 */

import { codeFrameColumns } from '@babel/code-frame'

/**
 * 安全提取错误消息
 * 用于 catch (error: unknown) 场景，替代不安全的 (error as any).message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/**
 * 获取干净的错误消息，剥离 babel 内嵌的 code-frame 和编译后文件路径
 * babel transformAsync 错误 message 格式为: "/path/to/file.js: description (line:col)\n\n> line | code\n"
 * 只保留 "description (line:col)" 部分
 */
function getCleanErrorMessage(error: Error): string {
  const msg = error.message || String(error)
  const firstLine = msg.split('\n')[0]
  if (!firstLine) return msg
  // 剥离 "filepath: " 前缀（babel 把 filename 塞在 message 开头）
  const colonIndex = firstLine.indexOf(': ')
  if (colonIndex > 0) {
    return firstLine.slice(colonIndex + 2)
  }
  return firstLine
}

/**
 * 错误位置信息
 */
export interface ErrorLocation {
  start: {
    line: number
    column: number
  }
  end?: {
    line: number
    column: number
  }
}

/**
 * 编译错误接口
 */
export interface CompileError extends Error {
  cause?: {
    loc?: ErrorLocation
  }
  /** babel 标准错误位置格式（直接在 error 上） */
  loc?: {
    line: number
    column: number
    index?: number
  }
}

/**
 * 从错误对象中提取位置信息
 * 支持两种格式：
 * 1. CompileError 格式：error.cause?.loc（start/end 结构）
 * 2. babel 标准格式：error.loc（line/column 结构）
 */
export function extractErrorLoc(error: unknown): ErrorLocation | null {
  const err = error as any

  // 格式 1: cause.loc（start/end 结构）
  if (err.cause?.loc) {
    return err.cause.loc as ErrorLocation
  }

  // 格式 2: 直接在 error 上的 loc（babel 标准格式：line/column）
  if (err.loc && typeof err.loc.line === 'number' && typeof err.loc.column === 'number') {
    return {
      start: { line: err.loc.line, column: err.loc.column + 1 },
    }
  }

  return null
}

/**
 * 创建带有位置信息的错误
 * @param message 错误消息
 * @param loc 错误位置
 * @returns 错误对象
 */
export function createCompileError(message: string, loc?: ErrorLocation | null): CompileError {
  const error = new Error(message) as CompileError
  if (loc) {
    error.cause = { loc }
  }
  return error
}

/**
 * 使用 code-frame 输出错误信息
 * @param source 源代码
 * @param error 错误对象
 * @param filePath 文件路径（可选）
 */
export function printErrorWithCodeFrame(
  source: string,
  error: CompileError,
  filePath?: string,
): void {
  const prefix = filePath ? `\n❌ Error in ${filePath}:\n` : '\n❌ Error:\n'

  const loc = extractErrorLoc(error)
  if (loc && source) {
    const codeFrame = codeFrameColumns(source, loc, {
      highlightCode: true,
      message: error.message,
    })
    console.error(prefix + codeFrame)
  } else {
    console.error(prefix + error.message)
  }

  if (error.stack) {
    console.error('\nStack trace:', error.stack)
  }
}

/**
 * 处理并输出错误
 * 如果错误包含位置信息，使用 code-frame 输出；否则直接输出错误消息
 * @param source 源代码
 * @param error 错误对象
 * @param filePath 文件路径（可选）
 * @returns 是否成功处理了错误（有位置信息）
 */
export function handleCompileError(source: string, error: unknown, filePath?: string): boolean {
  const err = error as CompileError

  const loc = extractErrorLoc(error)
  if (loc && source) {
    printErrorWithCodeFrame(source, err, filePath)
    return true
  }

  // 没有位置信息或没有源代码，直接输出错误消息（但剥离 babel 内嵌的 code-frame）
  const prefix = filePath ? `❌ Error in ${filePath}: ` : '❌ Error: '
  console.error(prefix + getCleanErrorMessage(err))

  return false
}

/**
 * 解析错误并返回格式化的错误消息
 * 用于 CLI 或其他需要字符串格式的场景
 * @param source 源代码
 * @param error 错误对象
 * @param filePath 文件路径（可选）
 * @returns 格式化的错误消息
 */
export function formatCompileError(source: string, error: unknown, filePath?: string): string {
  const err = error as CompileError
  const prefix = filePath ? `❌ Error in ${filePath}:\n` : '❌ Error:\n'

  const loc = extractErrorLoc(error)
  if (loc && source) {
    const codeFrame = codeFrameColumns(source, loc, {
      highlightCode: true,
      message: err.message,
    })
    return prefix + codeFrame
  }

  return prefix + getCleanErrorMessage(err)
}
