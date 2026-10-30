import type { ReactNode } from 'react'
import {
  type AgentSession,
  type AnnotationSummary,
  type BranchClassification,
  type BranchRef,
  DETAIL_LABELS,
  isLiveKind,
  type PullRequest,
  type PullRequestStatus,
  type Repository,
  REVIEW_LABELS,
  REVIEW_TONES,
  sessionNeedsAttention,
  type Snapshot,
  type Worktree,
  worktreeNeedsAttention,
} from '@repobs/contracts'
import { Badge, CopyButton, formatAge, formatTime, InlineAlert, shortOid, StatusIndicator, useNow } from '../../components/primitives'
import { nodeId } from '../repository-tree/buildTree'
import styles from './views.module.css'

// Center-pane views. Everything shown is local Git metadata or structural session metadata; no
// transcript content exists in the client.

type Select = (id: string) => void

export const CLASSIFICATION_LABELS: Record<BranchClassification, string> = {
  checked_out: 'Checked out',
  local_tracking: 'Local, tracks upstream',
  local_only: 'Local only',
  remote_tracking: 'Remote-tracking (has local branch)',
  remote_only: 'Remote only',
}

function Pane({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.pane}>
      <div className="section-strip">
        <span className="label">{title}</span>
        {note ? <span className="small muted">{note}</span> : null}
      </div>
      <div className={styles.paneBody}>{children}</div>
    </section>
  )
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
    <span className={styles.inline}>
      {s.gitOperation ? <Badge tone="warning">{s.gitOperation.replace('_', '-')} in progress</Badge> : null}
      {parts.length ? <span>{parts.join(', ')}</span> : <span className="muted">clean</span>}
    </span>
  )
}

function SessionTable({ sessions, annotations, onSelect }: { sessions: AgentSession[]; annotations: Map<string, AnnotationSummary>; onSelect: Select }) {
  const now = useNow()
  if (!sessions.length) return <p className="muted small">No sessions observed.</p>
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Session</th>
          <th>Provider</th>
          <th>Observed state</th>
          <th>Review</th>
          <th>Last activity</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((s) => {
          const a = annotations.get(s.id)
          return (
            <tr key={s.id} className="clickable" onClick={() => onSelect(nodeId.session(s.id))}>
              <td>
                <button type="button" className={styles.link} onClick={() => onSelect(nodeId.session(s.id))}>
                  {a?.displayAlias || s.title}
                </button>
                {s.historical ? <span className="muted small"> · historical</span> : null}
              </td>
              <td>{s.provider === 'claude' ? 'Claude Code' : 'Codex'}</td>
              <td>
                <StatusIndicator state={s.state} />
              </td>
              <td>{a && a.review !== 'unreviewed' ? <Badge tone={REVIEW_TONES[a.review]}>{REVIEW_LABELS[a.review]}</Badge> : <span className="muted">—</span>}</td>
              <td className="mono">{formatAge(s.lastActivityAt, now)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function Overview({ snapshot, onSelect, onAddRepository }: { snapshot: Snapshot; onSelect: Select; onAddRepository: () => void }) {
  const annotations = new Map(snapshot.annotations.map((a) => [a.sessionId, a]))
  const sessions = snapshot.sessions.filter((s) => sessionNeedsAttention(s, annotations.get(s.id)))
  const worktrees = snapshot.worktrees.filter(worktreeNeedsAttention)
  const repoName = new Map(snapshot.repositories.map((r) => [r.id, r.displayName]))
  const branchName = (w: Worktree) => (w.detached ? 'detached HEAD' : (w.branchFullRef?.replace('refs/heads/', '') ?? '—'))
  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h1 className={styles.title}>Overview</h1>
        <p className="muted small">
          {snapshot.repositories.length} repositories · {snapshot.worktrees.length} worktrees · {snapshot.sessions.length} sessions in registered repositories
        </p>
      </header>
      <Pane title="Attention queue" note={`${sessions.length + worktrees.length} items`}>
        {sessions.length + worktrees.length === 0 ? (
          <p className="muted small">Nothing needs attention: no approval or input requests recorded, no flagged reviews, no conflicts or interrupted Git operations.</p>
        ) : (
          <>
            {worktrees.length ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Worktree</th>
                    <th>Repository</th>
                    <th>Branch</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {worktrees.map((w) => (
                    <tr key={w.id} className="clickable" onClick={() => onSelect(nodeId.worktree(w.id))}>
                      <td className="mono">
                        <button type="button" className={styles.link} onClick={() => onSelect(nodeId.worktree(w.id))}>
                          {w.displayName}
                        </button>
                      </td>
                      <td>{repoName.get(w.repoId)}</td>
                      <td className="mono">{branchName(w)}</td>
                      <td>
                        <WorktreeStatusText worktree={w} />
                        {w.prunable ? <Badge tone="warning">prunable</Badge> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {sessions.length ? <SessionTable sessions={sessions} annotations={annotations} onSelect={onSelect} /> : null}
          </>
        )}
      </Pane>
      <Pane title="Worktrees" note="All registered repositories">
        {snapshot.worktrees.length === 0 ? (
          <div className="small">
            <p className="muted">No repositories registered yet.</p>
            <button type="button" className="btn btn-primary" onClick={onAddRepository}>
              Add repository
            </button>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Worktree</th>
                <th>Repository</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Sessions</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.worktrees.map((w) => {
                const ws = snapshot.sessions.filter((s) => s.worktreeId === w.id)
                const live = ws.filter((s) => isLiveKind(s.state.kind)).length
                return (
                  <tr key={w.id} className="clickable" onClick={() => onSelect(nodeId.worktree(w.id))}>
                    <td className="mono" title={w.path}>
                      {w.displayName}
                    </td>
                    <td>{repoName.get(w.repoId)}</td>
                    <td className="mono">{branchName(w)}</td>
                    <td>
                      <WorktreeStatusText worktree={w} />
                    </td>
                    <td className="mono">
                      {ws.length}
                      {live ? <span className="muted"> ({live} active)</span> : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Pane>
    </div>
  )
}

export function RepositoryView({ snapshot, repo, onSelect }: { snapshot: Snapshot; repo: Repository; onSelect: Select }) {
  const branches = snapshot.branches.filter((b) => b.repoId === repo.id)
  const worktrees = snapshot.worktrees.filter((w) => w.repoId === repo.id)
  const prStatus = snapshot.pullRequestStatus.find((p) => p.repoId === repo.id)
  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h1 className={styles.title}>{repo.displayName}</h1>
        <p className="mono small muted">{repo.primaryPath}</p>
      </header>
      {repo.scanState === 'error' ? (
        <InlineAlert tone="danger">
          Last scan failed: {repo.error?.message}. Previously known data is shown; repobs keeps retrying.
        </InlineAlert>
      ) : null}
      {repo.isBare ? <InlineAlert tone="info">Bare repository: it has no primary working tree; only linked worktrees and refs are shown.</InlineAlert> : null}
      <PullRequestNote status={prStatus} />
      <Pane title="Worktrees" note={`${worktrees.length}`}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Path</th>
              <th>Branch</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {worktrees.map((w) => (
              <tr key={w.id} className="clickable" onClick={() => onSelect(nodeId.worktree(w.id))}>
                <td className="mono">{w.path}</td>
                <td className="mono">{w.detached ? 'detached HEAD' : w.branchFullRef?.replace('refs/heads/', '')}</td>
                <td>
                  <WorktreeStatusText worktree={w} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Pane>
      <Pane title="Branches and remote refs" note="Remote refs are the locally cached state; repobs never fetches">
        <table className="data-table">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Kind</th>
              <th>Upstream</th>
              <th>Ahead / behind</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id} className="clickable" onClick={() => onSelect(nodeId.branch(b.id))}>
                <td className="mono">{b.shortName}</td>
                <td>{CLASSIFICATION_LABELS[b.classification]}</td>
                <td className="mono">{upstreamText(b)}</td>
                <td className="mono">{aheadBehind(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Pane>
      <dl className="facts">
        <dt>Common Git directory</dt>
        <dd className="mono">{repo.commonGitDir}</dd>
        <dt>Registered from</dt>
        <dd className="mono">{repo.registeredPath}</dd>
        <dt>Last successful scan</dt>
        <dd>{formatTime(repo.lastSuccessfulScanAt)}</dd>
      </dl>
    </div>
  )
}

function upstreamText(b: BranchRef) {
  if (!b.upstream) return b.kind === 'local' ? '—' : ''
  return `${b.upstream.fullRef.replace('refs/remotes/', '')}${b.upstream.gone ? ' (gone)' : ''}`
}

function aheadBehind(b: BranchRef) {
  if (!b.upstream || b.upstream.gone) return ''
  return `↑${b.upstream.ahead ?? 0} ↓${b.upstream.behind ?? 0}`
}

function PullRequestNote({ status }: { status?: PullRequestStatus }) {
  if (!status) return null
  if (status.state === 'error') return <InlineAlert tone="warning">Pull request lookup failed: {status.error?.message}. Last data may be stale.</InlineAlert>
  if (status.state === 'no_github_remote') return <InlineAlert tone="info">No GitHub remote found; pull request lookup does not apply.</InlineAlert>
  return null
}

export function BranchInspector({ snapshot, branch, onSelect }: { snapshot: Snapshot; branch: BranchRef; onSelect: Select }) {
  const worktrees = snapshot.worktrees.filter((w) => branch.worktreeIds.includes(w.id))
  const tracking = snapshot.branches.filter((b) => branch.trackedByIds.includes(b.id))
  const remoteShort = branch.upstream?.fullRef.replace(/^refs\/remotes\/[^/]+\//, '')
  const prs: PullRequest[] = snapshot.pullRequests.filter(
    (p) => p.repoId === branch.repoId && (p.headRef === (branch.kind === 'local' ? (remoteShort ?? branch.shortName) : branch.shortName.split('/').slice(1).join('/'))),
  )
  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h1 className={`${styles.title} mono`}>{branch.shortName}</h1>
        <p className="small muted">{CLASSIFICATION_LABELS[branch.classification]}</p>
      </header>
      <dl className="facts">
        <dt>Full ref</dt>
        <dd className="mono">{branch.fullRef}</dd>
        <dt>Tip</dt>
        <dd className="mono">{branch.unborn ? 'unborn (no commits yet)' : shortOid(branch.tipOid)}</dd>
        {branch.kind === 'local' ? (
          <>
            <dt>Configured upstream</dt>
            <dd className="mono">{branch.upstream ? upstreamText(branch) : 'none (local-only branch)'}</dd>
            <dt>Ahead / behind</dt>
            <dd className="mono">{branch.upstream && !branch.upstream.gone ? aheadBehind(branch) : '—'}</dd>
          </>
        ) : (
          <>
            <dt>Tracked by</dt>
            <dd className="mono">{tracking.length ? tracking.map((b) => b.shortName).join(', ') : 'no local branch'}</dd>
          </>
        )}
      </dl>
      <p className="small muted">Remote-tracking refs reflect the last fetch done by you or your tools; repobs never contacts remotes for Git data.</p>
      {branch.kind === 'local' ? (
        <Pane title="Worktrees" note={`${worktrees.length}`}>
          {worktrees.length === 0 ? (
            <p className="muted small">Not checked out in any worktree.</p>
          ) : (
            <ul className={styles.list}>
              {worktrees.map((w) => (
                <li key={w.id}>
                  <button type="button" className={`${styles.link} mono`} onClick={() => onSelect(nodeId.worktree(w.id))}>
                    {w.path}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {worktrees.length > 1 ? <InlineAlert tone="warning">This branch is checked out in more than one worktree (forced checkout).</InlineAlert> : null}
        </Pane>
      ) : null}
      {prs.length ? (
        <Pane title="Pull requests" note="Remote metadata via GitHub CLI">
          <ul className={styles.list}>
            {prs.map((p) => (
              <li key={p.id}>
                <a href={p.url} target="_blank" rel="noreferrer noopener">
                  #{p.number} {p.title}
                </a>{' '}
                <span className="mono small muted">
                  {p.headRef} → {p.baseRef}
                  {p.isDraft ? ' · draft' : ''} · fetched {formatTime(p.fetchedAt)}
                </span>
              </li>
            ))}
          </ul>
        </Pane>
      ) : null}
    </div>
  )
}

export function WorktreeInspector({ snapshot, worktree, onSelect }: { snapshot: Snapshot; worktree: Worktree; onSelect: Select }) {
  const sessions = snapshot.sessions.filter((s) => s.worktreeId === worktree.id)
  const annotations = new Map(snapshot.annotations.map((a) => [a.sessionId, a]))
  const s = worktree.status
  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h1 className={`${styles.title} mono`}>{worktree.displayName}</h1>
        <p className="mono small muted">
          {worktree.path} <CopyButton value={worktree.path} label="Copy worktree path" />
        </p>
      </header>
      {worktree.missing ? <InlineAlert tone="danger">Git still lists this worktree, but its directory no longer exists (prunable).</InlineAlert> : null}
      <dl className="facts">
        <dt>HEAD</dt>
        <dd className="mono">
          {worktree.detached ? `detached at ${shortOid(worktree.headOid)}` : `${worktree.branchFullRef ?? '—'} @ ${shortOid(worktree.headOid)}`}
        </dd>
        <dt>Status</dt>
        <dd>
          <WorktreeStatusText worktree={worktree} />
        </dd>
        <dt>Counts</dt>
        <dd className="mono">
          staged {s.staged} · unstaged {s.unstaged} · untracked {s.untracked} · conflicted {s.conflicted}
        </dd>
        <dt>Upstream</dt>
        <dd className="mono">{s.ahead !== undefined ? `↑${s.ahead} ↓${s.behind ?? 0}` : 'no upstream'}</dd>
        <dt>Kind</dt>
        <dd>
          {worktree.isPrimary ? 'Primary worktree' : 'Linked worktree'}
          {worktree.locked ? ` · locked${worktree.lockReason ? ` (${worktree.lockReason})` : ''}` : ''}
          {worktree.prunable ? ` · prunable${worktree.prunableReason ? ` (${worktree.prunableReason})` : ''}` : ''}
        </dd>
        <dt>Status read</dt>
        <dd>{formatTime(worktree.lastStatusAt)}</dd>
      </dl>
      <Pane title="Sessions" note={`${sessions.length} observed`}>
        <SessionTable sessions={sessions} annotations={annotations} onSelect={onSelect} />
      </Pane>
    </div>
  )
}

export function SessionInspector({ snapshot, session, onSelect }: { snapshot: Snapshot; session: AgentSession; onSelect: Select }) {
  const now = useNow(10_000)
  const worktree = snapshot.worktrees.find((w) => w.id === session.worktreeId)
  const repo = snapshot.repositories.find((r) => r.id === session.repoId)
  const st = session.state
  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h1 className={styles.title}>{session.title}</h1>
        <p className="small muted">
          {session.provider === 'claude' ? 'Claude Code' : 'Codex'} session ·{' '}
          {session.titleSource === 'fallback' ? 'no provider title (fallback name)' : 'title from provider metadata'}
        </p>
      </header>
      {!session.sourceAvailable ? (
        <InlineAlert tone="warning">The provider's session file no longer exists. Your annotations are kept; the live status is unknown.</InlineAlert>
      ) : null}
      {session.association === 'unassigned' ? (
        <InlineAlert tone="info">
          Not associated with a current worktree ({session.unassignedReason?.replace(/_/g, ' ')}). repobs does not guess associations.
        </InlineAlert>
      ) : null}
      <Pane title="Observed execution state" note="Independent of your review state">
        <div className={styles.stateLine}>
          <StatusIndicator state={st} />
        </div>
        <dl className="facts">
          <dt>Evidence</dt>
          <dd>{st.confidence === 'direct' ? 'Direct — reported by the provider' : st.confidence === 'inferred' ? 'Inferred from local session records' : 'Unknown — not enough evidence'}</dd>
          <dt>Reason</dt>
          <dd>{st.detail ? DETAIL_LABELS[st.detail] : '—'}</dd>
          {st.possiblyAwaitingApproval ? (
            <>
              <dt>Note</dt>
              <dd>A tool call is pending. It may be executing or waiting for your permission; local records cannot tell which.</dd>
            </>
          ) : null}
          <dt>Source</dt>
          <dd className="mono">{st.source}</dd>
          <dt>Evidence time</dt>
          <dd>
            {formatTime(st.observedAt)} {st.observedAt ? <span className="muted">({formatAge(st.observedAt, now)} ago)</span> : null}
          </dd>
          <dt>Latest activity</dt>
          <dd>{session.activityLabel ?? '—'}</dd>
          <dt>Subagents</dt>
          <dd>{session.subagents.total ? `${session.subagents.active} active of ${session.subagents.total}` : 'none recorded'}</dd>
        </dl>
      </Pane>
      <Pane title="Identification">
        <dl className="facts">
          <dt>Session ID</dt>
          <dd className="mono">
            {session.providerSessionId} <CopyButton value={session.providerSessionId} label="Copy session ID" />
          </dd>
          <dt>Repository</dt>
          <dd>{repo ? <button type="button" className={styles.link} onClick={() => onSelect(nodeId.repo(repo.id))}>{repo.displayName}</button> : '—'}</dd>
          <dt>Worktree</dt>
          <dd className="mono">
            {worktree ? (
              <button type="button" className={`${styles.link} mono`} onClick={() => onSelect(nodeId.worktree(worktree.id))}>
                {worktree.path}
              </button>
            ) : (
              'unassigned'
            )}
          </dd>
          <dt>Working directory</dt>
          <dd className="mono">{session.observedCwd ?? '—'}</dd>
          <dt>Branch at session time</dt>
          <dd className="mono">
            {session.recordedBranch ?? '—'} <span className="muted small">(recorded by the provider; not necessarily today's checkout)</span>
          </dd>
          <dt>First activity</dt>
          <dd>{formatTime(session.firstSeenAt)}</dd>
          <dt>Last activity</dt>
          <dd>
            {formatTime(session.lastActivityAt)}
            {session.historical ? <span className="muted"> · historical</span> : null}
          </dd>
          <dt>Provider version</dt>
          <dd className="mono">{session.providerVersion ?? '—'}</dd>
        </dl>
      </Pane>
    </div>
  )
}
