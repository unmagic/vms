import t from '@babel/types'
import { type Binding, type NodePath } from '@babel/traverse'
import { VMSSFCContext } from '@/types/node'
import { traverse } from '@/utils/babelTraverse'

/**
 * 处理 defineProps 宏
 * - 提取 props 变量名
 * - 收集解构的 props 信息（包括别名和默认值）
 * - 从类型参数中提取未解构的 props
 * - 移除 defineProps 声明
 */
export function dealMacroProps(
  path: NodePath,
  decl: t.VariableDeclarator,
  sfcContext: VMSSFCContext,
): void {
  // 获取变量名
  if (t.isIdentifier(decl.id)) {
    sfcContext.propsVarName = decl.id.name
  } else if (t.isObjectPattern(decl.id)) {
    // 处理 defineProps 的解构赋值
    for (const prop of decl.id.properties) {
      // 处理 rest 操作符：const { foo, ...others } = defineProps()
      // rest 变量（如 'others'）代表整个 props 对象
      if (t.isRestElement(prop)) {
        if (t.isIdentifier(prop.argument)) {
          sfcContext.propsVarRestName = prop.argument.name
        }
        continue
      }

      if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) {
        continue
      }

      const propName = prop.key.name

      // 处理带默认值的解构：const { foo = 'default' } = defineProps()
      if (t.isAssignmentPattern(prop.value) && t.isIdentifier(prop.value.left)) {
        // 如果 style 有别名（如 const { style: myStyle = '' }），删除默认的 style
        if (propName === 'style' && prop.value.left.name !== 'style') {
          sfcContext.propsVarsMap.delete('style')
        }
        sfcContext.propsVarsMap.set(prop.value.left.name, {
          defaultValue: prop.value.right,
          originName: propName,
          isDestructured: true,
        })
      }
      // 处理普通解构和别名：const { foo } = defineProps() 或 const { foo: bar } = defineProps()
      // prop.key.name 是原始属性名（如 'record'）
      // prop.value.name 是实际使用的变量名（如 'propRecord' 或 'record'）
      else if (t.isIdentifier(prop.value)) {
        // 如果 style 有别名（如 const { style: myStyle }），删除默认的 style
        if (propName === 'style' && prop.value.name !== 'style') {
          sfcContext.propsVarsMap.delete('style')
        }
        sfcContext.propsVarsMap.set(prop.value.name, {
          originName: propName,
          isDestructured: true,
        })
      }
    }
  }
  // 从类型参数中提取 props 定义
  const init = decl.init
  if (
    t.isCallExpression(init) &&
    init.typeParameters?.params &&
    init.typeParameters.params.length > 0
  ) {
    const typeParams = init.typeParameters.params[0]
    if (t.isTSTypeLiteral(typeParams)) {
      typeParams.members.forEach((member) => {
        if (t.isTSPropertySignature(member) && t.isIdentifier(member.key)) {
          const aliasName = member.key.name

          // 只添加未被解构的 props
          if (!sfcContext.propsVarsMap.has(aliasName)) {
            const isAliased = [...sfcContext.propsVarsMap.values()].some(
              (v) => v.originName === aliasName,
            )
            if (!isAliased) {
              sfcContext.propsVarsMap.set(aliasName, {
                originName: aliasName,
                isDestructured: false,
              })
            }
          }
        }
      })
    }
  }
  path.remove()
}

/**
 * 在 AST 中全局替换 props 变量
 * 将解构的 props 变量（如 record）替换为成员访问（如 __vmsProps.record）
 *
 * @param ast - 要处理的 AST（Program 或 BlockStatement）
 * @param sfcContext - SFC 上下文，包含 props 信息
 *
 * 处理规则：
 * 1. 跳过成员表达式的属性部分（obj.property 中的 property）
 * 2. 跳过对象属性的 key 部分（{ key: value } 中的 key）
 * 3. 跳过声明位置（let foo = 1 中的 foo）
 * 4. 保留有效的局部变量（函数内的同名变量）
 * 5. 处理对象简写属性（{ foo } → { foo: __vmsProps.foo }）
 */
export function replacePropsVariablesInAST(
  ast: t.Program | t.BlockStatement,
  sfcContext: VMSSFCContext,
): void {
  // 性能优化：提前创建 __vmsProps 标识符，避免重复创建
  const vmsPropsIdentifier = t.identifier(sfcContext.propsVarName)

  traverse(ast, {
    Identifier(path) {
      const name = path.node.name

      // 跳过 TypeScript 类型注解中的标识符
      // 例如：function foo(e: Type<{ value: number }>) 中的 value 不应该被替换
      const parentNode = path.parentPath.node
      if (
        t.isTSTypeLiteral(parentNode) ||
        t.isTSPropertySignature(parentNode) ||
        t.isTSTypeReference(parentNode) ||
        t.isTSInterfaceBody(parentNode) ||
        t.isTSTypeAliasDeclaration(parentNode) ||
        t.isTSTypeParameterInstantiation(parentNode) ||
        t.isTSTypeAnnotation(parentNode)
      ) {
        return
      }

      // 如果存在 rest 变量名，且当前标识符是 rest 变量，需要替换为 propsVarName
      // 例如：const { record, ...others } = defineProps()
      // others 应该被替换为 __vmsProps（除非在局部作用域中被遮蔽）
      if (sfcContext.propsVarRestName && name === sfcContext.propsVarRestName) {
        // 跳过成员表达式的属性部分
        if (
          (path.parentPath.isMemberExpression() &&
            path.parentPath.node.property === path.node &&
            !path.parentPath.node.computed) ||
          (path.parentPath.isObjectProperty() &&
            path.parentPath.node.key === path.node &&
            !path.parentPath.node.computed)
        ) {
          return
        }

        // 跳过声明位置
        if (
          path.isBindingIdentifier() &&
          (path.parentPath.isVariableDeclarator() ||
            path.parentPath.isFunctionDeclaration() ||
            path.parentPath.isClassDeclaration() ||
            path.parentPath.isCatchClause())
        ) {
          return
        }

        // 作用域安全检查：如果存在有效的局部变量绑定，不替换
        if (path.scope.hasBinding(name)) {
          const binding = path.scope.getBinding(name) as Binding
          if (binding.path) {
            const isRootBinding = binding.scope.block === ast
            if (!isRootBinding && !binding.path.removed) {
              // 这是一个有效的局部变量（遮蔽了 rest 变量），不替换
              return
            }
          }
        }

        // 替换 rest 变量为 propsVarName（__vmsProps）
        path.replaceWith(t.cloneNode(vmsPropsIdentifier))
        return
      }

      // 跳过成员表达式的属性部分（如 obj.property 中的 property）
      if (
        (path.parentPath.isMemberExpression() &&
          path.parentPath.node.property === path.node &&
          !path.parentPath.node.computed) ||
        (path.parentPath.isOptionalMemberExpression() &&
          path.parentPath.node.property === path.node &&
          !path.parentPath.node.computed) ||
        (path.parentPath.isObjectProperty() &&
          path.parentPath.node.key === path.node &&
          !path.parentPath.node.computed)
      ) {
        return
      }

      // 检查该标识符是否为 props 变量
      const propInfo = sfcContext.propsVarsMap.get(name)
      if (!propInfo?.isDestructured) {
        return
      }

      // 跳过声明位置（例如 let foo = 1 中的 foo）
      if (
        path.isBindingIdentifier() &&
        (path.parentPath.isVariableDeclarator() ||
          path.parentPath.isFunctionDeclaration() ||
          path.parentPath.isClassDeclaration() ||
          path.parentPath.isCatchClause())
      ) {
        return
      }

      // 作用域安全检查：只有当存在有效的局部变量绑定时才跳过替换
      if (path.scope.hasBinding(name)) {
        const binding = path.scope.getBinding(name) as Binding

        if (binding.path) {
          // 检查是否为顶层作用域的绑定
          const isRootBinding = binding.scope.block === ast

          if (!isRootBinding && !binding.path.removed) {
            // 子作用域绑定且未被移除，这是一个有效的局部变量（遮蔽了 props），不替换
            return
          }
        }
      }

      // 创建替换节点：始终使用 __vmsProps 而不是 propsVarName
      // 这样即使有 rest 操作符（如 ...others），解构的 props 也会被正确替换为 __vmsProps.xxx
      const replacement = t.memberExpression(
        t.cloneNode(vmsPropsIdentifier),
        t.identifier(propInfo.originName),
      )

      // 处理对象简写属性 { foo } -> { foo: __vmsProps.foo }
      if (
        path.parentPath.isObjectProperty() &&
        path.parentPath.node.value === path.node &&
        path.parentPath.node.shorthand
      ) {
        path.parentPath.node.shorthand = false
      }

      // 执行替换
      path.replaceWith(replacement)
    },
  })
}
