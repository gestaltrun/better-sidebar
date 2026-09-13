#!/usr/bin/env node
/** Build and publish the Gestalt package with explicit artifact and repository checks. */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const PACKAGE_NAME = '@gestaltrun/dsh-better-sidebar'
export const REPOSITORY = 'gestaltrun/better-sidebar'

/** Reject an upstream package, repository, or registry before creating an artifact. */
export function assertPackage(manifest) {
  if (manifest.name !== PACKAGE_NAME) throw new Error(`Package name must be ${PACKAGE_NAME}`)
  if (manifest.repository?.url !== `https://github.com/${REPOSITORY}`) {
    throw new Error(`Package repository must be https://github.com/${REPOSITORY}`)
  }
  if (manifest.publishConfig?.registry !== 'https://registry.npmjs.org/' || manifest.publishConfig?.access !== 'public') {
    throw new Error('publishConfig must select the public npm registry and public access')
  }
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(manifest.version)) {
    throw new Error('Package version must be an exact SemVer')
  }
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) {
    if (name in (manifest.scripts ?? {})) throw new Error(`Install lifecycle ${name} is forbidden`)
  }
}

/** Publishing requires an explicit release or opted-in manual run in this fork. */
export function assertPublishContext(manifest, env) {
  assertPackage(manifest)
  if (env.GITHUB_REPOSITORY !== REPOSITORY) throw new Error(`Publishing requires GitHub repository ${REPOSITORY}`)
  if (env.GITHUB_EVENT_NAME === 'release') {
    if (env.RELEASE_TAG !== `v${manifest.version}` || env.GITHUB_REF !== `refs/tags/v${manifest.version}`) {
      throw new Error('Release tag must match the package version')
    }
  } else if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.PUBLISH_PACKAGE !== 'true') {
    throw new Error('Publishing requires a release or workflow_dispatch with publish=true')
  }
}

/** Both pnpm argument conventions are accepted; the caller must own an explicit output directory. */
export function parseOutput(args) {
  const values = args[0] === '--' ? args.slice(1) : args
  if (values.length !== 2 || values[0] !== '--out' || !isAbsolute(values[1])) {
    throw new Error('Usage: pnpm run release:pack -- --out <absolute-directory>')
  }
  return resolve(values[1])
}

/** npm removes the scope marker and joins the scope and package name with a hyphen. */
export function tarballName(manifest) {
  return `${manifest.name.replace(/^@/u, '').replace('/', '-')}-${manifest.version}.tgz`
}

function run(command, args, cwd = ROOT) {
  // Run pnpm's JavaScript entry directly so scoped paths and spaces survive Windows command shims.
  if (command === 'pnpm') {
    const cli = process.env.npm_execpath
    if (!cli) throw new Error('Run this command through pnpm run release:pack or release:publish')
    execFileSync(process.execPath, [cli, ...args], { cwd, stdio: 'inherit' })
    return
  }
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

function pack(manifest, out) {
  const tarball = join(out, tarballName(manifest))
  if (existsSync(tarball)) throw new Error(`Artifact already exists: ${tarball}`)
  run('pnpm', ['run', 'build'])
  run('pnpm', ['run', 'check:consumer-types'])
  run('pnpm', ['run', 'test:release'])
  run('pnpm', ['exec', 'vitest', 'run', 'tests/market-manifest.spec.ts', 'tests/manifest-consistency.spec.ts', 'tests/css-modules.spec.ts'])
  mkdirSync(out, { recursive: true })
  run('pnpm', ['pack', '--pack-destination', out])
  if (!existsSync(tarball)) throw new Error(`Expected artifact missing: ${tarball}`)
  const packed = JSON.parse(execFileSync('tar', ['-xOf', tarballName(manifest), 'package/package.json'], { cwd: out, encoding: 'utf8' }))
  assertPackage(packed)
  if (packed.version !== manifest.version) throw new Error('Packed version differs from the source manifest')
  if (JSON.stringify(packed.peerDependencies) !== JSON.stringify(manifest.peerDependencies)) {
    throw new Error('Packing changed the host peer requirements')
  }
  console.log(`Artifact: ${tarball}`)
  return tarball
}

function main() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const [command, ...args] = process.argv.slice(2)
  assertPackage(manifest)
  if (command === 'guard') {
    assertPublishContext(manifest, process.env)
    return
  }
  if (command !== 'pack' && command !== 'publish') throw new Error('Expected pack, publish, or guard command')
  const out = parseOutput(args)
  if (command === 'publish') assertPublishContext(manifest, process.env)
  const tarball = pack(manifest, out)
  if (command === 'publish') {
    run('npm', ['publish', tarball, '--ignore-scripts', '--provenance', '--access', 'public', '--registry', 'https://registry.npmjs.org/', '--tag', 'latest'])
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
