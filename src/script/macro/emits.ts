import t from '@babel/types'
import { NodePath } from '@babel/traverse'

export function dealMacroEmits(
  path: NodePath,
  decl: t.VariableDeclarator,
  defineContextVarName: string,
): void {
  // 处理 defineEmits() 调用
  // 转换为 const emits = (eventName, value) => defineContextVarName.triggerEvent(eventName, value)

  // 为参数添加TypeScript类型注解
  const eventNameIdentifier = t.identifier('eventName')
  eventNameIdentifier.typeAnnotation = t.tsTypeAnnotation(t.tsStringKeyword())

  const valueIdentifier = t.identifier('value')
  valueIdentifier.typeAnnotation = t.tsTypeAnnotation(t.tsAnyKeyword())

  const arrowFunction = t.arrowFunctionExpression(
    [eventNameIdentifier, valueIdentifier],
    t.callExpression(
      t.memberExpression(t.identifier(defineContextVarName), t.identifier('triggerEvent')),
      [t.identifier('eventName'), t.identifier('value')],
    ),
  )

  // 创建新的变量声明
  const newVarDecl = t.variableDeclaration('const', [
    t.variableDeclarator(t.identifier((decl.id as t.Identifier).name), arrowFunction),
  ])
  // 替换原节点
  path.replaceWith(newVarDecl)
}
