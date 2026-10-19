/**
 * Prepare one isolated DSH world for the whole e2e run:
 *
 * 1. wipe `.e2e/run` and redirect every home, cache, and temp directory into it;
 * 2. install the DSH CLI under test (cached per version);
 * 3. pack the built plugin the way npm publishes it;
 * 4. create the shipped `web` profile and install, with the real plugin
 *    manager, first dsh-web-fetch-enhanced and then this plugin — the order in
 *    which installing this plugin used to break web_fetch.
 *
 * Test files receive the result through `inject('e2e')`.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'
import { FETCH_PLUGIN, addPlugin, artifacts, dsh, ensureDsh, isolatedEnvironment, packPlugin, run } from './support/environment.ts'

export default function setup(project: TestProject): void {
  rmSync(run, { recursive: true, force: true })
  mkdirSync(artifacts, { recursive: true })
  const env = isolatedEnvironment()
  const install = ensureDsh(env)
  const e2e = { install, cli: join(install, 'node_modules/.bin/dsh'), env, tarball: packPlugin(env) }
  // The first command against a profile creates it from the shipped template.
  dsh(e2e, ['--profile', 'web', '--dump-config'])
  addPlugin(e2e, FETCH_PLUGIN)
  addPlugin(e2e, e2e.tarball)
  project.provide('e2e', e2e)
}
