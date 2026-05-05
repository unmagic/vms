import { parseTemplate } from '../src/template/index'
import { analyzeScriptScope } from '../src/script/scopeAnalyzer'
import { parse } from '@vue/compiler-sfc'
import fs from 'fs'

const vueContent = fs.readFileSync(
  './example/src/subHome/pages/bill/profit/ProfitBillIndex.vue',
  'utf-8',
)
const { descriptor } = parse(vueContent)

if (descriptor.template && descriptor.scriptSetup) {
  const scriptScope = analyzeScriptScope(descriptor.scriptSetup.content)

  console.log('Imports in scope:')
  for (const [name] of scriptScope.imports) {
    console.log(`  ${name}`)
  }

  const result = parseTemplate(descriptor.template.ast!, 'test.vue', false, scriptScope)

  console.log('\nReturn value properties:')
  result.returnValue.properties.forEach((prop: any) => {
    console.log(`  ${prop.key?.name}`)
  })

  console.log('\nRender vars:')
  console.log(' ', [...result.renderVars])

  console.log('\nInternal vars:')
  console.log(' ', [...result.internalVars])
} else {
  console.log('No template or script found')
}
