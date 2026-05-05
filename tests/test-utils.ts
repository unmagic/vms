import { parse as parseSFC } from '@vue/compiler-sfc'
import { parseTemplate } from '../src/template'
import { parseScript, analyzeScriptScope, createEmptyScriptScope } from '../src/script'

/**
 * 编译 Vue 单文件组件内容,返回生成的 JS 和 WXML
 * 支持纯模板组件（无 script 部分）
 */
export async function compileVueContent(vueContent: string) {
  try {
    const { descriptor } = parseSFC(vueContent, {
      filename: 'test.vue',
      templateParseOptions: { comments: false },
    })

    const { template, scriptSetup } = descriptor

    if (!template?.ast) {
      throw new Error('Invalid Vue SFC: missing template')
    }

    // 支持纯模板组件
    const isTemplateOnly = !scriptSetup

    // 1. 先分析 script 作用域（纯模板组件使用空作用域）
    const scriptScope = isTemplateOnly
      ? createEmptyScriptScope()
      : analyzeScriptScope(scriptSetup.content)

    // 2. 转换 template（传入 scriptScope）
    const { wxmlContent, returnValue } = parseTemplate(template.ast, 'test.vue', false, scriptScope)

    // 3. 转换 script（纯模板组件传递 isTemplateOnly 标志）
    const result = await parseScript(
      descriptor,
      returnValue,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      scriptScope,
    )

    return {
      js: result.script,
      wxml: wxmlContent,
      error: null,
    }
  } catch (error) {
    return {
      js: '',
      wxml: '',
      error: error as Error,
    }
  }
}
