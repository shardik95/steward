import { contextBridge, ipcRenderer } from 'electron'

const PICK_FOLDER_CHANNEL = 'steward:pick-folder'

contextBridge.exposeInMainWorld('steward', {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(PICK_FOLDER_CHANNEL)
})
