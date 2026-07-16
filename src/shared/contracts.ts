/** Serializable metadata only; file contents never cross the process boundary. */
export type SelectedFolder = {
  path: string
  name: string
}

export type InventoryFile = {
  relativePath: string
  name: string
  extension: string
  sizeBytes: number
  modifiedAt: string
}

export type InventoryFolder = {
  relativePath: string
  name: string
}

export type Inventory = {
  fingerprint: string
  scannedAt: string
  files: InventoryFile[]
  folders: InventoryFolder[]
  skippedSymlinks: string[]
}

export type CreateFolderAction = {
  id: string
  type: 'create_folder'
  relativePath: string
  reason: string
  dependsOn?: string[]
}

export type MoveFileAction = {
  id: string
  type: 'move_file'
  sourceRelativePath: string
  destinationDirectoryRelativePath: string
  reason: string
  dependsOn?: string[]
}

export type DuplicateCandidateGroup = {
  fileRelativePaths: string[]
  confidence: 'exact' | 'likely'
  evidence: 'matching_sha256' | 'similar_name_and_metadata'
}

export type FlagDuplicateCandidatesAction = {
  id: string
  type: 'flag_duplicate_candidates'
  candidateGroups: DuplicateCandidateGroup[]
  reason: string
  requiresUserDecision: true
}

export type Action = CreateFolderAction | MoveFileAction | FlagDuplicateCandidatesAction

export type PlanQuestion = {
  id: string
  prompt: string
  choices?: string[]
}

export type Plan = {
  objective: string
  inventoryFingerprint: string
  summary: string
  actions: Action[]
  questions: PlanQuestion[]
}
