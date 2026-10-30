import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { type AgentSession, type AnnotationInput, type AnnotationSummary, LIMITS, REVIEW_LABELS, type ReviewState, type SessionAnnotation } from '@repobs/contracts'
import { api, ApiError } from '../../app/api'
import { InlineAlert } from '../../components/primitives'
import { Checklist, type DraftItem } from './Checklist'
import styles from './annotations.module.css'

// Human-owned notes for one session. Saved automatically (debounced) to the local repobs
// database only — never to Git, transcripts, prompts or any remote service.

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: string } | { kind: 'error'; message: string }

interface Draft {
  displayAlias: string
  review: ReviewState
  tags: string[]
  note: string
  checklist: DraftItem[]
}

const EMPTY: Draft = { displayAlias: '', review: 'unreviewed', tags: [], note: '', checklist: [] }

function toDraft(a: SessionAnnotation | null): Draft {
  return a ? { displayAlias: a.displayAlias ?? '', review: a.review, tags: a.tags, note: a.note, checklist: a.checklist } : EMPTY
}

export function AnnotationEditor({ session, summary }: { session: AgentSession; summary?: AnnotationSummary }) {
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [tagText, setTagText] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const pending = useRef<Draft | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastSavedAt = useRef<string | undefined>(undefined)
  const sessionId = session.id
  const ids = { alias: useId(), note: useId(), tags: useId() }

  const flush = useCallback(
    async (id: string) => {
      const d = pending.current
      if (!d) return
      pending.current = undefined
      clearTimeout(timer.current)
      setSave({ kind: 'saving' })
      const body: AnnotationInput = {
        displayAlias: d.displayAlias.trim() || undefined,
        review: d.review,
        tags: d.tags,
        note: d.note,
        checklist: d.checklist,
      }
      try {
        const res = await api<{ annotation: SessionAnnotation }>('PUT', `/sessions/${encodeURIComponent(id)}/annotation`, body)
        lastSavedAt.current = res.annotation.updatedAt
        setSave({ kind: 'saved', at: res.annotation.updatedAt })
      } catch (err) {
        pending.current = pending.current ?? d
        setSave({ kind: 'error', message: err instanceof ApiError ? err.message : 'Save failed' })
      }
    },
    [],
  )

  // Load once per session (the inspector keys this component by session id); flush unsaved edits on unmount.
  useEffect(() => {
    let cancelled = false
    api<{ annotation: SessionAnnotation | null }>('GET', `/sessions/${encodeURIComponent(sessionId)}/annotation`)
      .then((res) => {
        if (cancelled) return
        setDraft(toDraft(res.annotation))
        lastSavedAt.current = res.annotation?.updatedAt
        setLoaded(true)
      })
      .catch((err: unknown) => !cancelled && setLoadError(err instanceof ApiError ? err.message : 'Could not load annotations'))
    return () => {
      cancelled = true
      void flush(sessionId)
    }
  }, [sessionId, flush])

  // Another tab or an import changed this annotation: reload when we have no unsaved edits.
  useEffect(() => {
    if (!loaded || pending.current || !summary || summary.updatedAt === lastSavedAt.current) return
    api<{ annotation: SessionAnnotation | null }>('GET', `/sessions/${encodeURIComponent(sessionId)}/annotation`)
      .then((res) => {
        if (pending.current) return
        setDraft(toDraft(res.annotation))
        lastSavedAt.current = res.annotation?.updatedAt
      })
      .catch(() => undefined)
  }, [summary, loaded, sessionId])

  const update = (patch: Partial<Draft>, immediate = false) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch }
      pending.current = next
      return next
    })
    setSave({ kind: 'saving' })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(sessionId), immediate ? 0 : 700)
  }

  const addTag = () => {
    const t = tagText.trim().slice(0, LIMITS.tagChars)
    if (!t || draft.tags.includes(t) || draft.tags.length >= LIMITS.tags) return
    update({ tags: [...draft.tags, t] }, true)
    setTagText('')
  }

  if (loadError) return <InlineAlert tone="danger">{loadError}</InlineAlert>
  if (!loaded) return <p className="muted small">Loading annotations…</p>

  return (
    <div className={styles.editor}>
      <p className="small muted">Your notes are stored only in the local repobs database. They are never written to Git, sent to agents, or published.</p>
      <div className={styles.field}>
        <span className="label" id={`${ids.alias}-l`}>
          Review state
        </span>
        <div className={styles.segmented} role="radiogroup" aria-labelledby={`${ids.alias}-l`}>
          {(Object.keys(REVIEW_LABELS) as ReviewState[]).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={draft.review === r}
              className={`${styles.segment} ${draft.review === r ? styles.segmentOn : ''}`}
              onClick={() => update({ review: r }, true)}
            >
              {REVIEW_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.field}>
        <label className="label" htmlFor={ids.alias}>
          Display alias
        </label>
        <input
          id={ids.alias}
          className="input"
          value={draft.displayAlias}
          maxLength={LIMITS.aliasChars}
          placeholder={session.title}
          onChange={(e) => update({ displayAlias: e.target.value })}
        />
      </div>
      <div className={styles.field}>
        <label className="label" htmlFor={ids.tags}>
          Tags
        </label>
        <div className={styles.tags}>
          {draft.tags.map((t) => (
            <span key={t} className={styles.tag}>
              {t}
              <button type="button" className={styles.tagRemove} onClick={() => update({ tags: draft.tags.filter((x) => x !== t) }, true)} aria-label={`Remove tag ${t}`}>
                <X size={11} />
              </button>
            </span>
          ))}
          <input
            id={ids.tags}
            className={`input ${styles.tagInput}`}
            value={tagText}
            placeholder="Add tag, Enter"
            maxLength={LIMITS.tagChars}
            onChange={(e) => setTagText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                addTag()
              }
            }}
            onBlur={addTag}
          />
        </div>
      </div>
      <div className={styles.field}>
        <label className="label" htmlFor={ids.note}>
          Scratch note
        </label>
        <textarea
          id={ids.note}
          className="input"
          rows={7}
          value={draft.note}
          maxLength={LIMITS.noteChars}
          placeholder="Plain text. What do you still need to check?"
          onChange={(e) => update({ note: e.target.value })}
        />
      </div>
      <div className={styles.field}>
        <span className="label">Checklist</span>
        <Checklist items={draft.checklist} onChange={(checklist) => update({ checklist }, true)} />
      </div>
      <div className={styles.saveRow} aria-live="polite">
        <SaveIndicator state={save} onRetry={() => void flush(sessionId)} />
        {confirmClear ? (
          <span className={styles.confirm}>
            Delete all notes, tags and checklist for this session?
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setConfirmClear(false)
                pending.current = undefined
                clearTimeout(timer.current)
                void api('DELETE', `/sessions/${encodeURIComponent(sessionId)}/annotation`).then(() => {
                  setDraft(EMPTY)
                  setSave({ kind: 'idle' })
                })
              }}
            >
              Delete
            </button>
            <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-quiet btn-danger" onClick={() => setConfirmClear(true)}>
            Clear annotations…
          </button>
        )}
      </div>
    </div>
  )
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  switch (state.kind) {
    case 'idle':
      return <span className="small muted">Changes save automatically</span>
    case 'saving':
      return <span className="small muted">Saving…</span>
    case 'saved':
      return <span className="small muted">Saved {new Date(state.at).toLocaleTimeString()}</span>
    case 'error':
      return (
        <span className="small" role="alert" style={{ color: 'var(--tone-danger-text)' }}>
          Not saved: {state.message}{' '}
          <button type="button" className="btn" onClick={onRetry}>
            Retry
          </button>
        </span>
      )
  }
}
