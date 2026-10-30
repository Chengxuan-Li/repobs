import { useEffect, useState } from 'react'
import { EmptyState, InlineAlert } from '../components/primitives'
import { establishSession } from './api'
import { store, useStore } from './store'
import { WorkbenchShell } from './WorkbenchShell'

// Pairing consumes a one-time token, so it must run once per page load (StrictMode runs effects twice).
let session: ReturnType<typeof establishSession> | undefined

export function App() {
  const [auth, setAuth] = useState<'checking' | 'paired' | 'unpaired' | 'error'>('checking')
  const [authError, setAuthError] = useState<string>()
  const state = useStore()

  useEffect(() => {
    session ??= establishSession()
    session.then(
      (result) => {
        setAuth(result)
        if (result === 'paired') void store.startOnce()
      },
      (err: unknown) => {
        setAuth('error')
        setAuthError(err instanceof Error ? err.message : 'The repobs server is not reachable')
      },
    )
  }, [])

  if (auth === 'checking' || (auth === 'paired' && !state.snapshot && !state.error)) {
    return <p className="muted" style={{ padding: 24 }}>Connecting to the local repobs service…</p>
  }
  if (auth === 'unpaired') {
    return (
      <EmptyState title="This browser is not paired with repobs">
        <p>For your privacy, repobs only answers browsers opened through its launcher.</p>
        <p>
          Run <span className="mono">npm start</span> (or <span className="mono">npm run open</span> if repobs is already running) in the repobs folder. It opens
          this page with a one-time pairing link.
        </p>
      </EmptyState>
    )
  }
  if (auth === 'error' || !state.snapshot) {
    return (
      <div style={{ padding: 24 }}>
        <InlineAlert tone="danger">{authError ?? state.error ?? 'Could not load data'}</InlineAlert>
      </div>
    )
  }
  return <WorkbenchShell snapshot={state.snapshot} connection={state.connection} error={state.error} />
}
