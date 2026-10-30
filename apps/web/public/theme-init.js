// First-frame appearance: mirrors the server-side theme setting cached by the app in localStorage.
;(function () {
  try {
    var t = localStorage.getItem('repobs.theme')
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t)
  } catch (e) {
    /* storage unavailable: follow the system */
  }
})()
