import { app, BrowserWindow, protocol, net, Tray, Menu, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import { registerApiKeyHandlers } from './ipc/apiKeys'
import { registerChatHandlers } from './ipc/chat'
import { registerSettingsHandlers } from './ipc/settings'
import { registerLogHandlers } from './ipc/log'
import { initDatabase } from './store/database'
import { getImagesDir, getStorageInfo } from './utils/paths'
import { logger, cleanOldLogs, readLogs } from './utils/logger'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createTray(): void {
  const iconPath = path.join(__dirname, '../../build/tray-icon.png')
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()

  tray = new Tray(icon)
  tray.setToolTip('ImageCreater')

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => mainWindow?.show() },
    { type: 'separator' },
    {
      label: '导出日志', click: async () => {
        if (!mainWindow) return
        const { dialog } = require('electron')
        const content = readLogs()
        if (!content) return
        const result = await dialog.showSaveDialog(mainWindow, {
          title: '导出日志',
          defaultPath: `image-creater-logs-${new Date().toISOString().slice(0, 10)}.log`,
          filters: [{ name: '日志文件', extensions: ['log'] }]
        })
        if (!result.canceled && result.filePath) {
          fs.writeFileSync(result.filePath, content, 'utf-8')
        }
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => mainWindow?.show())
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#ffffff', symbolColor: '#333333', height: 40 } })
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  // 打印存储信息
  const storageInfo = getStorageInfo()
  logger.info(`平台: ${storageInfo.platform}`)
  logger.info(`数据目录: ${storageInfo.userDataDir}`)
  logger.info(`图片目录: ${storageInfo.imagesDir}`)
  logger.info(`数据库: ${storageInfo.dbPath}`)

  // 初始化数据库
  try {
    await initDatabase()
    logger.info('数据库初始化成功')
  } catch (error) {
    logger.error('数据库初始化失败:', error)
  }

  // 注册自定义协议加载本地图片
  const imagesDir = getImagesDir()
  protocol.handle('app-image', (request) => {
    const filename = request.url.replace('app-image://', '')
    const filePath = path.join(imagesDir, filename)
    if (!fs.existsSync(filePath)) {
      logger.error(`[Protocol] 图片不存在: ${filePath}`)
      return new Response('Not Found', { status: 404 })
    }
    return net.fetch(`file://${filePath}`)
  })

  registerApiKeyHandlers()
  registerChatHandlers()
  registerSettingsHandlers()
  registerLogHandlers()

  // 启动时清理 30 天前的日志
  try { cleanOldLogs(30) } catch {}

  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
