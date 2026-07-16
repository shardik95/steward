import { contextBridge, ipcRenderer } from 'electron'
import type { ExecutionOutcome, Inventory, Plan, SelectedFolder } from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/ipc'

contextBridge.exposeInMainWorld('steward', {
  pickFolder: (): Promise<SelectedFolder | null> => ipcRenderer.invoke(IPC_CHANNELS.pickFolder),
  getInventory: (): Promise<Inventory> => ipcRenderer.invoke(IPC_CHANNELS.getInventory),
  createPlan: (objective: string): Promise<Plan> => ipcRenderer.invoke(IPC_CHANNELS.createPlan, objective),
  executePlan: (plan: Plan, approvedActionIds: string[]): Promise<ExecutionOutcome> => ipcRenderer.invoke(IPC_CHANNELS.executePlan, plan, approvedActionIds),
  undoMoves: (): Promise<ExecutionOutcome> => ipcRenderer.invoke(IPC_CHANNELS.undoMoves)
})
