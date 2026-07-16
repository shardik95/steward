import type { Action, Plan } from '../../shared/contracts'

type PlanReviewProps = {
  approvals: Record<string, boolean>
  onSetAll: (approved: boolean) => void
  onToggle: (actionId: string) => void
  plan: Plan
}

function ActionCard({ action, approved, onToggle }: { action: Action; approved: boolean; onToggle: () => void }): JSX.Element {
  const title =
    action.type === 'create_folder'
      ? `Create ${action.relativePath}`
      : action.type === 'move_file'
        ? `Move ${action.sourceRelativePath}`
        : 'Review duplicate candidates'

  return (
    <article className="action-card">
      <div className="action-card-header">
        <div>
          <p className="action-type">{action.type.replaceAll('_', ' ')}</p>
          <h3>{title}</h3>
        </div>
        <label className="approval-toggle">
          <input type="checkbox" checked={approved} onChange={onToggle} />
          <span>{approved ? 'Approved' : 'Not approved'}</span>
        </label>
      </div>
      <p>{action.reason}</p>
      {action.type === 'move_file' && (
        <p className="action-detail">Destination: <code>{action.destinationDirectoryRelativePath}/</code></p>
      )}
      {action.type === 'flag_duplicate_candidates' && (
        action.candidateGroups.length > 0 ? (
          <div className="duplicate-groups">
            {action.candidateGroups.map((group) => (
              <div className="duplicate-group" key={group.fileRelativePaths.join('|')}>
                <p><strong>Likely match</strong> · similar filename and size</p>
                <ul>
                  {group.fileRelativePaths.map((path) => <li key={path}><code>{path}</code></li>)}
                </ul>
              </div>
            ))}
          </div>
        ) : <p className="action-detail">No candidate groups were found.</p>
      )}
    </article>
  )
}

function QuestionCard({ prompt, choices }: Plan['questions'][number]): JSX.Element {
  return (
    <article className="question-card">
      <p className="action-type">Question</p>
      <p>{prompt}</p>
      {choices && <p className="question-choices">Options: {choices.join(' · ')}</p>}
    </article>
  )
}

export default function PlanReview({ approvals, onSetAll, onToggle, plan }: PlanReviewProps): JSX.Element {
  const approvedCount = plan.actions.filter((action) => approvals[action.id]).length

  return (
    <section className="plan-review" aria-labelledby="plan-title">
      <div className="plan-heading">
        <div>
          <p className="eyebrow">Proposed plan</p>
          <h2 id="plan-title">Review every item before anything happens.</h2>
        </div>
        <p className="approval-count">{approvedCount} of {plan.actions.length} approved</p>
      </div>
      <p className="plan-summary">{plan.summary}</p>
      <div className="batch-controls">
        <button type="button" className="secondary" onClick={() => onSetAll(true)}>Approve all</button>
        <button type="button" className="secondary" onClick={() => onSetAll(false)}>Reject all</button>
      </div>
      {plan.actions.map((action) => (
        <ActionCard key={action.id} action={action} approved={approvals[action.id] ?? false} onToggle={() => onToggle(action.id)} />
      ))}
      {plan.questions.map((question) => <QuestionCard key={question.id} {...question} />)}
      <p className="review-boundary">Review only: Step 3 cannot create folders, move files, or remove anything.</p>
    </section>
  )
}
