import type { ThemePreference } from '@repobs/contracts'

/** Apply the appearance and mirror it for the first-frame script (public/theme-init.js). */
export function applyTheme(theme: ThemePreference) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  try {
    localStorage.setItem('repobs.theme', theme)
  } catch {
    // storage unavailable
  }
}
