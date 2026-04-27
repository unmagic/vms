#!/usr/bin/env node
import { program } from 'commander'
import { createRequire } from 'module'
import { runBuildPackage, runVMS } from '../dist/index.js'
const require = createRequire(import.meta.url)
const pkg = require('../package.json')

program.version(pkg.version).description('VMS小程序构建工具')

// 构建命令
program
  .command('build')
  .description('构建项目')
  .option('--upload', '是否上传代码', false)
  .action((options) => {
    runVMS({ ...options, mode: 'production' })
  })

// 开发服务器命令
program
  .command('dev')
  .description('启动开发服务器')
  .action(() => {
    runVMS({ mode: 'development', upload: false })
  })

// 组件包构建命令
program
  .command('package')
  .description('构建组件包（在组件包根目录下执行，输出到 dist/）')
  .action(() => {
    runBuildPackage()
  })

program.parse()
