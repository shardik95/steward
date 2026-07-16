import { createHash } from 'node:crypto'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import type { Inventory, InventoryFile, InventoryFolder } from '../shared/contracts'
import {
  directoryIdentity,
  type DirectoryIdentity,
  PathPolicyError,
  resolveWithinRoot,
  sameDirectory,
  toPortableRelativePath
} from './path-policy'

function isHidden(name: string): boolean {
  return name.startsWith('.')
}

type InventorySource = {
  rootPath: string
  sessionId: string
  rootIdentity: DirectoryIdentity
}

type SafeDirectory = {
  path: string
  identity: DirectoryIdentity
}

async function assertDirectory(root: string, directory: string): Promise<SafeDirectory> {
  const safeDirectory = resolveWithinRoot(root, directory)
  const stats = await lstat(safeDirectory)

  if (stats.isSymbolicLink()) {
    throw new PathPolicyError('SYMLINK_NOT_ALLOWED', 'Symbolic links are not traversed.')
  }
  if (!stats.isDirectory()) {
    throw new PathPolicyError('ROOT_NOT_DIRECTORY', 'The approved root must be a directory.')
  }

  const canonicalDirectory = resolveWithinRoot(root, await realpath(safeDirectory))
  const canonicalStats = await lstat(canonicalDirectory)
  if (canonicalStats.isSymbolicLink() || !canonicalStats.isDirectory()) {
    throw new PathPolicyError('SYMLINK_NOT_ALLOWED', 'A directory changed while it was being read.')
  }

  return { path: canonicalDirectory, identity: directoryIdentity(canonicalStats) }
}

/**
 * Reads a directory only after its resolved path remains inside the root, then confirms the same
 * directory identity still exists afterwards. This detects a directory-to-symlink swap and aborts
 * the inventory instead of returning metadata from a changed location.
 */
async function readSafeDirectory(root: string, directory: string): Promise<ReturnType<typeof readdir>> {
  const before = await assertDirectory(root, directory)
  const entries = await readdir(before.path, { withFileTypes: true })
  const after = await assertDirectory(root, directory)

  if (before.path !== after.path || !sameDirectory(before.identity, after.identity)) {
    throw new PathPolicyError('SYMLINK_NOT_ALLOWED', 'A directory changed while it was being read.')
  }

  return entries
}

/**
 * Inventories only filesystem metadata under an approved root. Hidden entries and symlinks are
 * excluded; file contents are never opened or read.
 */
export async function createInventory(source: InventorySource): Promise<Inventory> {
  const selectedRootStats = await lstat(source.rootPath)
  if (selectedRootStats.isSymbolicLink()) {
    throw new PathPolicyError('SYMLINK_NOT_ALLOWED', 'Symbolic links cannot be used as an approved root.')
  }
  if (!selectedRootStats.isDirectory()) {
    throw new PathPolicyError('ROOT_NOT_DIRECTORY', 'The approved root must be a directory.')
  }

  const root = resolve(await realpath(source.rootPath))
  const files: InventoryFile[] = []
  const folders: InventoryFolder[] = []
  const skippedSymlinks: string[] = []

  async function visit(directory: string): Promise<void> {
    const entries = await readSafeDirectory(root, directory)

    for (const entry of entries) {
      if (isHidden(entry.name)) continue

      const candidate = resolveWithinRoot(root, join(directory, entry.name))
      const relativePath = toPortableRelativePath(root, candidate)
      const stats = await lstat(candidate)

      if (stats.isSymbolicLink()) {
        skippedSymlinks.push(relativePath)
        continue
      }

      if (stats.isDirectory()) {
        folders.push({ relativePath, name: basename(candidate) })
        await visit(candidate)
        continue
      }

      if (stats.isFile()) {
        files.push({
          relativePath,
          name: basename(candidate),
          extension: extname(candidate).toLowerCase(),
          sizeBytes: stats.size,
          modifiedAt: stats.mtime.toISOString()
        })
      }
    }
  }

  const rootStats = await assertDirectory(root, root)
  if (!sameDirectory(rootStats.identity, source.rootIdentity)) {
    throw new PathPolicyError('SYMLINK_NOT_ALLOWED', 'The approved folder changed after it was selected.')
  }

  await visit(root)
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  folders.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  skippedSymlinks.sort((left, right) => left.localeCompare(right))

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ sessionId: source.sessionId, files, folders, skippedSymlinks }))
    .digest('hex')

  return { fingerprint, scannedAt: new Date().toISOString(), files, folders, skippedSymlinks }
}
