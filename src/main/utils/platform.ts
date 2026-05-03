export function getPlatform(): string {
  return process.platform
}

export function isMac(): boolean {
  return process.platform === 'darwin'
}

export function isWindows(): boolean {
  return process.platform === 'win32'
}

export function isLinux(): boolean {
  return process.platform === 'linux'
}
