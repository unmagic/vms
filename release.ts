import { execa } from 'execa'

function run(bin: string, args: string[]) {
  return execa(bin, args, { stdio: 'inherit' })
}

await run('pnpm', ['lint'])
await run('pnpm', ['type'])
// await run('pnpm', ['test'])
await run('pnpm', ['vms:build'])
await run('pnpm', ['-r', 'publish', '--access', 'public'])
