export {}

import type { ExecutionOutcome, Inventory, Plan, SelectedFolder } from '../../shared/contracts'

declare global {
  interface Window {
    /** The deliberately small, typed API exposed by Electron's preload script. */
    steward: {
      pickFolder(): Promise<SelectedFolder | null>
      getInventory(): Promise<Inventory>
      createPlan(objective: string): Promise<Plan>
      executePlan(plan: Plan, approvedActionIds: string[]): Promise<ExecutionOutcome>
      undoMoves(): Promise<ExecutionOutcome>
    }
  }
}
