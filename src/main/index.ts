import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { is } from '@electron-toolkit/utils'
import { createInventory } from './inventory'
import { createDeterministicPlan } from './planner'
import { getApprovedSession, approveFolder } from './session'
import { IPC_CHANNELS } from '../shared/ipc'

let mainWindow: BrowserWindow | null = null

function isTrustedRendererUrl(url: string): boolean {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    return new URL(url).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
  }

  return url === pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

function requireTrustedMainFrame(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('This request did not originate from Steward’s main window.')
  }
  return mainWindow
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).protocol === 'https:') void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })

  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  ipcMain.handle(IPC_CHANNELS.pickFolder, async (event) => {
    const ownerWindow = requireTrustedMainFrame(event)
    const result = await dialog.showOpenDialog({
      parent: ownerWindow,
      title: 'Choose a folder',
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || !result.filePaths[0]) return null
    return approveFolder(resolve(result.filePaths[0]))
  })

  ipcMain.handle(IPC_CHANNELS.getInventory, async (event) => {
    requireTrustedMainFrame(event)
    return createInventory(getApprovedSession())
  })

  ipcMain.handle(IPC_CHANNELS.createPlan, async (event, objective: unknown) => {
    requireTrustedMainFrame(event)
    if (typeof objective !== 'string') throw new Error('A planning objective must be text.')
    const inventory = await createInventory(getApprovedSession())
    return createDeterministicPlan(objective, inventory)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
