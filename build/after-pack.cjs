const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

function codesign(target, identity, entitlements, useHardenedRuntime) {
  const args = ['--sign', identity, '--force', '--timestamp=none']
  if (useHardenedRuntime) args.push('--options', 'runtime')
  if (entitlements) args.push('--entitlements', entitlements)
  args.push(target)
  console.log(`[afterPack] codesign ${target}`)
  run('/usr/bin/codesign', args)
}

function walk(dir, predicate, results = []) {
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      walk(fullPath, predicate, results)
    } else if (predicate(fullPath)) {
      results.push(fullPath)
    }
  }
  return results
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const frameworksPath = path.join(appPath, 'Contents', 'Frameworks')
  const entitlements = path.join(context.packager.projectDir, 'build', 'entitlements.mac.plist')
  const identity = process.env.CSC_NAME || process.env.MAC_CODESIGN_IDENTITY || '-'
  const useHardenedRuntime = identity !== '-'

  console.log(`[afterPack] codesign mac app with identity "${identity}", hardenedRuntime=${useHardenedRuntime}`)

  const executableFiles = walk(frameworksPath, (file) => {
    const stat = fs.statSync(file)
    return file.endsWith('.dylib') || (stat.mode & 0o111) !== 0
  }).sort((a, b) => b.length - a.length)
  for (const file of executableFiles) {
    codesign(file, identity, undefined, useHardenedRuntime)
  }

  const bundles = [
    ...walk(frameworksPath, (file) => path.basename(file) === 'Info.plist')
      .map((file) => path.dirname(path.dirname(file)))
      .filter((dir) => dir.endsWith('.app') || dir.endsWith('.framework')),
    ...fs.readdirSync(frameworksPath)
      .filter((name) => name.endsWith('.framework') || name.endsWith('.app'))
      .map((name) => path.join(frameworksPath, name))
  ]

  for (const bundle of [...new Set(bundles)].sort((a, b) => b.length - a.length)) {
    codesign(bundle, identity, bundle.endsWith('.app') ? entitlements : undefined, useHardenedRuntime)
  }

  codesign(appPath, identity, entitlements, useHardenedRuntime)
}
