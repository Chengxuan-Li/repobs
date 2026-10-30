import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './theme/tokens.css'
import { App } from './app/App'

// A new pairing link opened in an existing tab only changes the hash; restart the app so it pairs.
window.addEventListener('hashchange', () => {
  if (/(?:^#|&)pair=/.test(window.location.hash)) window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
