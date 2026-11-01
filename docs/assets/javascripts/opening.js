// The product landing page (design/docs-ui-spec.md, 0.7).
//
// The film: no player controls. It starts by itself, muted (browsers allow only muted autoplay), and plays once; then a
// Replay button plays it again from the start, with sound (the click allows it). With reduced motion requested it does
// not start by itself: the button reads Play. A click or Space on the film pauses and resumes it, so the motion can
// always be stopped.
//
// The header: the page opens on the film alone; <html data-ui-scrolled> is set whenever the page is not at its top, and
// CSS reveals the header from it, on the landing page only.
(() => {
  const root = document.documentElement
  let pending = false

  const update = () => {
    pending = false
    root.toggleAttribute('data-ui-scrolled', window.scrollY > 0)
  }

  const schedule = () => {
    if (pending) return
    pending = true
    window.requestAnimationFrame(update)
  }

  window.addEventListener('scroll', schedule, { passive: true })
  for (const event of ['pageshow', 'hashchange', 'resize']) window.addEventListener(event, schedule)
  update()

  const setUpFilm = () => {
    const video = document.querySelector('.ui-opening video')
    const button = document.querySelector('.ui-opening .ui-film-replay')
    if (!video || !button || video.dataset.ready) return
    video.dataset.ready = 'true'

    const offer = (label) => {
      button.textContent = label
      button.hidden = false
    }
    const toggle = () => {
      if (video.paused) {
        button.hidden = true
        void video.play()
      } else video.pause()
    }

    video.addEventListener('ended', () => offer('Replay'))
    video.addEventListener('click', toggle)
    video.addEventListener('keydown', (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      event.preventDefault()
      toggle()
    })
    button.addEventListener('click', () => {
      button.hidden = true
      video.currentTime = 0
      video.muted = false
      void video.play()
    })

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) offer('Play')
    else video.play().catch(() => offer('Play'))
  }

  // Material's instant navigation swaps pages without reloading; its document$ announces each one.
  if (window.document$) window.document$.subscribe(setUpFilm)
  else document.addEventListener('DOMContentLoaded', setUpFilm)
})()
