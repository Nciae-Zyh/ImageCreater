import { app } from 'electron'
import path from 'path'
import fs from 'fs'

// 跨平台路径管理
// macOS:   ~/Library/Application Support/image-creater/
// Windows: %APPDATA%\image-creater\
// Linux:   ~/.config/image-creater/

let _userDataDir: string | null = null

export function getUserDataDir(): string {
  if (!_userDataDir) {
    _userDataDir = app.getPath('userData')
  }
  return _userDataDir
}

export function getImagesDir(): string {
  const dir = path.join(getUserDataDir(), 'images')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getDatabasePath(): string {
  return path.join(getUserDataDir(), 'image-creater.db')
}

export function getImageFilePath(conversationId: string, messageId: string, ext: string = 'png'): string {
  const filename = `${conversationId}_${messageId}.${ext}`
  return path.join(getImagesDir(), filename)
}

export function getStorageInfo(): { platform: string; userDataDir: string; imagesDir: string; dbPath: string } {
  return {
    platform: process.platform,
    userDataDir: getUserDataDir(),
    imagesDir: getImagesDir(),
    dbPath: getDatabasePath()
  }
}
