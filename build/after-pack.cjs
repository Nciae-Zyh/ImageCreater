const { execFileSync } = require('child_process')
const path = require('path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const identity = process.env.CSC_NAME || process.env.MAC_CODESIGN_IDENTITY || '-'
  const args = [
    '--sign',
    identity,
    '--force',
    '--deep',
    '--options',
    'runtime',
    '--timestamp=none',
    appPath
  ]

  console.log(`[afterPack] codesign mac app with identity "${identity}"`)
  execFileSync('/usr/bin/codesign', args, { stdio: 'inherit' })
}
