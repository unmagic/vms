/**
 * 统一的 @babel/traverse ESM 兼容处理
 *
 * @babel/traverse 的 ESM 导出在某些环境下需要手动解构 default 导出。
 * 此模块封装该兼容逻辑，避免在多个文件中重复相同的 hack。
 */
import _traverse from '@babel/traverse'

export const traverse = ((_traverse as any).default || _traverse) as typeof _traverse
