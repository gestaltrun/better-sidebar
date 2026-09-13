/** The publication path must reject upstream identities before any npm operation. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { assertPackage, assertPublishContext, PACKAGE_NAME, parseOutput, REPOSITORY, tarballName } from '../scripts/release-package.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const manual = { GITHUB_REPOSITORY: REPOSITORY, GITHUB_EVENT_NAME: 'workflow_dispatch', PUBLISH_PACKAGE: 'true' }

test('the package and tarball use the independent Gestalt identity', () => {
  assertPackage(manifest)
  assert.equal(manifest.name, PACKAGE_NAME)
  assert.equal(tarballName(manifest), `gestaltrun-dsh-better-sidebar-${manifest.version}.tgz`)
})

test('upstream package, repository, registry, and install lifecycle are rejected', () => {
  for (const patch of [
    { name: 'dsh-better-sidebar' },
    { name: '@gestalt/dsh-better-sidebar' },
    { repository: { url: 'https://github.com/omdsh-dev/DSH-better-sidebar' } },
    { publishConfig: { access: 'public', registry: 'https://other.invalid/' } },
    { version: 'latest' },
    ...['prepare', 'install', 'postinstall', 'preinstall'].map(name => ({ scripts: { [name]: 'node script.js' } })),
  ]) assert.throws(() => assertPackage({ ...manifest, ...patch }))
})

test('an explicit manual publish is allowed only from the fork', () => {
  assertPublishContext(manifest, manual)
  for (const patch of [
    { GITHUB_REPOSITORY: 'omdsh-dev/DSH-better-sidebar' },
    { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_EVENT_NAME: 'pull_request' },
    { PUBLISH_PACKAGE: 'false' },
    { PUBLISH_PACKAGE: undefined },
  ]) assert.throws(() => assertPublishContext(manifest, { ...manual, ...patch }))
  assert.throws(() => assertPublishContext(manifest, {}))
})

test('release publishing requires matching manifest and tag refs', () => {
  const release = { GITHUB_REPOSITORY: REPOSITORY, GITHUB_EVENT_NAME: 'release', RELEASE_TAG: `v${manifest.version}`, GITHUB_REF: `refs/tags/v${manifest.version}` }
  assertPublishContext(manifest, release)
  assert.throws(() => assertPublishContext(manifest, { ...release, RELEASE_TAG: 'v0.19.1' }))
  assert.throws(() => assertPublishContext(manifest, { ...release, GITHUB_REF: 'refs/heads/main' }))
})

test('packing requires an explicit absolute output directory', () => {
  const out = join(tmpdir(), 'gestalt-release-artifacts')
  assert.equal(parseOutput(['--out', out]), out)
  assert.equal(parseOutput(['--', '--out', out]), out)
  for (const args of [[], ['--out'], ['--out', 'relative'], ['--out', out, '--publish']]) {
    assert.throws(() => parseOutput(args))
  }
})


test('both installers write the scoped release exemption once', () => {
  for (const file of ['install.sh', 'install.ps1']) {
    const source = readFileSync(new URL(`../scripts/${file}`, import.meta.url), 'utf8')
    const start = source.indexOf('const fs = require("fs");')
    const endMarker = 'console.log(t === before ? "unchanged" : "updated");'
    const end = source.indexOf(endMarker, start) + endMarker.length
    assert.ok(start >= 0 && end > start)
    let contents = 'packages:\n  - .\n'
    let writes = 0
    const fs = {
      readFileSync: () => contents,
      writeFileSync: (_path, value) => { contents = value; writes += 1 },
    }
    const context = { require: () => fs, process: { argv: ['node', 'workspace', 'workspace'] }, console: { log: () => {} } }
    runInNewContext(source.slice(start, end), context)
    assert.ok(contents.includes('  - "@gestaltrun/dsh-better-sidebar"'))
    runInNewContext(source.slice(start, end), { ...context })
    assert.equal(writes, 1, file)
  }
})
