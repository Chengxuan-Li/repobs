# 0010 — Interface size; the wheel zooms the history

- Status: accepted (owner request, 2026-11-02)
- Amends: [0003](0003-dashboard-commit-graph-and-excerpts.md) (horizontal zoom by Ctrl + wheel), [0005](0005-views-and-file-menu.md) (*View → Styling*)

## Context

The owner asked for a size control for the whole interface (text, controls, panels), driven by Ctrl + wheel, using repobs's own zoom instead of the browser's. The history's horizontal zoom moves from Ctrl + wheel to the wheel alone: dragging already pans in both directions, so the wheel is not needed for scrolling. Text in the dashboard must not be selectable, so a drag to pan never selects.

## Decisions

1. **Interface size is CSS `zoom` on the root element** (`apps/web/src/app/uiScale.ts`), 50 %–200 %. Most sizes in the app are pixels, so scaling the root font size would leave most of the layout unchanged. CSS zoom scales everything, and the layout reflows to the window as with browser zoom.
2. **Inputs, in 10 % steps** (owner request). Ctrl + = / + and Ctrl + − move to the next whole 10 % (100 → 110 → 120 %), and Ctrl + 0 resets. Ctrl + wheel makes one step per wheel notch. A touchpad pinch arrives as Ctrl + wheel in small movements; they are added up, one step per 50 px. Both are taken in the capture phase on the window and their default is prevented, so the browser does not zoom, also while typing in a field. The same commands are in *View → Styling* and Search commands. The status bar shows *UI n %* when the size is not 100 %; clicking it resets the size.
3. **Per browser.** The size is kept in `localStorage` (`repobs.uiScale`), like the cached theme, because the right size depends on the screen. `public/theme-init.js` applies it before the first frame.
4. **Coordinates.** With CSS zoom, pointer positions, `getBoundingClientRect()` and the window size are in screen pixels; `left`/`top`, sizes and `scrollLeft`/`scrollTop` inside the page are in page pixels. `components/placement.ts` converts: `pageZoom()` (the root's `currentCSSZoom`), `boxOf()` and `windowSize()` return page pixels. Hover cards, menus, dropdowns, the checklist list, drag-to-pan, the wheel's anchor point and the lane click all use them.
5. **The dock frame is not zoomed.** FlexLayout reads screen coordinates and writes them as CSS pixels, so its splitters moved about three times as far as the pointer at 150 %. `.flexlayout__layout` therefore has `zoom: calc(1 / var(--ui-scale))`. Its tab strips scale through `--ui-scale` (font size and heights in `dock.css`), and each panel is zoomed again (`.panelScale`). A few pixel paddings in FlexLayout's own stylesheet stay unscaled.
6. **The wheel zooms the history.** Over the dashboard the wheel zooms the axis around the pointer, 10 % per notch (×1.1; smooth on touchpads), and no longer scrolls vertically. Panning is by drag, the scroll bars or the keyboard. Sideways wheel movement (a touchpad's sideways swipe, a tilting wheel) and Shift + wheel still scroll the history sideways: the first version swallowed them, so a sideways swipe did nothing. Ctrl + wheel is left to the interface size. Open menus and dialogs inside the view keep the wheel for scrolling.
7. **No text selection in the dashboard.** `.scroller` has `user-select: none`, except for text fields. Hover cards and the details panel are outside the view, and their text can still be selected and copied.

## Consequences

- Browsers without standardized CSS zoom (Chromium before 128, Firefox before 126) report no `currentCSSZoom`. There, at sizes other than 100 %, floating cards and panning use unconverted coordinates. Supported browsers are current Edge and Chrome.
- The browser's own zoom (its menu) still works and combines with the interface size.
- Touch screens keep native pinch zoom and scrolling.
