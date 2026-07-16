import { describe, expect, it } from 'vitest'
import type { Inventory, Plan } from '../shared/contracts'
import { createDeterministicPlan, PlanValidationError, validatePlan } from './planner'

const inventory: Inventory = {
  fingerprint: 'test-inventory-fingerprint',
  scannedAt: '2026-07-15T00:00:00.000Z',
  folders: [],
  skippedSymlinks: [],
  files: [
    { relativePath: 'Invoice June.pdf', name: 'Invoice June.pdf', extension: '.pdf', sizeBytes: 12, modifiedAt: '2026-07-01T00:00:00.000Z' },
    { relativePath: 'Invoice June (copy).pdf', name: 'Invoice June (copy).pdf', extension: '.pdf', sizeBytes: 12, modifiedAt: '2026-07-01T00:00:00.000Z' },
    { relativePath: 'Steward.dmg', name: 'Steward.dmg', extension: '.dmg', sizeBytes: 40, modifiedAt: '2026-07-02T00:00:00.000Z' }
  ]
}

describe('createDeterministicPlan', () => {
  it('creates folder, move, and duplicate-review actions for the supported objective', () => {
    const plan = createDeterministicPlan(
      'Put invoices in Finance, archive installers, and flag possible duplicate files.',
      inventory
    )

    expect(plan.actions.some((action) => action.type === 'create_folder' && action.relativePath === 'Finance')).toBe(true)
    expect(plan.actions.some((action) => action.type === 'move_file' && action.sourceRelativePath === 'Invoice June.pdf')).toBe(true)
    const duplicates = plan.actions.find((action) => action.type === 'flag_duplicate_candidates')
    expect(duplicates?.candidateGroups).toEqual([
      {
        fileRelativePaths: ['Invoice June (copy).pdf', 'Invoice June.pdf'],
        confidence: 'likely',
        evidence: 'similar_name_and_metadata'
      }
    ])
  })

  it('rejects an unsafe move path during validation', () => {
    const plan: Plan = {
      objective: 'Organize invoices',
      inventoryFingerprint: inventory.fingerprint,
      summary: 'Unsafe test plan',
      questions: [],
      actions: [
        {
          id: 'unsafe-move',
          type: 'move_file',
          sourceRelativePath: '../outside.pdf',
          destinationDirectoryRelativePath: 'Finance',
          reason: 'Test only'
        }
      ]
    }

    expect(() => validatePlan(plan, inventory)).toThrow(PlanValidationError)
  })

  it('does not archive installers when the objective only says archive', () => {
    const plan = createDeterministicPlan('Archive invoices for the year.', inventory)

    expect(plan.actions.some(
      (action) => action.type === 'move_file' && action.sourceRelativePath === 'Steward.dmg'
    )).toBe(false)
  })

  it('rejects plans that move one source file twice', () => {
    const plan: Plan = {
      objective: 'Organize invoices',
      inventoryFingerprint: inventory.fingerprint,
      summary: 'Conflicting test plan',
      questions: [],
      actions: [
        {
          id: 'move-one',
          type: 'move_file',
          sourceRelativePath: 'Invoice June.pdf',
          destinationDirectoryRelativePath: 'Finance',
          reason: 'Test only'
        },
        {
          id: 'move-two',
          type: 'move_file',
          sourceRelativePath: 'Invoice June.pdf',
          destinationDirectoryRelativePath: 'Archive',
          reason: 'Test only'
        }
      ]
    }

    expect(() => validatePlan(plan, inventory)).toThrow('A file can only be moved once in a plan.')
  })
})
