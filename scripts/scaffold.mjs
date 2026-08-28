import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [targetArg, nameArg] = process.argv.slice(2)
if (!targetArg || !nameArg || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(nameArg)) {
  console.error('Usage: pnpm scaffold <target-directory> <npm-package-name>')
  process.exit(1)
}
const source = resolve(fileURLToPath(new URL('..', import.meta.url)))
const target = resolve(targetArg)
await cp(source, target, { recursive: true, errorOnExist: true, force: false, filter: path => !/(?:^|\/)(?:\.git|node_modules|lib|coverage)(?:\/|$)/.test(path) && !path.endsWith('.tgz') })
async function rewrite(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await rewrite(path)
    else {
      let value = await readFile(path, 'utf8')
      value = value.split('dsh-web-search-enhanced').join(nameArg).split('dsh-web-search-enhanced').join(basename(nameArg))
      await writeFile(path, value)
    }
  }
}
await rewrite(target)
await rm(join(target, 'pnpm-lock.yaml'), { force: true })
console.log('Created ' + nameArg + ' in ' + target)
