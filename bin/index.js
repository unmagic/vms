#!/usr/bin/env node
import { program } from 'commander'
import { createRequire } from 'module'
import { runVMS } from '../dist/index.js'
const require = createRequire(import.meta.url)
const pkg = require('../package.json')

// 统一捕获 runVMS 的异常，避免 unhandled rejection 直接崩掉进程
function run(options) {
  runVMS(options).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

program.version(pkg.version).description('VMS小程序构建工具')

// 构建命令
program
  .command('build')
  .description('构建项目')
  .option('--upload', '是否上传代码', false)
  .action((options) => {
    run({ ...options, mode: 'production' })
  })

// 开发服务器命令
program
  .command('dev')
  .description('启动开发服务器')
  .action(() => {
    run({ mode: 'development', upload: false })
  })

program.parse()
