import { parse as babelParse } from '@babel/parser'
import _traverse from '@babel/traverse'
import * as t from '@babel/types'

const traverse = ((_traverse).default || _traverse)

const code = `
import {
  EventName,
  getYesterday,
  ProfitPercentType,
  profitPercentTypeOptions,
  ProfitType,
} from '@/utils/constants'

const yesterday = getYesterday()
`

const ast = babelParse(code, {
  sourceType: 'module',
  plugins: ['typescript'],
})

const imports = new Map()

traverse(ast, {
  ImportDeclaration(path) {
    console.log('Found ImportDeclaration:', path.node.source.value)
    path.node.specifiers.forEach((spec, index) => {
      console.log(`  Specifier ${index}:`, spec.type)
      console.log('    local:', spec.local.name)
      if (t.isImportSpecifier(spec)) {
        console.log('    imported type:', spec.imported.type)
        if (t.isIdentifier(spec.imported)) {
          console.log('    imported name:', spec.imported.name)
        } else if (t.isStringLiteral(spec.imported)) {
          console.log('    imported value:', spec.imported.value)
        }
      }
    })
  },
})

console.log('\nImports collected:', imports)
