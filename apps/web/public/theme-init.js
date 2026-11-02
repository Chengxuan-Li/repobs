// First-frame appearance: mirrors the server-side theme setting cached by the app in localStorage,
// and this browser's UI size (app/uiScale.ts).
;(function () {
  try {
    var t = localStorage.getItem('repobs.theme')
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t)
    var s = Number(localStorage.getItem('repobs.uiScale'))
    if (s >= 0.5 && s <= 2 && s !== 1) {
      document.documentElement.style.setProperty('zoom', String(s))
      document.documentElement.style.setProperty('--ui-scale', String(s))
    }
  } catch (e) {
    /* storage unavailable: follow the system, at the default size */
  }
})()
