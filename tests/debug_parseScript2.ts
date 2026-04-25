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

  const templateResult = parseTemplate(descriptor.template.ast, 'test.vue', scriptScope)

  const scriptResult = await parseScript(
    descriptor,
    templateResult.returnValue,
    templateResult.bridgedFunctions,
    templateResult.internalVars,
    templateResult.renderVars,
    templateResult.needsProxyRefs,
    scriptScope,
  )

  console.log('Full generated script:')
  console.log(scriptResult.script)
} else {
  console.log('No template or script found')
}
