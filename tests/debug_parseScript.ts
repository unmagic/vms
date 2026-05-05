import { parseScript } from '../src/script/index'
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

  const templateResult = parseTemplate(descriptor.template.ast!, 'test.vue', false, scriptScope)

  console.log('Before parseScript:')
  console.log(
    '  returnValue properties:',
    templateResult.returnValue.properties.map((p: any) => p.key?.name),
  )

  const scriptResult = await parseScript(
    descriptor,
    templateResult.returnValue,
    templateResult.bridgedFunctions,
    templateResult.internalVars,
    templateResult.renderVars,
    templateResult.needsProxyRefs,
    false,
    scriptScope,
  )

  console.log('\nGenerated script (first 1000 chars):')
  console.log(scriptResult.script.slice(0, 1000))
} else {
  console.log('No template or script found')
}
