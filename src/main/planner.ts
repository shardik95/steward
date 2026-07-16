import { basename, extname, posix } from 'node:path'
import type {
  Action,
  DuplicateCandidateGroup,
  Inventory,
  InventoryFile,
  Plan,
  PlanQuestion
} from '../shared/contracts'

const INSTALLER_EXTENSIONS = new Set(['.dmg', '.exe', '.msi', '.pkg', '.appimage', '.deb', '.rpm'])

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new PlanValidationError(`${fieldName} must be an array of strings.`)
  }
  return value
}

/** Parses untrusted IPC/LLM-shaped data before semantic validation. */
export function parsePlan(value: unknown): Plan {
  if (!isRecord(value) || typeof value.objective !== 'string' || typeof value.inventoryFingerprint !== 'string' ||
    typeof value.summary !== 'string' || !Array.isArray(value.actions) || !Array.isArray(value.questions)) {
    throw new PlanValidationError('Plan data does not match the expected schema.')
  }

  const actions: Action[] = value.actions.map((rawAction) => {
    if (!isRecord(rawAction) || typeof rawAction.id !== 'string' || typeof rawAction.type !== 'string' || typeof rawAction.reason !== 'string') {
      throw new PlanValidationError('An action does not match the expected schema.')
    }
    const dependsOn = parseStringArray(rawAction.dependsOn, 'dependsOn')
    if (rawAction.type === 'create_folder' && typeof rawAction.relativePath === 'string') {
      return { id: rawAction.id, type: 'create_folder', relativePath: rawAction.relativePath, reason: rawAction.reason, ...(dependsOn ? { dependsOn } : {}) }
    }
    if (rawAction.type === 'move_file' && typeof rawAction.sourceRelativePath === 'string' && typeof rawAction.destinationDirectoryRelativePath === 'string') {
      return {
        id: rawAction.id,
        type: 'move_file',
        sourceRelativePath: rawAction.sourceRelativePath,
        destinationDirectoryRelativePath: rawAction.destinationDirectoryRelativePath,
        reason: rawAction.reason,
        ...(dependsOn ? { dependsOn } : {})
      }
    }
    if (rawAction.type === 'flag_duplicate_candidates' && rawAction.requiresUserDecision === true && Array.isArray(rawAction.candidateGroups)) {
      const candidateGroups = rawAction.candidateGroups.map((rawGroup) => {
        if (!isRecord(rawGroup) || !Array.isArray(rawGroup.fileRelativePaths) || rawGroup.fileRelativePaths.some((path) => typeof path !== 'string') ||
          (rawGroup.confidence !== 'exact' && rawGroup.confidence !== 'likely') ||
          (rawGroup.evidence !== 'matching_sha256' && rawGroup.evidence !== 'similar_name_and_metadata')) {
          throw new PlanValidationError('A duplicate candidate group does not match the expected schema.')
        }
        return { fileRelativePaths: rawGroup.fileRelativePaths, confidence: rawGroup.confidence, evidence: rawGroup.evidence }
      })
      return { id: rawAction.id, type: 'flag_duplicate_candidates', candidateGroups, reason: rawAction.reason, requiresUserDecision: true }
    }
    throw new PlanValidationError('An action type is not allowlisted.')
  })

  const questions = value.questions.map((rawQuestion) => {
    if (!isRecord(rawQuestion) || typeof rawQuestion.id !== 'string' || typeof rawQuestion.prompt !== 'string') {
      throw new PlanValidationError('A question does not match the expected schema.')
    }
    const choices = parseStringArray(rawQuestion.choices, 'choices')
    return { id: rawQuestion.id, prompt: rawQuestion.prompt, ...(choices ? { choices } : {}) }
  })

  return { objective: value.objective, inventoryFingerprint: value.inventoryFingerprint, summary: value.summary, actions, questions }
}

function isSafeRelativePath(value: string): boolean {
  if (!value || value.includes('\\')) return false
  const normalized = posix.normalize(value)
  return !normalized.startsWith('../') && normalized !== '..' && !normalized.startsWith('/') && normalized !== '.'
}

function normalizeFileName(file: InventoryFile): string {
  const stem = basename(file.name, extname(file.name)).toLocaleLowerCase()
  return stem
    .replace(/\s*\((?:copy|copy \d+|\d+)\)$/i, '')
    .replace(/(?:[\s_-]+copy(?:[\s_-]*\d+)?)$/i, '')
    .replace(/(?:[\s_-]+\d+)$/i, '')
    .replace(/[\s_-]+/g, ' ')
    .trim()
}

function findLikelyDuplicateGroups(files: InventoryFile[]): DuplicateCandidateGroup[] {
  const groups = new Map<string, InventoryFile[]>()

  for (const file of files) {
    const normalizedName = normalizeFileName(file)
    if (!normalizedName) continue
    const key = `${file.extension}:${file.sizeBytes}:${normalizedName}`
    const group = groups.get(key) ?? []
    group.push(file)
    groups.set(key, group)
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      fileRelativePaths: group.map((file) => file.relativePath).sort(),
      confidence: 'likely' as const,
      evidence: 'similar_name_and_metadata' as const
    }))
    .sort((left, right) => left.fileRelativePaths[0].localeCompare(right.fileRelativePaths[0]))
}

function actionId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`
}

export function validatePlan(plan: Plan, inventory: Inventory): void {
  if (!plan.objective.trim()) throw new PlanValidationError('A plan needs a non-empty objective.')
  if (plan.inventoryFingerprint !== inventory.fingerprint) {
    throw new PlanValidationError('The plan was created from a different inventory.')
  }

  const actionIds = new Set<string>()
  const inventoryFiles = new Set(inventory.files.map((file) => file.relativePath))
  const moveSources = new Set<string>()

  for (const action of plan.actions) {
    if (!action.id || actionIds.has(action.id)) {
      throw new PlanValidationError('Each action needs a unique identifier.')
    }
    actionIds.add(action.id)

    if (action.type === 'create_folder' && !isSafeRelativePath(action.relativePath)) {
      throw new PlanValidationError('Folder actions must use a safe relative path.')
    }
    if (action.type === 'move_file') {
      if (!isSafeRelativePath(action.sourceRelativePath) || !isSafeRelativePath(action.destinationDirectoryRelativePath)) {
        throw new PlanValidationError('Move actions must use safe relative paths.')
      }
      if (!inventoryFiles.has(action.sourceRelativePath)) {
        throw new PlanValidationError('Move actions can only reference inventoried regular files.')
      }
      if (moveSources.has(action.sourceRelativePath)) {
        throw new PlanValidationError('A file can only be moved once in a plan.')
      }
      moveSources.add(action.sourceRelativePath)
    }
    if (action.type === 'flag_duplicate_candidates') {
      for (const group of action.candidateGroups) {
        if (group.fileRelativePaths.length < 2 || group.fileRelativePaths.some((path) => !inventoryFiles.has(path))) {
          throw new PlanValidationError('Duplicate findings can only reference inventoried files.')
        }
      }
    }
  }

  for (const action of plan.actions) {
    for (const dependency of action.dependsOn ?? []) {
      if (!actionIds.has(dependency) || dependency === action.id) {
        throw new PlanValidationError('Actions can only depend on other plan actions.')
      }
    }
  }

  const visited = new Set<string>()
  const active = new Set<string>()
  const byId = new Map(plan.actions.map((action) => [action.id, action]))
  const visit = (id: string): void => {
    if (active.has(id)) throw new PlanValidationError('Action dependencies cannot contain a cycle.')
    if (visited.has(id)) return
    active.add(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency)
    active.delete(id)
    visited.add(id)
  }
  for (const action of plan.actions) visit(action.id)
}

/**
 * Deliberately small learning harness. It recognizes known v0 requests but only returns data; the
 * executor introduced in Step 4 remains the sole future location for filesystem mutation.
 */
export function createDeterministicPlan(objective: string, inventory: Inventory): Plan {
  const normalizedObjective = objective.trim()
  if (!normalizedObjective || normalizedObjective.length > 500) {
    throw new PlanValidationError('Describe a goal using between 1 and 500 characters.')
  }

  const wantsInvoices = /invoice|finance/i.test(normalizedObjective)
  const wantsInstallers = /\binstallers?\b/i.test(normalizedObjective)
  const wantsDuplicates = /duplicate/i.test(normalizedObjective)
  const actions: Action[] = []
  const questions: PlanQuestion[] = []
  const plannedMoveSources = new Set<string>()

  if (!wantsInvoices && !wantsInstallers && !wantsDuplicates) {
    questions.push({
      id: 'supported-objectives',
      prompt: 'This first planner supports invoices, installers, and duplicate candidates. Which should Steward plan?',
      choices: ['Organize invoices', 'Archive installers', 'Review duplicate candidates']
    })
  }

  if (wantsInvoices) {
    const invoiceFiles = inventory.files.filter((file) => /invoice/i.test(file.name))
    if (invoiceFiles.length === 0) {
      questions.push({ id: 'no-invoices', prompt: 'No invoice-named files were found in this inventory.' })
    } else {
      const folderId = 'create-finance'
      actions.push({ id: folderId, type: 'create_folder', relativePath: 'Finance', reason: 'Keep invoice files together.' })
      invoiceFiles.forEach((file, index) => {
        actions.push({
          id: actionId('move-invoice', index),
          type: 'move_file',
          sourceRelativePath: file.relativePath,
          destinationDirectoryRelativePath: 'Finance',
          reason: 'The filename matches the requested invoice rule.',
          dependsOn: [folderId]
        })
        plannedMoveSources.add(file.relativePath)
      })
    }
  }

  if (wantsInstallers) {
    const installers = inventory.files.filter(
      (file) => INSTALLER_EXTENSIONS.has(file.extension) && !plannedMoveSources.has(file.relativePath)
    )
    if (installers.length === 0) {
      questions.push({ id: 'no-installers', prompt: 'No installer files were found in this inventory.' })
    } else {
      const folderId = 'create-installer-archive'
      actions.push({
        id: folderId,
        type: 'create_folder',
        relativePath: 'Archive/Installers',
        reason: 'Keep installer files in a dedicated archive.'
      })
      installers.forEach((file, index) => {
        actions.push({
          id: actionId('move-installer', index),
          type: 'move_file',
          sourceRelativePath: file.relativePath,
          destinationDirectoryRelativePath: 'Archive/Installers',
          reason: 'The extension matches the installer archive rule.',
          dependsOn: [folderId]
        })
        plannedMoveSources.add(file.relativePath)
      })
    }
  }

  if (wantsDuplicates) {
    const candidateGroups = findLikelyDuplicateGroups(inventory.files)
    actions.push({
      id: 'review-duplicate-candidates',
      type: 'flag_duplicate_candidates',
      candidateGroups,
      reason:
        candidateGroups.length > 0
          ? 'These filenames and file sizes are similar. Review them before deciding what to keep.'
          : 'No likely duplicate candidates were found from filename and metadata similarity.',
      requiresUserDecision: true
    })
  }

  const plan: Plan = {
    objective: normalizedObjective,
    inventoryFingerprint: inventory.fingerprint,
    summary:
      actions.length > 0
        ? `Prepared ${actions.length} review item${actions.length === 1 ? '' : 's'} from the current metadata inventory.`
        : 'No file changes are proposed yet; Steward needs your direction.',
    actions,
    questions
  }

  validatePlan(plan, inventory)
  return plan
}
