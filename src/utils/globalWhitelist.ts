/**
 * 全局变量白名单
 * 这些变量不会被收集到 __vmsRenderState 或 __vmsInternalState
 *
 * 仅包含微信小程序运行时实际存在的全局标识符，
 * 不包含任何 Web / DOM / Node.js 专属 API。
 */

export const GLOBAL_WHITELIST = new Set([
  // 微信小程序运行时全局
  'wx',
  'getApp',
  'getCurrentPages',
  'Page',
  'Component',
  'App',

  // ECMAScript 内置对象（所有现代 JS 引擎均支持）
  'console',
  'Math',
  'Date',
  'JSON',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'RegExp',
  'Error',
  'Promise',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Symbol',
  'BigInt',
  'Proxy',
  'Reflect',
  'Intl',

  // 特殊值字面量（解析表达式时以标识符形式出现）
  'undefined',
  'null',
  'true',
  'false',
  'NaN',
  'Infinity',
  '-Infinity',

  // ECMAScript 内置函数
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURI',
  'encodeURIComponent',
  'decodeURI',
  'decodeURIComponent',
  'escape',
  'unescape',
  'eval',

  // 定时器（微信小程序支持）
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',

  // ECMAScript TypedArray 构造函数
  'ArrayBuffer',
  'SharedArrayBuffer',
  'DataView',
  'Float32Array',
  'Float64Array',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Uint8Array',
  'Uint16Array',
  'Uint32Array',
  'Uint8ClampedArray',

  // URL 标准（现代 JS 引擎均支持）
  'URL',
  'URLSearchParams',

  // 文本编码（现代 JS 引擎均支持）
  'TextEncoder',
  'TextDecoder',
])

/**
 * 检查变量名是否在全局白名单中
 */
export function isGlobalVariable(name: string): boolean {
  return GLOBAL_WHITELIST.has(name)
}
