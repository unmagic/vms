import * as t from '@babel/types'
import { NodePath } from '@babel/traverse'
import { bold, red } from 'kolorist'
import { createCompileError } from '@/utils/errorHandler'

const EXPOSE_KEY = '__vmsExposed__'

export function createComponentExport(
  path: NodePath<t.ExpressionStatement>,
  expression: t.CallExpression,
  returnValue: t.ObjectExpression,
): t.ObjectExpression | null {
  if (t.isIdentifier(expression.callee) && expression.callee.name === 'defineExpose') {
    // 处理 defineExpose() 调用
    // 将defineExpose()的入参保存，供后续生成组件配置使用
    if (expression.arguments && expression.arguments.length > 0) {
      const arg = expression.arguments[0]
      if (t.isObjectExpression(arg)) {
        let exposeExistIndex = returnValue.properties.findIndex(
          (item) =>
            t.isObjectProperty(item) && t.isIdentifier(item.key) && item.key.name === EXPOSE_KEY,
        )
        if (exposeExistIndex === -1) {
          exposeExistIndex =
            returnValue.properties.push(
              t.objectProperty(t.identifier(EXPOSE_KEY), t.objectExpression([])),
            ) - 1
        }
        const exposeObjectExpressionProperties = (
          (returnValue.properties[exposeExistIndex] as t.ObjectProperty).value as t.ObjectExpression
        ).properties
        const exposeExportExpression = t.objectExpression([])
        // returnValue中增加expose参数
        arg.properties.forEach((prop) => {
          if ((t.isObjectProperty(prop) || t.isObjectMethod(prop)) && t.isIdentifier(prop.key)) {
            const key = prop.key.name
            if (
              !exposeObjectExpressionProperties.some(
                (p) =>
                  (t.isObjectProperty(p) || t.isObjectMethod(p)) &&
                  t.isIdentifier(p.key) &&
                  p.key.name === key,
              )
            ) {
              exposeObjectExpressionProperties.push(prop)
              exposeExportExpression.properties.push(
                t.objectProperty(
                  prop.key,
                  t.memberExpression(
                    t.memberExpression(
                      t.memberExpression(t.thisExpression(), t.identifier('data')),
                      t.identifier(EXPOSE_KEY),
                    ),
                    prop.key,
                  ),
                ),
              )
            }
          } else {
            throw createCompileError(
              'defineExpose参数必须是对象且属性名必须为identity',
              prop.loc || undefined,
            )
          }
        })
        path.remove()
        return exposeExportExpression
      } else {
        console.log(bold(red('defineExpose中传入的参数必须为对象')))
        // 移除defineExpose调用，不在最终代码中保留
        path.remove()
        return null
      }
    } else {
      path.remove()
      return null
    }
  }
  return null
}
