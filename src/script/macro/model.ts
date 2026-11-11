import t from '@babel/types'
import { type NodePath } from '@babel/traverse'
import { VMSSFCContext } from '@/types/node'

/**
 * 处理 defineModel 宏
 *
 * 将 `const model = defineModel<string>()`（或 defineModel<string>('title')）
 * 编译为：
 * 1. 在 properties 中注册 model 属性（propName 默认 'modelValue'）
 * 2. 变量改为 customRef，get 返回 __vmsProps.xxx，set 通过 triggerEvent('update:xxx') 回传父组件
 * 3. 移除 defineModel 声明
 *
 * 运行时配合父组件的 v-model:xxx 绑定：
 * 父组件监听 update:xxx 事件回写数据，数据经 properties observer 更新 __vmsProps，customRef get 即返回新值。
 *
 * 说明：customRef 在 @unmagic/vue-mini（转发 @vue/reactivity）中可用。
 */
export function dealMacroModel(
  path: NodePath,
  decl: t.VariableDeclarator,
  sfcContext: VMSSFCContext,
): boolean {
  if (!t.isCallExpression(decl.init)) return false

  // 解析参数：defineModel() / defineModel('title') / defineModel<string>() /
  // defineModel<string>('title') / defineModel({ default: 0 })
  const args = decl.init.arguments
  let propName = 'modelValue'
  let defaultValue: t.Expression | undefined
  if (args.length > 0) {
    const first = args[0]
    if (t.isStringLiteral(first)) {
      propName = first.value
      // 第二个参数可为 options 对象
      const second = args[1]
      if (second) {
        const parsed = parseModelOptions(second)
        if (parsed === null) return false
        defaultValue = parsed
      }
    } else if (t.isObjectExpression(first)) {
      // defineModel({ default: x })：使用默认 prop 名
      const parsed = parseModelOptions(first)
      if (parsed === null) return false
      defaultValue = parsed
    } else {
      // defineModel 的第一个参数只支持字符串字面量或 options 对象
      return false
    }
  }

  // 变量名必须是标识符
  if (!t.isIdentifier(decl.id)) return false
  const varName = decl.id.name

  // 注册 properties（与 defineProps 类型字面量同构：type: null，可带默认值）
  sfcContext.propsVarsMap.set(varName, {
    originName: propName,
    isDestructured: false,
    defaultValue: defaultValue ?? null,
  })

  // 生成替换声明：
  // const model = customRef((track, trigger) => ({
  //   get() {
  //     track()
  //     return __vmsProps.xxx
  //   },
  //   set(value) {
  //     __vmsContext.triggerEvent('update:xxx', value)
  //   },
  // }))
  const customRefDecl = t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier(varName),
      t.callExpression(t.identifier('customRef'), [
        t.arrowFunctionExpression(
          [t.identifier('_track'), t.identifier('_trigger')],
          t.objectExpression([
            t.objectMethod(
              'method',
              t.identifier('get'),
              [],
              t.blockStatement([
                t.expressionStatement(t.callExpression(t.identifier('_track'), [])),
                t.returnStatement(
                  // 属性名可能不是合法 JS 标识符（如 'user-name'），
                  // 此时必须用计算成员访问 __vmsProps["user-name"]，
                  // 否则会生成 __vmsProps.user-name 这种语法错误代码
                  t.memberExpression(
                    t.identifier(sfcContext.propsVarName),
                    t.isValidIdentifier(propName)
                      ? t.identifier(propName)
                      : t.stringLiteral(propName),
                    !t.isValidIdentifier(propName),
                  ),
                ),
              ]),
            ),
            t.objectMethod(
              'method',
              t.identifier('set'),
              [t.identifier('__vms_value')],
              t.blockStatement([
                t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(
                      t.identifier(sfcContext.contextVarName),
                      t.identifier('triggerEvent'),
                    ),
                    [t.stringLiteral(`update:${propName}`), t.identifier('__vms_value')],
                  ),
                ),
              ]),
            ),
          ]),
        ),
      ]),
    ),
  ])

  // 在原声明位置插入替换声明，并移除原声明所在的 VariableDeclaration
  const parent = path.parentPath
  if (parent && t.isVariableDeclaration(parent.node)) {
    if (parent.node.declarations.length === 1) {
      parent.replaceWith(customRefDecl)
    } else {
      // 多声明语句中只替换当前声明
      parent.node.declarations = parent.node.declarations.filter((d) => d !== decl)
      path.insertBefore(customRefDecl)
    }
  } else {
    path.replaceWith(customRefDecl)
  }

  // 确保导入 customRef
  ensureCustomRefImport(sfcContext)
  return true
}

/**
 * 解析 defineModel 的 options 参数
 * 仅支持 { default: <表达式> }；包含其他键时返回 null（由调用方决定静默跳过或报错）
 */
function parseModelOptions(
  arg: t.Expression | t.SpreadElement | t.JSXNamespacedName | t.ArgumentPlaceholder,
): t.Expression | null {
  if (!t.isObjectExpression(arg)) return null
  let defaultValue: t.Expression | undefined
  for (const prop of arg.properties) {
    if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) return null
    if (prop.key.name === 'default') {
      if (t.isSpreadElement(prop.value) || !t.isExpression(prop.value)) return null
      defaultValue = prop.value
    } else {
      // get/set 转换器等选项暂不支持
      return null
    }
  }
  return defaultValue ?? null
}

/**
 * 确保 @unmagic/vue-mini 的 import 中包含 customRef
 */
function ensureCustomRefImport(sfcContext: VMSSFCContext): void {
  let vueImport: t.ImportDeclaration | undefined
  for (const importNode of sfcContext.importAST) {
    if (!t.isImportDeclaration(importNode) || importNode.source.value !== '@unmagic/vue-mini') {
      continue
    }
    vueImport = importNode
    break
  }
  if (!vueImport) {
    const decl = t.importDeclaration(
      [t.importSpecifier(t.identifier('customRef'), t.identifier('customRef'))],
      t.stringLiteral('@unmagic/vue-mini'),
    )
    sfcContext.importAST.push(decl)
    return
  }
  const has = vueImport.specifiers.some(
    (spec) =>
      t.isImportSpecifier(spec) &&
      t.isIdentifier(spec.imported) &&
      spec.imported.name === 'customRef',
  )
  if (!has) {
    vueImport.specifiers.push(
      t.importSpecifier(t.identifier('customRef'), t.identifier('customRef')),
    )
  }
}
