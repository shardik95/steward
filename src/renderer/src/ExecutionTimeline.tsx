import type { ExecutionOutcome } from '../../shared/contracts'

type ExecutionTimelineProps = {
  isUndoing: boolean
  onUndo: () => void
  outcome: ExecutionOutcome
}

export default function ExecutionTimeline({ isUndoing, onUndo, outcome }: ExecutionTimelineProps): JSX.Element {
  return (
    <section className="execution-timeline" aria-labelledby="execution-title">
      <div className="plan-heading">
        <div>
          <p className="eyebrow">Execution result</p>
          <h2 id="execution-title">Steward verified the completed batch.</h2>
        </div>
        {outcome.canUndo && <button type="button" className="secondary" disabled={isUndoing} onClick={onUndo}>{isUndoing ? 'Undoing…' : 'Undo successful moves'}</button>}
      </div>
      <ol className="timeline-list">
        {outcome.results.map((item) => (
          <li className={`timeline-item ${item.status}`} key={item.actionId}>
            <strong>{item.status}</strong>
            <span>{item.userMessage}</span>
            {item.errorCode && <code>{item.errorCode}</code>}
          </li>
        ))}
      </ol>
      {outcome.verificationError && <p className="error" role="alert">{outcome.verificationError}</p>}
      <p className="review-boundary">Verification used a fresh metadata inventory. No files were overwritten or deleted.</p>
    </section>
  )
}
