/**
 * Pack the plugin into a temporary directory and check what users install:
 * required artifacts are present, nothing else ships, and the manifest
 * declares the Host contract the Loader and the plugin market read.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REQUIRED = ['package.json', 'lib/index.js', 'lib/client.js', 'lib/types/index.d.ts', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'icon.svg', 'README.md', 'LICENSE']
const ALLOWED = /^(?:package\.json|README\.md|CHANGELOG\.md|LICENSE|cordis\.patch\.yml|icon\.svg|locale\/[a-z-]+\.json|lib\/(?:index\.js|client\.js(?:\.map)?|types\/.+\.d\.ts))$/u

const dir = mkdtempSync(join(tmpdir(), 'dsh-web-search-enhanced-pack-'))
try {
  const output = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', dir], {
    encoding: 'utf8', env: { ...process.env, npm_config_cache: join(dir, '.npm') },
  }))
  // npm <= 11 prints an array of reports, npm >= 12 an object keyed by package name.
  const [report] = Array.isArray(output) ? output : Object.values(output)
  const files = report.files.map(file => file.path)
  for (const path of REQUIRED) assert.ok(files.includes(path), 'missing packed file: ' + path)
  const unexpected = files.filter(path => !ALLOWED.test(path))
  assert.deepEqual(unexpected, [], 'unexpected packed files')

  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.match(pkg.engines.dsh, /^>=\S+ <\S+$/u, 'engines.dsh needs a lower and an upper bound')
  for (const [name, range] of Object.entries(pkg.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(range, pkg.engines.dsh, name + ' must follow engines.dsh')
  }
  assert.equal(pkg.dependencies, undefined, 'runtime dependencies are bundled into lib/')
  for (const locale of ['en', 'zh']) {
    const { meta } = JSON.parse(readFileSync(new URL('../locale/' + locale + '.json', import.meta.url), 'utf8'))
    assert.ok(meta?.title && meta?.description, 'locale/' + locale + '.json needs meta.title and meta.description')
  }
  console.log('packed ' + report.filename + ': ' + files.length + ' files, ' + Math.round(report.size / 1024) + ' KiB')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
