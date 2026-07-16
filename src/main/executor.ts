import { lstat, mkdir, rename } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import type { Action, ActionErrorCode, ActionResult, ExecutionOutcome, Plan } from '../shared/contracts'
import { createInventory } from './inventory'
import { ExecutionJournal } from './journal'
import { parsePlan, PlanValidationError, validatePlan } from './planner'
import { directoryIdentity, PathPolicyError, resolveWithinRoot, sameDirectory } from './path-policy'
import type { ApprovedFolderSession } from './session'

class ExecutionError extends Error {
  constructor(
    readonly code: ActionErrorCode,
    message: string,
    readonly observedState: Record<string, unknown> = {}
  ) {
    super(message)
  }
}

function result(actionId: string, status: ActionResult['status'], userMessage: string, errorCode?: ActionErrorCode, observedState: Record<string, unknown> = {}): ActionResult {
  return { actionId, status, userMessage, ...(errorCode ? { errorCode } : {}), observedState }
}

function mapError(error: unknown): ExecutionError {
  if (error instanceof ExecutionError) return error
  if (error instanceof PathPolicyError) {
    return new ExecutionError(error.code === 'SYMLINK_NOT_ALLOWED' ? 'SYMLINK' : 'OUTSIDE_ROOT', error.message)
  }
  if (error instanceof PlanValidationError) return new ExecutionError('INVALID_PLAN', error.message)
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: string }).code : undefined
  if (code === 'EACCES' || code === 'EPERM') return new ExecutionError('PERMISSION_DENIED', 'Steward does not have permission to complete this action.')
  return new ExecutionError('INVALID_PLAN', 'Steward could not safely complete this action.')
}

async function statOrNull(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT') return null
    throw error
  }
}

async function assertSessionRoot(session: ApprovedFolderSession): Promise<void> {
  const stats = await lstat(session.rootPath)
  if (stats.isSymbolicLink()) throw new ExecutionError('SYMLINK', 'The approved folder is now a symbolic link.')
  if (!stats.isDirectory() || !sameDirectory(directoryIdentity(stats), session.rootIdentity)) {
    throw new ExecutionError('PLAN_STALE', 'The approved folder changed after the plan was created.')
  }
}

/** Ensures every existing component is an in-root directory (except an optional final file). */
async function assertSafePath(session: ApprovedFolderSession, target: string, finalKind: 'file' | 'directory' | 'missing-ok') {
  await assertSessionRoot(session)
  const safeTarget = resolveWithinRoot(session.rootPath, target)
  const segments = relative(session.rootPath, safeTarget).split(/[/\\]/).filter(Boolean)
  let current = session.rootPath

  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index])
    const stats = await statOrNull(current)
    if (!stats) {
      if (finalKind === 'missing-ok') return { path: safeTarget, stats: null }
      throw new ExecutionError('SOURCE_MISSING', 'A required file or folder is missing.', { path: safeTarget })
    }
    if (stats.isSymbolicLink()) throw new ExecutionError('SYMLINK', 'Symbolic links cannot be used in an action path.', { path: current })
    const isFinal = index === segments.length - 1
    if (!isFinal && !stats.isDirectory()) throw new ExecutionError('SOURCE_MISSING', 'An action path contains a file where a folder is required.', { path: current })
    if (isFinal && finalKind === 'file' && !stats.isFile()) throw new ExecutionError('SOURCE_MISSING', 'The requested source is not a regular file.', { path: safeTarget })
    if (isFinal && finalKind === 'directory' && !stats.isDirectory()) throw new ExecutionError('SOURCE_MISSING', 'The requested destination is not a folder.', { path: safeTarget })
  }
  return { path: safeTarget, stats: await statOrNull(safeTarget) }
}

function executionOrder(plan: Plan): Action[] {
  const byId = new Map(plan.actions.map((action) => [action.id, action]))
  const ordered: Action[] = []
  const visited = new Set<string>()
  const visit = (action: Action): void => {
    if (visited.has(action.id)) return
    for (const dependency of action.dependsOn ?? []) visit(byId.get(dependency)!)
    visited.add(action.id)
    ordered.push(action)
  }
  plan.actions.forEach(visit)
  return ordered
}

async function executeAction(session: ApprovedFolderSession, action: Action, journal: ExecutionJournal): Promise<ActionResult> {
  if (action.type === 'flag_duplicate_candidates') {
    return result(action.id, 'skipped', 'Duplicate candidates are review findings; no file operation was requested.')
  }

  const actionEntry = journal.beginAction(session.sessionId, action)
  try {
    if (action.type === 'create_folder') {
      const target = resolveWithinRoot(session.rootPath, join(session.rootPath, action.relativePath))
      await assertSafePath(session, target, 'missing-ok')
      await mkdir(target, { recursive: true })
      await assertSafePath(session, target, 'directory')
      journal.completeAction(actionEntry, 'succeeded')
      return result(action.id, 'succeeded', 'Folder exists and was verified.', undefined, { relativePath: action.relativePath })
    }

    const source = await assertSafePath(session, join(session.rootPath, action.sourceRelativePath), 'file')
    const destinationDirectory = await assertSafePath(session, join(session.rootPath, action.destinationDirectoryRelativePath), 'directory')
    const destinationRelativePath = `${action.destinationDirectoryRelativePath.replace(/\/$/, '')}/${basename(action.sourceRelativePath)}`
    const destination = resolveWithinRoot(session.rootPath, join(destinationDirectory.path, basename(action.sourceRelativePath)))
    const existingDestination = await statOrNull(destination)
    if (existingDestination) {
      throw new ExecutionError('DESTINATION_COLLISION', 'A file or folder already exists at the destination. Nothing was overwritten.', { destinationRelativePath })
    }

    const entry = journal.beginMove(session.sessionId, action, destinationRelativePath)
    try {
      await assertSafePath(session, source.path, 'file')
      await assertSafePath(session, destinationDirectory.path, 'directory')
      if (await statOrNull(destination)) throw new ExecutionError('DESTINATION_COLLISION', 'A destination appeared while preparing the move. Nothing was overwritten.', { destinationRelativePath })
      await rename(source.path, destination)
      journal.complete(entry, 'succeeded')
      journal.completeAction(actionEntry, 'succeeded')
      return result(action.id, 'succeeded', 'File moved and awaiting independent verification.', undefined, { sourceRelativePath: action.sourceRelativePath, destinationRelativePath })
    } catch (error) {
      journal.complete(entry, 'failed')
      throw error
    }
  } catch (error) {
    journal.completeAction(actionEntry, 'failed')
    const safeError = mapError(error)
    return result(action.id, 'failed', safeError.message, safeError.code, safeError.observedState)
  }
}

async function verifySucceededResults(session: ApprovedFolderSession, actions: Map<string, Action>, results: ActionResult[]): Promise<ActionResult[]> {
  const verified = [...results]
  for (const [index, current] of verified.entries()) {
    if (current.status !== 'succeeded') continue
    const action = actions.get(current.actionId)
    if (!action) continue
    try {
      if (action.type === 'create_folder') {
        await assertSafePath(session, join(session.rootPath, action.relativePath), 'directory')
      } else if (action.type === 'move_file') {
        const source = await statOrNull(resolveWithinRoot(session.rootPath, join(session.rootPath, action.sourceRelativePath)))
        const destination = await assertSafePath(session, join(session.rootPath, current.observedState.destinationRelativePath as string), 'file')
        if (source || !destination.stats?.isFile()) throw new ExecutionError('SOURCE_MISSING', 'The moved file could not be independently verified.')
      }
      verified[index] = { ...current, userMessage: current.userMessage.replace(' and awaiting independent verification', '') }
    } catch (error) {
      const safeError = mapError(error)
      verified[index] = result(current.actionId, 'failed', safeError.message, safeError.code, safeError.observedState)
    }
  }
  return verified
}

export async function executeApprovedPlan(session: ApprovedFolderSession, rawPlan: unknown, rawApprovedActionIds: unknown, journal: ExecutionJournal): Promise<ExecutionOutcome> {
  const plan = parsePlan(rawPlan)
  if (!Array.isArray(rawApprovedActionIds) || rawApprovedActionIds.some((id) => typeof id !== 'string')) {
    throw new PlanValidationError('Approved action IDs must be an array of strings.')
  }
  const approved = new Set(rawApprovedActionIds)
  if ([...approved].some((id) => !plan.actions.some((action) => action.id === id))) {
    throw new PlanValidationError('Approval included an action that is not in this plan.')
  }

  const inventory = await createInventory(session)
  try {
    validatePlan(plan, inventory)
  } catch (error) {
    const safeError = mapError(error)
    return {
      results: plan.actions.map((action) => approved.has(action.id)
        ? result(action.id, 'failed', safeError.code === 'INVALID_PLAN' && plan.inventoryFingerprint !== inventory.fingerprint ? 'The folder changed, so this plan is stale.' : safeError.message, plan.inventoryFingerprint !== inventory.fingerprint ? 'PLAN_STALE' : safeError.code)
        : result(action.id, 'skipped', 'This action was not approved.')),
      inventory,
      canUndo: journal.successfulMoves(session.sessionId).length > 0
    }
  }

  journal.useSession(session.sessionId)
  const resultsById = new Map<string, ActionResult>()
  for (const action of executionOrder(plan)) {
    if (!approved.has(action.id)) {
      resultsById.set(action.id, result(action.id, 'skipped', 'This action was not approved.'))
      continue
    }
    const blockedDependency = (action.dependsOn ?? []).find((id) => resultsById.get(id)?.status !== 'succeeded')
    if (blockedDependency) {
      resultsById.set(action.id, result(action.id, 'skipped', 'A required action was not completed, so this action was skipped.', 'DEPENDENCY_NOT_MET', { dependency: blockedDependency }))
      continue
    }
    resultsById.set(action.id, await executeAction(session, action, journal))
  }

  try {
    const postExecutionInventory = await createInventory(session)
    const verifiedResults = await verifySucceededResults(session, new Map(plan.actions.map((action) => [action.id, action])), plan.actions.map((action) => resultsById.get(action.id)!))
    return { results: verifiedResults, inventory: postExecutionInventory, canUndo: journal.successfulMoves(session.sessionId).length > 0 }
  } catch (error) {
    const safeError = mapError(error)
    return {
      results: [
        ...plan.actions.map((action) => resultsById.get(action.id)!),
        result('batch-verification', 'failed', `Steward could not independently verify this batch: ${safeError.message}`, safeError.code)
      ],
      inventory: null,
      canUndo: journal.successfulMoves(session.sessionId).length > 0,
      verificationError: 'The file operations may have completed, but Steward could not safely verify the folder state.'
    }
  }
}

export async function undoSuccessfulMoves(session: ApprovedFolderSession, journal: ExecutionJournal): Promise<ExecutionOutcome> {
  journal.useSession(session.sessionId)
  const results: ActionResult[] = []
  for (const entry of journal.successfulMoves(session.sessionId)) {
    try {
      const destination = await assertSafePath(session, join(session.rootPath, entry.destinationRelativePath), 'file')
      const original = resolveWithinRoot(session.rootPath, join(session.rootPath, entry.sourceRelativePath))
      if (await statOrNull(original)) {
        throw new ExecutionError('DESTINATION_COLLISION', 'The original location is occupied, so the move cannot be undone safely.', { sourceRelativePath: entry.sourceRelativePath })
      }
      await assertSafePath(session, original, 'missing-ok')
      await rename(destination.path, original)
      await assertSafePath(session, original, 'file')
      journal.markUndone(entry)
      results.push(result(`${entry.actionId}:undo`, 'succeeded', 'Move was undone safely.', undefined, { sourceRelativePath: entry.sourceRelativePath }))
    } catch (error) {
      const safeError = mapError(error)
      results.push(result(`${entry.actionId}:undo`, 'failed', safeError.message, safeError.code, safeError.observedState))
    }
  }
  try {
    return { results, inventory: await createInventory(session), canUndo: journal.successfulMoves(session.sessionId).length > 0 }
  } catch (error) {
    const safeError = mapError(error)
    return {
      results: [
        ...results,
        result('undo-verification', 'failed', `Steward could not independently verify the undo: ${safeError.message}`, safeError.code)
      ],
      inventory: null,
      canUndo: journal.successfulMoves(session.sessionId).length > 0,
      verificationError: 'The undo may have completed, but Steward could not safely verify the folder state.'
    }
  }
}
