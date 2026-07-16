import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInventory } from './inventory'
import { directoryIdentity, PathPolicyError, resolveWithinRoot } from './path-policy'
import { lstat } from 'node:fs/promises'

const temporaryPaths: string[] = []

async function inventorySource(rootPath: string, sessionId = 'test-session') {
  return { rootPath, sessionId, rootIdentity: directoryIdentity(await lstat(rootPath)) }
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('resolveWithinRoot', () => {
  it('accepts paths inside the approved root', () => {
    const root = join(tmpdir(), 'steward-approved')
    expect(resolveWithinRoot(root, join(root, 'Finance', 'invoice.pdf'))).toBe(
      join(root, 'Finance', 'invoice.pdf')
    )
  })

  it('rejects paths that escape the approved root', () => {
    const root = join(tmpdir(), 'steward-approved')
    expect(() => resolveWithinRoot(root, join(root, '..', 'outside.txt'))).toThrow(PathPolicyError)
  })
})

describe('createInventory', () => {
  it('returns metadata for regular non-hidden files without following symbolic links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'steward-inventory-'))
    temporaryPaths.push(root)
    const nested = join(root, 'Receipts')
    const outsideFile = join(tmpdir(), `steward-outside-${Date.now()}.txt`)
    temporaryPaths.push(outsideFile)

    await mkdir(nested)
    await writeFile(join(root, 'invoice.pdf'), 'not read by inventory')
    await writeFile(join(nested, 'receipt.txt'), 'not read by inventory')
    await writeFile(join(root, '.hidden.txt'), 'hidden')
    await writeFile(outsideFile, 'must remain outside the inventory')
    await symlink(outsideFile, join(root, 'outside-link'))

    const inventory = await createInventory(await inventorySource(root))

    expect(inventory.files.map((file) => file.relativePath)).toEqual([
      'invoice.pdf',
      'Receipts/receipt.txt'
    ])
    expect(inventory.files.every((file) => file.sizeBytes > 0)).toBe(true)
    expect(inventory.folders).toEqual([{ relativePath: 'Receipts', name: 'Receipts' }])
    expect(inventory.skippedSymlinks).toEqual(['outside-link'])
    expect(inventory.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a symbolic link used as the approved root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'steward-root-'))
    temporaryPaths.push(root)
    const linkedRoot = `${root}-link`
    temporaryPaths.push(linkedRoot)
    await symlink(root, linkedRoot)

    await expect(createInventory(await inventorySource(linkedRoot))).rejects.toMatchObject({ code: 'SYMLINK_NOT_ALLOWED' })
  })

  it('changes the fingerprint when a new root session begins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'steward-session-'))
    temporaryPaths.push(root)
    await writeFile(join(root, 'invoice.pdf'), 'metadata only')

    const first = await createInventory(await inventorySource(root, 'first-session'))
    const second = await createInventory(await inventorySource(root, 'second-session'))

    expect(first.fingerprint).not.toBe(second.fingerprint)
  })
})
