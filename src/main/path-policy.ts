import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Stats } from 'node:fs'

export type PathPolicyErrorCode = 'OUTSIDE_ROOT' | 'SYMLINK_NOT_ALLOWED' | 'ROOT_NOT_DIRECTORY'

export class PathPolicyError extends Error {
  constructor(
    readonly code: PathPolicyErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'PathPolicyError'
  }
}

export type DirectoryIdentity = {
  device: number
  inode: number
}

export function directoryIdentity(stats: Stats): DirectoryIdentity {
  return { device: stats.dev, inode: stats.ino }
}

export function sameDirectory(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode
}

/** Resolves a candidate and rejects it unless it remains at or below the approved root. */
export function resolveWithinRoot(approvedRoot: string, candidatePath: string): string {
  const root = resolve(approvedRoot)
  const candidate = resolve(candidatePath)
  const pathFromRoot = relative(root, candidate)
  const isInsideRoot =
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))

  if (!isInsideRoot) {
    throw new PathPolicyError('OUTSIDE_ROOT', 'The requested path is outside the approved folder.')
  }

  return candidate
}

export function toPortableRelativePath(approvedRoot: string, candidatePath: string): string {
  return relative(resolve(approvedRoot), resolveWithinRoot(approvedRoot, candidatePath)).split(sep).join('/')
}
