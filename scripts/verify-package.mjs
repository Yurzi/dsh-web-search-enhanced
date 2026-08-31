import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const env = { ...process.env, npm_config_cache: join(tmpdir(), 'npm-cache'), PNPM_HOME: join(tmpdir(), 'pnpm-home') }
let tarball
try {
  const pack = JSON.parse(execFileSync('pnpm', ['pack', '--json'], { encoding: 'utf8', env }))
  tarball = pack.filename ?? pack[0]?.filename
} catch {
  const pack = JSON.parse(execFileSync('npm', ['pack', '--json'], { encoding: 'utf8', env }))
  tarball = pack.filename ?? pack[0]?.filename ?? (Object.values(pack)[0]?.filename)
}
assert.ok(tarball, 'pack did not report a tarball')
const dir = mkdtempSync(join(tmpdir(), 'dsh-web-search-enhanced-'))
try {
  execFileSync('tar', ['-xzf', tarball, '-C', dir])
  const pkg = JSON.parse(readFileSync(join(dir, 'package/package.json'), 'utf8'))
  for (const path of ['lib/index.js', 'lib/client.js', 'lib/types/index.d.ts', 'cordis.patch.yml']) {
    assert.ok(readFileSync(join(dir, 'package', path)).length > 0, 'missing packed artifact: ' + path)
  }
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  console.log('packed plugin contract verified:', tarball)
} finally {
  rmSync(dir, { recursive: true, force: true })
  rmSync(tarball, { force: true })
}
