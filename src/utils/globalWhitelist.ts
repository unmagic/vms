/**
 * 全局变量白名单
 * 这些变量不会被收集到 __vmsRenderState 或 __vmsInternalState
 */

export const GLOBAL_WHITELIST = new Set([
  // 小程序全局
  'wx',
  'getApp',
  'getCurrentPages',
  'Page',
  'Component',
  'App',

  // JS 全局对象
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
  'Buffer', // Node.js

  // 特殊值
  'undefined',
  'null',
  'true',
  'false',
  'NaN',
  'Infinity',
  '-Infinity',

  // 全局函数
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
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',

  // 构造函数
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

  // URL API
  'URL',
  'URLSearchParams',

  // Fetch API
  'fetch',
  'Headers',
  'Request',
  'Response',

  // WebSocket
  'WebSocket',

  // EventSource
  'EventSource',

  // Storage
  'localStorage',
  'sessionStorage',

  // Crypto
  'crypto',
  'Crypto',
  'SubtleCrypto',

  // TextEncoder/Decoder
  'TextEncoder',
  'TextDecoder',

  // AbortController
  'AbortController',
  'AbortSignal',

  // Image
  'Image',

  // File API
  'File',
  'FileReader',
  'Blob',
  'FormData',

  // Worker
  'Worker',

  // Performance
  'performance',

  // Console
  'console',
])

/**
 * 检查变量名是否在全局白名单中
 */
export function isGlobalVariable(name: string): boolean {
  return GLOBAL_WHITELIST.has(name)
}
