// The product landing page (design/docs-ui-spec.md, 0.7).
//
// The film has no player controls. On entry it plays by itself, muted (browsers allow only muted autoplay), and the
// page waits for it: scrolling is held until it ends. Trying to scroll meanwhile (wheel, touch or a scroll key) shows
// Skip; Skip, Escape or the film's end fades the film out, releases the page and brings the title into view. Scrolling
// back up to the film plays it again, without holding the page. It plays by itself whatever the motion preference (the
// owner's decision); Skip, Escape, a click or Space stop it, and with reduced motion requested the move to the title is
// instant rather than smooth. The page is held only once per browser session, and never when the page opens on an anchor
// or a restored scroll position, or when the browser refuses to play.
//
// The header: <html data-ui-scrolled> is set whenever the page is not at its top; CSS reveals the header from it, on
// the landing page only.
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

  const SEEN = 'repobs-film-seen'
  const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '])
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const seen = () => {
    try {
      return window.sessionStorage.getItem(SEEN) === 'true'
    } catch {
      return false
    }
  }
  const markSeen = () => {
    try {
      window.sessionStorage.setItem(SEEN, 'true')
    } catch {
      // storage blocked: the page may be held again on the next visit
    }
  }

  // What the previous landing page left behind (instant navigation keeps <html> and the window).
  let teardown = () => {}

  const setUpFilm = () => {
    teardown()
    root.removeAttribute('data-ui-film-hold')
    const opening = document.querySelector('.ui-opening')
    const video = opening?.querySelector('video')
    const skip = opening?.querySelector('.ui-film-skip')
    if (!opening || !video || !skip) return

    const listeners = []
    const on = (target, type, handler, options) => {
      target.addEventListener(type, handler, options)
      listeners.push(() => target.removeEventListener(type, handler, options))
    }
    let holding = false

    const release = () => {
      holding = false
      root.removeAttribute('data-ui-film-hold')
      skip.hidden = true
      markSeen()
    }
    // Fade the film out and bring the title into view.
    const finish = () => {
      const wasHolding = holding
      release()
      opening.dataset.state = 'faded'
      video.pause()
      if (wasHolding || window.scrollY < opening.offsetHeight / 2) {
        window.scrollTo({ top: opening.offsetHeight, behavior: reducedMotion() ? 'auto' : 'smooth' })
      }
    }
    const play = () => {
      opening.dataset.state = 'playing'
      return video.play()
    }
    const toggle = () => (video.paused ? void play() : video.pause())
    const wantsToScroll = (event) => {
      if (!holding) return
      if (event.type === 'keydown' && !SCROLL_KEYS.has(event.key)) {
        if (event.key === 'Escape') finish()
        return
      }
      if (event.type === 'keydown' && event.target === video && (event.key === ' ' || event.key === 'Enter')) return
      event.preventDefault()
      skip.hidden = false
    }

    on(video, 'ended', () => finish())
    on(video, 'click', toggle)
    on(video, 'keydown', (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      event.preventDefault()
      toggle()
    })
    on(skip, 'click', finish)
    on(window, 'wheel', wantsToScroll, { passive: false })
    on(window, 'touchmove', wantsToScroll, { passive: false })
    on(window, 'keydown', wantsToScroll)

    // Back at the film after scrolling away: play it again from the start; away from it: pause.
    const watcher = new IntersectionObserver(
      ([entry]) => {
        if (holding) return
        if (entry.intersectionRatio >= 0.6 && opening.dataset.state === 'faded') {
          video.currentTime = 0
          void play().catch(() => {})
        } else if (entry.intersectionRatio < 0.6 && !video.paused) {
          video.pause()
          opening.dataset.state = 'faded'
        }
      },
      { threshold: [0, 0.6] },
    )
    watcher.observe(opening)

    teardown = () => {
      for (const off of listeners) off()
      watcher.disconnect()
      root.removeAttribute('data-ui-film-hold')
      teardown = () => {}
    }

    const atTop = window.scrollY === 0 && (!window.location.hash || window.location.hash === '#film')
    if (!atTop) {
      opening.dataset.state = 'faded'
      return
    }
    holding = !seen()
    if (holding) root.setAttribute('data-ui-film-hold', '')
    play().catch(() => {
      // The browser refused to play: release the page and leave the poster; a click plays the film.
      release()
      opening.dataset.state = 'still'
    })
  }

  // Material's instant navigation swaps pages without reloading; its document$ announces each one.
  if (window.document$) window.document$.subscribe(setUpFilm)
  else document.addEventListener('DOMContentLoaded', setUpFilm)
})()
