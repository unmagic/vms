import { NodePath } from '@babel/traverse'
import * as t from '@babel/types'

interface SFCContext {
  importAST: t.ImportDeclaration[]
  vueComponentImports: Array<{ name: string; path: string; importWay: string }>
  packageImports: Array<{ name: string; imported: string; source: string }>
}

// 判断是否是相对路径或 @/ 别名路径（即属于项目本地的模块）
function isLocalSource(source: string): boolean {
  return (
    source.startsWith('@/') ||
    source.startsWith('./') ||
    source.startsWith('/') ||
    source.startsWith('../')
  )
}

export function collectImports(path: NodePath<t.ImportDeclaration>, sfcContext: SFCContext): void {
  const source = path.node.source.value

  if (!source.endsWith('.vue')) {
    // 处理带有文件扩展名的导入
    // 包括 .ts, .js, 等常见扩展名
    if (source.endsWith('.ts') || source.endsWith('.js')) {
      // 但只对相对路径或绝对路径移除扩展名，保留从 node_modules 导入的模块的扩展名
      if (isLocalSource(source)) {
        // 移除文件扩展名，因为在运行时环境中通常不需要
        path.node.source.value = source.replace(/\.(ts|js)$/, '')
      }
    }

    // 对于 bare import（非本地路径、非 .vue/.ts/.js 后缀），可能是从 workspace/npm 包导入
    // 记录其 named imports，以便在 transformer 中解析包入口 re-export 的 Vue 组件
    // 同时仍保留导入声明在 importAST 中（因为可能是函数/常量，如 composables）
    if (!isLocalSource(source)) {
      path.node.specifiers.forEach((specifier) => {
        if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) {
          sfcContext.packageImports.push({
            name: specifier.local.name,
            imported: specifier.imported.name,
            source,
          })
        }
      })
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
