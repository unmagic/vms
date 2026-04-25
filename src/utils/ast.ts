// 检查表达式是否包含父级v-for的变量
import { parseExpression } from '@babel/parser'
import t, { Node } from '@babel/types'
import { JS_BUILT_IN_SET } from '@/utils/constants'
import { getErrorMessage } from '@/utils/errorHandler'

/**
 * 获取表达式的AST，可解析 Typescript 语法
 * @param expression
 */
export function getExpressionTSAst(expression: string) {
  return parseExpression(expression, { plugins: ['typescript'] })
}

/**
 * 获取AST中，非父级v-for的变量
 * @param ast
 * @param vForVars
 */
export function getIdentifiersWithoutVForVariables(ast: Node, vForVars: Set<string>): Set<string> {
  try {
    // 收集所有标识符
    const identifiers = new Set<string>()
    traverse(ast, identifiers)
    vForVars.forEach((vForVar) => identifiers.delete(vForVar))
    return identifiers
  } catch (error: unknown) {
    // 如果解析失败，返回空集合
    console.error(`❌ 解析表达式时出错: ${getErrorMessage(error)}`)
    return new Set()
  }
}

// 遍历AST节点，收集标识符
function traverse(node: Node, identifiers: Set<string>): void {
  if (!node) return
  // 处理不同类型的节点
  switch (node.type) {
    case 'Identifier':
      identifiers.add(node.name)
      break
    case 'MemberExpression':
      if (node.object) {
        if (node.object.type === 'Identifier') {
          identifiers.add(node.object.name)
        } else if (node.object.type === 'MemberExpression') {
          traverse(node.object, identifiers)
        }
      }
      if (node.property && node.property.type === 'Identifier' && !node.computed) {
        // 对于点号访问的属性（如 obj.prop），我们通常不把 prop 当作变量
        // 但需要考虑计算属性访问（如 obj[prop]）的情况
      } else if (node.property && node.computed) {
        traverse(node.property, identifiers)
      }
      break
    case 'ConditionalExpression':
      ;[node.test, node.consequent, node.alternate].forEach((item) => traverse(item, identifiers))
      break
    case 'UnaryExpression':
      traverse(node.argument, identifiers)
      break
    case 'BinaryExpression':
    case 'LogicalExpression':
      traverse(node.left, identifiers)
      traverse(node.right, identifiers)
      break
    case 'CallExpression':
      // 处理函数调用表达式
      if (node.callee) {
        traverse(node.callee, identifiers)
      }
      if (node.arguments) {
        node.arguments.forEach((arg: any) => traverse(arg, identifiers))
      }
      break
    case 'ArrayExpression':
      // 处理数组表达式
      if (node.elements) {
        node.elements.forEach((element: any) => traverse(element, identifiers))
      }
      break
    case 'ObjectExpression':
      // 处理对象表达式
      if (node.properties) {
        node.properties.forEach((property: any) => {
          if (property.type === 'ObjectProperty') {
            // 对于对象属性，我们通常只关心值，不关心键（除非是计算属性键）
            if (property.computed) {
              traverse(property.key, identifiers)
            }
            traverse(property.value, identifiers)
          } else if (property.type === 'ObjectMethod') {
            // 对于对象方法，处理方法体内的标识符
            if (property.body) {
              traverse(property.body, identifiers)
            }
          } else if (property.type === 'SpreadElement') {
            // 处理展开运算符
            traverse(property.argument, identifiers)
          }
        })
      }
      break
    case 'AssignmentExpression':
      // 处理赋值表达式
      traverse(node.left, identifiers)
      traverse(node.right, identifiers)
      break
    case 'UpdateExpression':
      // 处理自增/自减表达式
      traverse(node.argument, identifiers)
      break
    case 'NewExpression':
      // 处理 new 表达式
      if (node.callee) {
        traverse(node.callee, identifiers)
      }
      if (node.arguments) {
        node.arguments.forEach((arg: any) => traverse(arg, identifiers))
      }
      break
    // TypeScript 特有节点类型
    case 'TSAsExpression':
    case 'TSTypeAssertion':
      // 处理 TypeScript 的 as 和 <Type> 断言语法
      traverse(node.expression, identifiers)
      break
    case 'TSNonNullExpression':
      // 处理 TypeScript 的非空断言操作符 (expr!)
      traverse(node.expression, identifiers)
      break
  }
}

/**
 * 从AST中收集变量
 * @param node
 * @param variables
 * @param excludedVars
 */
export function collectVariablesFromAST(
  node: t.Node,
  variables: Set<string>,
  excludedVars?: Set<string>,
): void {
  if (!node) return

  switch (node.type) {
    case 'Identifier':
      if (!excludedVars || !excludedVars.has(node.name)) {
        variables.add(node.name)
      }
      break
    case 'MemberExpression':
      // 对于成员表达式，我们只关心根对象
      if (node.object.type === 'Identifier') {
        if (!excludedVars || !excludedVars.has(node.object.name)) {
          variables.add(node.object.name)
        }
      } else {
        collectVariablesFromAST(node.object, variables, excludedVars)
      }
      // 如果是计算属性访问，则也需要收集属性表达式中的变量
      if (node.computed) {
        collectVariablesFromAST(node.property, variables, excludedVars)
      }
      break
    case 'OptionalMemberExpression':
      // 处理可选链成员表达式 a?.b
      if (node.object.type === 'Identifier') {
        if (!excludedVars || !excludedVars.has(node.object.name)) {
          variables.add(node.object.name)
        }
      } else {
        collectVariablesFromAST(node.object, variables, excludedVars)
      }
      // 如果是计算属性访问，则也需要收集属性表达式中的变量
      if (node.computed) {
        collectVariablesFromAST(node.property, variables, excludedVars)
      }
      break
    case 'BinaryExpression':
    case 'LogicalExpression':
      collectVariablesFromAST(node.left, variables, excludedVars)
      collectVariablesFromAST(node.right, variables, excludedVars)
      break
    case 'UnaryExpression':
      collectVariablesFromAST(node.argument, variables, excludedVars)
      break
    case 'ConditionalExpression':
      collectVariablesFromAST(node.test, variables, excludedVars)
      collectVariablesFromAST(node.consequent, variables, excludedVars)
      collectVariablesFromAST(node.alternate, variables, excludedVars)
      break
    case 'CallExpression':
    case 'OptionalCallExpression':
      collectVariablesFromAST(node.callee, variables, excludedVars)
      node.arguments.forEach((arg) => collectVariablesFromAST(arg, variables, excludedVars))

      // 收集函数体内部的变量（如果可访问）
      // 这里我们假设函数体信息可以通过某种方式获得
      // 在实际应用中，可能需要从其他地方获取函数定义并分析其体部
      if (node.callee && node.callee.type === 'Identifier') {
        // 对于简单标识符调用的函数，我们可以尝试查找其定义
        // 这里只是一个示例，实际实现需要结合上下文信息
      }
      break
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression': {
      // 收集函数体内的变量，但排除参数和局部变量
      const paramNames = new Set<string>()
      const localVariables = excludedVars ?? new Set<string>()

      // 收集参数名
      if (node.params) {
        node.params.forEach((param) => {
          if (param.type === 'Identifier') {
            paramNames.add(param.name)
          } else if (param.type === 'ObjectPattern') {
            // 处理对象解构参数
            collectPatternVariables(param, paramNames)
          } else if (param.type === 'ArrayPattern') {
            // 处理数组解构参数
            collectPatternVariables(param, paramNames)
          }
        })
      }

      // 收集函数体中的变量
      if (node.body) {
        const functionBodyVariables = new Set<string>()
        collectVariablesFromAST(node.body, functionBodyVariables, localVariables)
        // 从函数体变量中排除参数和局部变量
        functionBodyVariables.forEach((variable) => {
          if (!paramNames.has(variable) && !localVariables.has(variable)) {
            variables.add(variable)
          }
        })
      }

      // 同时也要收集函数名（如果是函数声明）
      if (node.type === 'FunctionDeclaration' && node.id && node.id.name) {
        variables.add(node.id.name)
      }
      break
    }
    case 'VariableDeclaration':
      // 处理变量声明，但不将局部变量添加到外部变量集合中
      // 这里我们只收集初始化表达式中使用的外部变量
      node.declarations.forEach((declaration) => {
        const localVariables = excludedVars ?? new Set<string>()
        if (declaration.id.type !== 'VoidPattern') {
          collectPatternVariables(declaration.id, localVariables)
        }
        if (declaration.init) {
          collectVariablesFromAST(declaration.init, variables, localVariables)
        }
      })
      break
    case 'BlockStatement':
      // 处理块级作用域中的语句
      if (node.body) {
        node.body.forEach((statement) => {
          collectVariablesFromAST(statement, variables, excludedVars)
        })
      }
      break
    case 'ReturnStatement':
      // 处理返回语句
      if (node.argument) {
        collectVariablesFromAST(node.argument, variables, excludedVars)
      }
      break
    case 'ObjectExpression':
      // 处理对象表达式
      if (node.properties) {
        node.properties.forEach((property: any) => {
          if (property.type === 'ObjectProperty') {
            // 对于对象属性，我们通常只关心值，不关心键（除非是计算属性键）
            if (property.computed) {
              collectVariablesFromAST(property.key, variables, excludedVars)
            }
            collectVariablesFromAST(property.value, variables, excludedVars)
          } else if (property.type === 'ObjectMethod') {
            // 对于对象方法，处理方法体内的标识符
            if (property.body) {
              collectVariablesFromAST(property.body, variables, excludedVars)
            }
          } else if (property.type === 'SpreadElement') {
            // 处理展开运算符
            collectVariablesFromAST(property.argument, variables, excludedVars)
          }
        })
      }
      break
    case 'TemplateLiteral':
      // 处理模板字符串，收集其中表达式的变量
      if (node.expressions) {
        node.expressions.forEach((expr) => {
          collectVariablesFromAST(expr, variables, excludedVars)
        })
      }
      break
    // TypeScript 特有节点类型
    case 'TSAsExpression':
    case 'TSTypeAssertion':
      // 处理 TypeScript 的 as 和 <Type> 断言语法，继续分析表达式部分
      collectVariablesFromAST(node.expression, variables, excludedVars)
      break
    case 'TSNonNullExpression':
      // 处理 TypeScript 的非空断言操作符 (expr!)
      collectVariablesFromAST(node.expression, variables, excludedVars)
      break
    case 'TSEnumDeclaration':
      // 处理 TypeScript 枚举声明
      if (node.id && node.id.type === 'Identifier') {
        variables.add(node.id.name)
      }
      // 枚举成员初始化表达式中的变量
      if (node.members) {
        node.members.forEach((member) => {
          if (member.initializer) {
            collectVariablesFromAST(member.initializer, variables, excludedVars)
          }
        })
      }
      break
    case 'TSInterfaceDeclaration':
    case 'TSTypeAliasDeclaration':
      // TypeScript 接口和类型别名声明
      if (node.id && node.id.type === 'Identifier') {
        variables.add(node.id.name)
      }
      break
    // 可以根据需要添加更多类型的处理
  }
}

// 辅助函数：收集解构模式中的变量名
function collectPatternVariables(pattern: any, variables: Set<string>): void {
  switch (pattern.type) {
    case 'Identifier':
      variables.add(pattern.name)
      break
    case 'ObjectPattern':
      pattern.properties.forEach((prop: any) => {
        if (prop.type === 'ObjectProperty') {
          collectPatternVariables(prop.value, variables)
        } else if (prop.type === 'RestElement') {
          collectPatternVariables(prop.argument, variables)
        }
      })
      break
    case 'ArrayPattern':
      pattern.elements.forEach((element: any) => {
        if (element) {
          collectPatternVariables(element, variables)
        }
      })
      break
    case 'RestElement':
      collectPatternVariables(pattern.argument, variables)
      break
  }
}

/**
 * 从模板的表达式AST中提取变量
 * @param ast
 * @return {string[]}
 */
export function extractVariablesFromExpressionAST(ast: any): string[] {
  try {
    const variables = new Set<string>()
    collectVariablesFromAST(ast, variables)
    JS_BUILT_IN_SET.forEach((builtIn) => variables.delete(builtIn))
    return Array.from(variables)
  } catch (e) {
    console.warn('Failed to extract variables from expression:', ast.loc?.source, e)
    return []
  }
}

/**
 * 检查表达式是否包含父级v-for的变量
 * @param expression
 * @param parentVFor
 */
export function isExpressionContainsVForVariables(expression: string, parentVFor: any): boolean {
  if (!parentVFor) {
    return false
  }
  try {
    // 使用Vue的parseExpression来解析表达式
    const ast = parseExpression(expression)

    // 收集所有标识符
    const identifiers = new Set<string>()

    traverse(ast, identifiers)
    // 检查是否有与v-for变量同名的标识符
    return (
      identifiers.has(parentVFor.vForItemName) ||
      (parentVFor.vForIndexName && identifiers.has(parentVFor.vForIndexName))
    )
  } catch (error) {
    // 如果解析失败，回退到简单的字符串检查
    console.warn('Failed to parse expression:', expression, error)
    return (
      expression.includes(parentVFor.vForItemName) ||
      (parentVFor.vForIndexName && expression.includes(parentVFor.vForIndexName))
    )
  }
}
