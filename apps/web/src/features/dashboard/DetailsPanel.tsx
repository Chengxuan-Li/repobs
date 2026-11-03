import { useEffect, useMemo, useState } from 'react'
import {
  type AgentSession,
  type AnnotationSummary,
  type AutomationApplication,
  type BranchClassification,
  CONFIDENCE_LABELS,
  DETAIL_LABELS,
  type Snapshot,
  type Worktree,
} from '@repobs/contracts'
import { api } from '../../app/api'
import { AnnotationEditor } from '../annotations/AnnotationEditor'
import { type ChecklistEntry, checklistEntries, PLAN_SOURCE_LABELS } from './checklistEntries'
import { entryNote, useOptimisticTicks } from './ChecklistPill'
import { Badge, CopyButton, formatAge, formatTime, InlineAlert, shortOid, StatusIndicator } from '../../components/primitives'
import type { BranchRow } from './layout'
import { ActivitySummary } from './ActivityTrack'
import { useActivity } from './useActivity'
import styles from './dashboard.module.css'

// Right side panel: details of the selected agent (evidence + your notes) or branch row.

export const CLASSIFICATION_LABELS: Record<BranchClassification, string> = {
  checked_out: 'Checked out',
  local_tracking: 'Local, tracks an upstream',
  local_only: 'Local only (never pushed)',
  remote_tracking: 'Remote-tracking (has a local branch)',
  remote_only: 'Remote only',
}

export function WorktreeStatusText({ worktree }: { worktree: Worktree }) {
  const s = worktree.status
  if (worktree.missing) return <Badge tone="danger">directory missing</Badge>
  if (s.state === 'pending') return <span className="muted">scanning…</span>
  if (s.state === 'error') return <Badge tone="danger">{s.error?.message ?? 'status error'}</Badge>
  if (s.state === 'unavailable') return <span className="muted">unavailable</span>
  const parts = [
    s.staged && `${s.staged} staged`,
    s.unstaged && `${s.unstaged} unstaged`,
    s.untracked && `${s.untracked} untracked`,
    s.conflicted && `${s.conflicted} conflicted`,
  ].filter(Boolean)
  return (
    <span>
      {s.gitOperation ? <Badge tone="warning">{s.gitOperation.replace('_', '-')} in progress</Badge> : null} {parts.length ? parts.join(', ') : <span className="muted">clean</span>}
    </span>
  )
}

/** Automation rules that changed this agent's annotation (the source of an automatic review state, tag or checklist item). */
function AutomationHistory({ sessionId, changeKey, now }: { sessionId: string; changeKey?: string; now: number }) {
  const [list, setList] = useState<AutomationApplication[]>([])
  useEffect(() => {
    let cancelled = false
    api<AutomationApplication[]>('GET', `/sessions/${encodeURIComponent(sessionId)}/automation`).then(
      (l) => !cancelled && setList(l),
      () => !cancelled && setList([]),
    )
    return () => {
      cancelled = true
    }
  }, [sessionId, changeKey])
  if (!list.length) return null
  return (
    <p className="small muted">
      Automation applied: {list.map((a) => `“${a.ruleName}” ${formatAge(a.appliedAt, now)} ago`).join('; ')}. Your edits after that are kept.
    </p>
  )
}

/** The agent's own plan (ADR 0009): its steps as it reports them; your ticks override them in repobs only. */
function AgentPlanSection({
  session,
  annotation,
  now,
  onChecklist,
}: {
  session: AgentSession
  annotation?: AnnotationSummary
  now: number
  onChecklist: (sessionId: string, entry: ChecklistEntry, done: boolean) => Promise<boolean>
}) {
  const plan = session.plan
  const [shown, toggle] = useOptimisticTicks(
    checklistEntries(session, annotation).filter((e) => e.section === 'agent'),
    (entry, done) => onChecklist(session.id, entry, done),
  )
  if (!plan) return null
  return (
    <section className={styles.detailsSection} aria-label="Agent plan">
      <div className="label">Agent plan</div>
      <p className="small muted">
        {PLAN_SOURCE_LABELS[plan.source]}
        {plan.updatedAt ? `, updated ${formatAge(plan.updatedAt, now)} ago` : ''}. Reported by the agent; your ticks stay in repobs.
      </p>
      <ul className={styles.planList}>
        {shown.map((e) => (
          <li key={e.id}>
            <label>
              <input type="checkbox" checked={e.done} onChange={(ev) => toggle(e, ev.target.checked)} />
              <span className={e.done ? styles.planDone : undefined}>{e.text}</span>
              {entryNote(e) ? <span className="small muted">{entryNote(e)}</span> : null}
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function SessionDetails({
  snapshot,
  session,
  now,
  knownTags,
  onSelect,
  onChecklist,
}: {
  snapshot: Snapshot
  session: AgentSession
  now: number
  knownTags: string[]
  onSelect: (rowId: string) => void
  onChecklist: (sessionId: string, entry: ChecklistEntry, done: boolean) => Promise<boolean>
}) {
  const worktree = snapshot.worktrees.find((w) => w.id === session.worktreeId)
  const inFolder = snapshot.repositories.find((r) => r.id === session.repoId)?.kind === 'folder'
  const parent = session.parentSessionId ? snapshot.sessions.find((s) => s.id === session.parentSessionId) : undefined
  const children = snapshot.sessions.filter((s) => s.parentSessionId === session.id)
  const st = session.state
  const sessions = useMemo(() => [session], [session])
  const activity = useActivity(sessions, true).get(session.id)
  return (
    <div className={styles.details}>
      <header>
        <h2 className={styles.detailsTitle}>{session.title}</h2>
        <p className="small muted">
          {session.provider === 'claude' ? 'Claude Code' : 'Codex'} {session.parentSessionId ? `${session.agentType ?? 'sub-agent'} spawned by another agent` : 'session'}
          {session.historical ? ' · historical' : ''}
        </p>
      </header>
      {!session.sourceAvailable ? <InlineAlert tone="warning">The provider's session file no longer exists. Your notes are kept; the live status is unknown.</InlineAlert> : null}
      {session.association === 'unassigned' ? (
        <InlineAlert tone="info">Not associated with a current worktree ({session.unassignedReason?.replace(/_/g, ' ')}).</InlineAlert>
      ) : null}
      <section className={styles.detailsSection}>
        <StatusIndicator state={st} />
        <dl className="facts">
          <dt>Evidence</dt>
          <dd>{CONFIDENCE_LABELS[st.confidence]}</dd>
          <dt>Reason</dt>
          <dd>{st.detail ? DETAIL_LABELS[st.detail] : '—'}</dd>
          <dt>Evidence time</dt>
          <dd>
            {formatTime(st.observedAt)} {st.observedAt ? <span className="muted">({formatAge(st.observedAt, now)} ago)</span> : null}
          </dd>
          <dt>Source</dt>
          <dd className="mono">{st.source}</dd>
        </dl>
        {session.lastMessage ? (
          <div>
            <div className="label">Latest {session.lastMessage.kind === 'tool' ? 'tool activity' : 'agent message'}</div>
            <p className={styles.excerptFull}>{session.lastMessage.text}</p>
            <p className="small muted">Excerpt read from the provider's session file; truncated, secrets redacted, not stored.</p>
          </div>
        ) : null}
      </section>
      {activity ? (
        <section className={styles.detailsSection}>
          <div className="label">Activity</div>
          <dl className="facts">
            <ActivitySummary activity={activity} />
          </dl>
          <p className="small muted">Counted from the provider's session file: tool names, command verbs, times and token counts only; nothing stored.</p>
        </section>
      ) : null}
      <AgentPlanSection session={session} annotation={snapshot.annotations.find((a) => a.sessionId === session.id)} now={now} onChecklist={onChecklist} />
      <section className={styles.detailsSection}>
        <div className="label">Your notes</div>
        <AnnotationEditor key={session.id} session={session} summary={snapshot.annotations.find((a) => a.sessionId === session.id)} knownTags={knownTags} />
        <AutomationHistory sessionId={session.id} changeKey={snapshot.annotations.find((a) => a.sessionId === session.id)?.updatedAt} now={now} />
      </section>
      <section className={styles.detailsSection}>
        <div className="label">Identification</div>
        <dl className="facts">
          <dt>Session ID</dt>
          <dd className="mono">
            {session.providerSessionId} <CopyButton value={session.providerSessionId} label="Copy session ID" />
          </dd>
          {parent ? (
            <>
              <dt>Spawned by</dt>
              <dd>
                <button type="button" className={styles.link} onClick={() => onSelect(`session:${parent.id}`)}>
                  {parent.title}
                </button>
              </dd>
            </>
          ) : null}
          {children.length ? (
            <>
              <dt>Spawned</dt>
              <dd>{children.length} agents</dd>
            </>
          ) : null}
          <dt>{inFolder ? 'Folder' : 'Worktree'}</dt>
          <dd className="mono">{worktree?.path ?? 'unassigned'}</dd>
          <dt>Working directory</dt>
          <dd className="mono">{session.observedCwd ?? '—'}</dd>
          <dt>Branch at session time</dt>
          <dd className="mono">{session.recordedBranch ?? '—'}</dd>
          <dt>First activity</dt>
          <dd>{formatTime(session.firstSeenAt)}</dd>
          <dt>Last activity</dt>
          <dd>{formatTime(session.lastActivityAt)}</dd>
          <dt>Provider version</dt>
          <dd className="mono">{session.providerVersion ?? '—'}</dd>
        </dl>
      </section>
    </div>
  )
}

export function BranchDetails({ snapshot, row }: { snapshot: Snapshot; row: BranchRow }) {
  const b = row.branch
  const prs = b ? snapshot.pullRequests.filter((p) => p.repoId === b.repoId && p.headRef === (b.upstream?.fullRef.replace(/^refs\/remotes\/[^/]+\//, '') ?? b.shortName)) : []
  return (
    <div className={styles.details}>
      <header>
        <h2 className={`${styles.detailsTitle} mono`}>{row.label}</h2>
        <p className="small muted">{b ? CLASSIFICATION_LABELS[b.classification] : 'Detached HEAD'}</p>
      </header>
      <dl className="facts">
        {b ? (
          <>
            <dt>Full ref</dt>
            <dd className="mono">{b.fullRef}</dd>
            <dt>Tip</dt>
            <dd className="mono">{b.unborn ? 'unborn (no commits yet)' : shortOid(b.tipOid)}</dd>
          </>
        ) : null}
        {b?.kind === 'local' ? (
          <>
            <dt>Upstream</dt>
            <dd className="mono">{b.upstream ? `${b.upstream.fullRef.replace('refs/remotes/', '')}${b.upstream.gone ? ' (gone)' : ''}` : 'none'}</dd>
            <dt>Ahead / behind</dt>
            <dd className="mono">{b.upstream && !b.upstream.gone ? `↑${b.upstream.ahead ?? 0} ↓${b.upstream.behind ?? 0}` : '—'}</dd>
          </>
        ) : null}
      </dl>
      {row.worktrees.map((w) => (
        <section key={w.id} className={styles.detailsSection}>
          <div className="label">Worktree</div>
          <p className="mono small">
            {w.path} <CopyButton value={w.path} label="Copy worktree path" />
          </p>
          <WorktreeStatusText worktree={w} />
          <dl className="facts">
            <dt>HEAD</dt>
            <dd className="mono">{shortOid(w.headOid)}</dd>
            <dt>Kind</dt>
            <dd>
              {w.isPrimary ? 'Primary' : 'Linked'}
              {w.locked ? ' · locked' : ''}
              {w.prunable ? ' · prunable' : ''}
            </dd>
            <dt>Status read</dt>
            <dd>{formatTime(w.lastStatusAt)}</dd>
          </dl>
        </section>
      ))}
      {prs.length ? (
        <section className={styles.detailsSection}>
          <div className="label">Pull requests (remote metadata)</div>
          {prs.map((p) => (
            <p key={p.id} className="small">
              <a href={p.url} target="_blank" rel="noreferrer noopener">
                #{p.number} {p.title}
              </a>{' '}
              <span className="muted">
                → {p.baseRef} · fetched {formatTime(p.fetchedAt)}
              </span>
            </p>
          ))}
        </section>
      ) : null}
      <p className="small muted">
        Graph legend: filled nodes are on a remote-tracking ref; hollow amber nodes and dashed edges exist only locally; grey dashed nodes are on the upstream but not
        pulled; the dashed diamond after a head is uncommitted work (red when conflicted). Remote refs reflect your last fetch — repobs never fetches.
      </p>
    </div>
  )
}
