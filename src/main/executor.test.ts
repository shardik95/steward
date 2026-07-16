import { afterEach, describe, expect, it } from 'vitest'
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Plan } from '../shared/contracts'
import { executeApprovedPlan, undoSuccessfulMoves } from './executor'
import { createInventory } from './inventory'
import { ExecutionJournal } from './journal'
import { directoryIdentity } from './path-policy'
import type { ApprovedFolderSession } from './session'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function makeSession(rootPath: string): Promise<ApprovedFolderSession> {
  return { rootPath, sessionId: 'test-session', rootIdentity: directoryIdentity(await lstat(rootPath)) }
}

async function movePlan(session: ApprovedFolderSession, sourceRelativePath = 'invoice.pdf'): Promise<Plan> {
  const inventory = await createInventory(session)
  return {
    objective: 'Organize invoices',
    inventoryFingerprint: inventory.fingerprint,
    summary: 'Test plan',
    questions: [],
    actions: [
      { id: 'create-finance', type: 'create_folder', relativePath: 'Finance', reason: 'Test folder.' },
      {
        id: 'move-invoice',
        type: 'move_file',
        sourceRelativePath,
        destinationDirectoryRelativePath: 'Finance',
        reason: 'Test move.',
        dependsOn: ['create-finance']
      }
    ]
  }
}

describe('executeApprovedPlan', () => {
  it('moves an approved regular file, verifies it, and safely undoes it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'steward-execute-'))
    temporaryPaths.push(root)
    await writeFile(join(root, 'invoice.pdf'), 'invoice')
    const session = await makeSession(root)
    const journal = new ExecutionJournal()

    const outcome = await executeApprovedPlan(session, await movePlan(session), ['create-finance', 'move-invoice'], journal)

    expect(outcome.results.map((entry) => entry.status)).toEqual(['succeeded', 'succeeded'])
    await expect(lstat(join(root, 'invoice.pdf'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await lstat(join(root, 'Finance', 'invoice.pdf'))).isFile()).toBe(true)
    expect(outcome.canUndo).toBe(true)

    const undoOutcome = await undoSuccessfulMoves(session, journal)
    expect(undoOutcome.results[0].status).toBe('succeeded')
    expect((await lstat(join(root, 'invoice.pdf'))).isFile()).toBe(true)
    expect(undoOutcome.canUndo).toBe(false)
  })

  it('rejects a destination collision without overwriting either file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'steward-collision-'))
    temporaryPaths.push(root)
    await mkdir(join(root, 'Finance'))
    await writeFile(join(root, 'invoice.pdf'), 'source')
    await writeFile(join(root, 'Finance', 'invoice.pdf'), 'existing destination')
    const session = await makeSession(root)

    const outcome = await executeApprovedPlan(session, await movePlan(session), ['create-finance', 'move-invoice'], new ExecutionJournal())

    expect(outcome.results).toEqual([
      expect.objectContaining({ actionId: 'create-finance', status: 'succeeded' }),
      expect.objectContaining({ actionId: 'move-invoice', status: 'failed', errorCode: 'DESTINATION_COLLISION' })
    ])
    expect((await lstat(join(root, 'invoice.pdf'))).isFile()).toBe(true)
    expect((await lstat(join(root, 'Finance', 'invoice.pdf'))).isFile()).toBe(true)
  })

  it('marks an inventory-changed plan stale before any write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'steward-stale-'))
    temporaryPaths.push(root)
    await writeFile(join(root, 'invoice.pdf'), 'before')
    const session = await makeSession(root)
    const plan = await movePlan(session)
    await writeFile(join(root, 'invoice.pdf'), 'after the plan was made')

    const outcome = await executeApprovedPlan(session, plan, ['create-finance', 'move-invoice'], new ExecutionJournal())

    expect(outcome.results.every((entry) => entry.errorCode === 'PLAN_STALE')).toBe(true)
    await expect(lstat(join(root, 'Finance'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await lstat(join(root, 'invoice.pdf'))).isFile()).toBe(true)
  })

  it('reports a typed stale failure when a symlink appears after planning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'steward-symlink-'))
    temporaryPaths.push(root)
    const outside = join(tmpdir(), `steward-outside-${Date.now()}.pdf`)
    temporaryPaths.push(outside)
    await writeFile(join(root, 'invoice.pdf'), 'inside root')
    await writeFile(outside, 'outside root')
    const session = await makeSession(root)
    const plan = await movePlan(session)
    await rm(join(root, 'invoice.pdf'))
    await symlink(outside, join(root, 'invoice.pdf'))

    const outcome = await executeApprovedPlan(session, plan, ['create-finance', 'move-invoice'], new ExecutionJournal())

    expect(outcome.results.every((entry) => entry.errorCode === 'PLAN_STALE')).toBe(true)
    await expect(lstat(join(root, 'Finance'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await lstat(outside)).toMatchObject({ size: 12 })
  })
})
