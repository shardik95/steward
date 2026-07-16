import type { Action } from '../shared/contracts'

export type MoveJournalEntry = {
  actionId: string
  sessionId: string
  sourceRelativePath: string
  destinationRelativePath: string
  startedAt: string
  completedAt?: string
  status: 'started' | 'succeeded' | 'failed'
  undoneAt?: string
}

export type ActionJournalEntry = {
  actionId: string
  actionType: Action['type']
  sessionId: string
  startedAt: string
  completedAt?: string
  status: 'started' | 'succeeded' | 'failed'
}

/** In-memory only: entries are discarded when the user selects a new root/session. */
export class ExecutionJournal {
  private sessionId: string | null = null
  private moveEntries: MoveJournalEntry[] = []
  private actionEntries: ActionJournalEntry[] = []

  useSession(sessionId: string): void {
    if (this.sessionId !== sessionId) {
      this.sessionId = sessionId
      this.moveEntries = []
      this.actionEntries = []
    }
  }

  beginAction(sessionId: string, action: Action): ActionJournalEntry {
    this.useSession(sessionId)
    const entry: ActionJournalEntry = {
      actionId: action.id,
      actionType: action.type,
      sessionId,
      startedAt: new Date().toISOString(),
      status: 'started'
    }
    this.actionEntries.push(entry)
    return entry
  }

  completeAction(entry: ActionJournalEntry, status: 'succeeded' | 'failed'): void {
    entry.status = status
    entry.completedAt = new Date().toISOString()
  }

  beginMove(sessionId: string, action: Extract<Action, { type: 'move_file' }>, destinationRelativePath: string): MoveJournalEntry {
    this.useSession(sessionId)
    const entry: MoveJournalEntry = {
      actionId: action.id,
      sessionId,
      sourceRelativePath: action.sourceRelativePath,
      destinationRelativePath,
      startedAt: new Date().toISOString(),
      status: 'started'
    }
    this.moveEntries.push(entry)
    return entry
  }

  complete(entry: MoveJournalEntry, status: 'succeeded' | 'failed'): void {
    entry.status = status
    entry.completedAt = new Date().toISOString()
  }

  successfulMoves(sessionId: string): MoveJournalEntry[] {
    this.useSession(sessionId)
    return this.moveEntries.filter((entry) => entry.status === 'succeeded' && !entry.undoneAt).toReversed()
  }

  markUndone(entry: MoveJournalEntry): void {
    entry.undoneAt = new Date().toISOString()
  }
}
