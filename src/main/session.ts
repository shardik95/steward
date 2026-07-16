import { randomUUID } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { SelectedFolder } from '../shared/contracts'
import { directoryIdentity, type DirectoryIdentity, PathPolicyError } from './path-policy'

export type ApprovedFolderSession = {
  rootPath: string
  sessionId: string
  rootIdentity: DirectoryIdentity
}

let approvedSession: ApprovedFolderSession | null = null

export async function approveFolder(selectedPath: string): Promise<SelectedFolder> {
  const selectionStats = await lstat(selectedPath)
  if (selectionStats.isSymbolicLink()) {
    throw new PathPolicyError('SYMLINK_NOT_ALLOWED', 'Symbolic links cannot be selected as a folder root.')
  }
  if (!selectionStats.isDirectory()) {
    throw new PathPolicyError('ROOT_NOT_DIRECTORY', 'The selected path is not a folder.')
  }

  const path = resolve(await realpath(selectedPath))
  const rootStats = await lstat(path)
  approvedSession = {
    rootPath: path,
    sessionId: randomUUID(),
    rootIdentity: directoryIdentity(rootStats)
  }
  return { path, name: basename(path) || path }
}

export function getApprovedSession(): ApprovedFolderSession {
  if (!approvedSession) throw new Error('Choose a folder before requesting an inventory.')
  return approvedSession
}
