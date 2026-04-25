import { NodePath } from '@babel/traverse'
import * as t from '@babel/types'

interface SFCContext {
  importAST: t.ImportDeclaration[]
  vueComponentImports: Array<{ name: string; path: string; importWay: string }>
}

export function collectImports(path: NodePath<t.ImportDeclaration>, sfcContext: SFCContext): void {
  const source = path.node.source.value

  if (!source.endsWith('.vue')) {
    // 处理带有文件扩展名的导入
    // 包括 .ts, .js, 等常见扩展名
    if (source.endsWith('.ts') || source.endsWith('.js')) {
      // 但只对相对路径或绝对路径移除扩展名，保留从 node_modules 导入的模块的扩展名
      if (
        source.startsWith('@/') ||
        source.startsWith('./') ||
        source.startsWith('/') ||
        source.startsWith('../')
      ) {
        // 移除文件扩展名，因为在运行时环境中通常不需要
        path.node.source.value = source.replace(/\.(ts|js)$/, '')
      }
    }
    // 收集导入声明AST节点
    sfcContext.importAST.push(path.node)
  } else {
    // 收集导入的Vue组件
    path.node.specifiers.forEach((specifier) => {
      sfcContext.vueComponentImports.push({
        name: specifier.local.name,
        path: source,
        importWay: `${specifier.local.name}`,
      })
    })
  }
  path.remove()
}
