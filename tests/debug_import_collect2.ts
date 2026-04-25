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

  const result = parseTemplate(descriptor.template.ast, 'test.vue', scriptScope)

  console.log('needsProxyRefs:', result.needsProxyRefs)
  console.log('bridgedFunctions:', [...result.bridgedFunctions])
  console.log('\nReturn value properties count:', result.returnValue.properties.length)
} else {
  console.log('No template or script found')
}
