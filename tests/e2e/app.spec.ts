import fs from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
// @ts-expect-error -- plain ESM helper shared with the launcher scripts
import { mintPairingToken } from '../../scripts/lib.mjs'
import { claude } from '../../fixtures/session-fixtures.ts'
import { readE2EState } from './state.ts'

const port = Number(process.env.REPOBS_E2E_PORT ?? 47399)
const state = () => readE2EState(port)

async function pair(page: Page) {
  await page.goto(`/#pair=${mintPairingToken(state().dataDir) as string}`)
  await expect(page.getByRole('button', { name: 'Add repositories' }).first()).toBeVisible()
}

const board = (page: Page, repo: string) => page.getByRole('region', { name: `${repo} repository` })
const row = (page: Page, name: string | RegExp) => page.getByRole('listitem', { name })
const details = (page: Page) => page.getByRole('complementary', { name: 'Details panel' })
/** Click a card by its title (the row centre can be the card's own review dropdown). */
const openCard = (page: Page, title: string) => row(page, new RegExp('^' + title)).getByText(title, { exact: true }).click()

test.describe.serial('repobs dashboard (synthetic data)', () => {
  test('an unpaired browser gets instructions, not data', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'This browser is not paired with repobs' })).toBeVisible()
    expect((await page.request.get('/api/v1/snapshot')).status()).toBe(401)
  })

  test('first launch: empty state, then several repositories added at once from session candidates', async ({ page }) => {
    await pair(page)
    await expect(page.getByRole('heading', { name: /Observe your Git worktrees/ })).toBeVisible()
    await page.getByRole('button', { name: 'Add repositories' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Add repositories' })
    const list = dialog.getByRole('list', { name: 'Repositories to add' })
    await expect(list.getByRole('checkbox')).toHaveCount(2)
    await dialog.getByLabel('Select all').check()
    await dialog.getByRole('button', { name: 'Add 2 repositories' }).click()
    await expect(dialog).toBeHidden()
    await expect(board(page, 'repo-a')).toBeVisible()
    await expect(board(page, 'repo-b')).toBeVisible()
    await expect(page.getByText('2 repos')).toBeVisible()
  })

  test('invalid and duplicate paths are reported per path', async ({ page }) => {
    await pair(page)
    await page.getByRole('button', { name: 'Add repositories' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Add repositories' })
    for (const p of [state().git.repoA, path.join(state().root, 'nowhere')]) {
      await dialog.getByLabel('Local repository path').fill(p)
      await dialog.getByRole('button', { name: 'Add to list' }).click()
    }
    await dialog.getByRole('button', { name: 'Add 2 repositories' }).click()
    await expect(dialog.getByRole('alert')).toContainText('already registered')
    await expect(dialog.getByRole('alert')).toContainText('does not exist')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('the page itself never scrolls; only panels do', async ({ page }) => {
    await pair(page)
    await page.mouse.move(700, 500)
    await page.mouse.wheel(0, 3000)
    const metrics = await page.evaluate(() => ({
      scrollY: window.scrollY,
      overflow: document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight,
    }))
    expect(metrics).toEqual({ scrollY: 0, overflow: 0 })
  })

  test('branches are drawn as a commit graph with local-only commits and pending changes', async ({ page }) => {
    await pair(page)
    const a = board(page, 'repo-a')
    await expect(row(page, /^main branch, \d+ uncommitted changes/)).toBeVisible()
    await expect(row(page, /^feature\/tracked branch/)).toBeVisible()
    const svg = a.locator('svg[aria-hidden="true"]').last()
    await expect(svg.locator('circle').first()).toBeAttached()
    expect(await svg.locator('circle[class*="local"]').count()).toBeGreaterThan(0)
    expect(await svg.locator('circle[class*="pushed"]').count()).toBeGreaterThan(0)
    expect(await svg.locator('rect[class*="pending"]').count()).toBeGreaterThan(0)
    await expect(svg.locator('text', { hasText: 'feature/tracked' })).toBeAttached()
    // Branch relationships are spelled out: forks, and branches pointing at another branch's commit.
    await expect(row(page, /^feature\/tracked branch, branched from main/)).toContainText('from main')
    await expect(row(page, /^unicode-branch branch, at main/)).toContainText('at main')
    expect(await svg.locator('circle[class*="pointer"]').count()).toBeGreaterThan(0)
  })

  test('the axis is shared, in commit order by default, and can switch to calendar time', async ({ page }) => {
    await pair(page)
    const axis = page.getByText('Commits in order →')
    await expect(axis).toBeVisible()
    // Every repository uses the same width (one shared axis).
    const widths = await page.getByRole('region', { name: /repository$/ }).evaluateAll((els) => els.map((e) => (e as HTMLElement).style.width))
    expect(new Set(widths).size).toBe(1)
    await page.getByLabel('Axis').selectOption('time')
    await expect(page.getByText('Calendar time →')).toBeVisible()
    // Compressed calendar: no two commits on the axis closer than the minimum spacing.
    await page.getByLabel('Axis').selectOption('compressed')
    await expect(page.getByText('Calendar, compressed →')).toBeVisible()
    const xs = await board(page, 'repo-a')
      .locator('svg[aria-hidden="true"]')
      .last()
      .locator('circle[class*="commit"]')
      .evaluateAll((els) => els.map((e) => Number(e.getAttribute('cx'))))
    const sorted = [...new Set(xs)].sort((a, b) => a - b)
    expect(sorted.length).toBeGreaterThan(5)
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(21.9)
    await page.getByLabel('Axis').selectOption('sequence')
  })

  test('hovering a commit shows its message; the legend explains the marks', async ({ page }) => {
    await pair(page)
    const svg = board(page, 'repo-a').locator('svg[aria-hidden="true"]').last()
    const node = svg.locator('circle[class*="local"]').first()
    await node.scrollIntoViewIfNeeded()
    const box = (await node.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const tip = page.getByRole('tooltip')
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('Local only — not pushed')
    await page.mouse.move(5, 5)
    await page.getByRole('button', { name: 'Legend' }).click()
    const legend = page.getByRole('region', { name: 'Legend' })
    await expect(legend).toContainText('Local only, not pushed')
    await expect(legend).toContainText('Agent activity')
    await page.getByRole('button', { name: 'Hide legend' }).click()
  })

  test('branch connectors are orthogonal with rounded corners', async ({ page }) => {
    await pair(page)
    const svg = board(page, 'repo-a').locator('svg[aria-hidden="true"]').last()
    const paths = await svg.locator('path[class*="edgeCross"]').evaluateAll((els) => els.map((e) => e.getAttribute('d') ?? ''))
    expect(paths.length).toBeGreaterThan(0)
    // Only axis-aligned straight segments joined by small quadratic corners; no free-form curves.
    for (const d of paths) {
      expect(d).toMatch(/^M[\d.-]+,[\d.-]+(?: L[\d.-]+,[\d.-]+(?: Q[\d.-]+,[\d.-]+ [\d.-]+,[\d.-]+)?)+$/)
      const pts = [...d.matchAll(/[MLQ ]([\d.-]+),([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
      const lines = [...d.matchAll(/(?:^M|[L ])([\d.-]+),([\d.-]+) L([\d.-]+),([\d.-]+)/g)]
      for (const m of lines) expect(m[1] === m[3] || m[2] === m[4]).toBe(true)
      expect(pts.length).toBeGreaterThan(1)
    }
  })

  test('connectors leaving one commit run on separate parallel tracks', async ({ page }) => {
    await pair(page)
    const svg = board(page, 'repo-a').locator('svg[aria-hidden="true"]').last()
    // Every fork from main's commit gets its own vertical track until the tracks run out.
    const xs = await svg.locator('path[class*="edgeCross"]').evaluateAll((els) =>
      els.map((e) => (e.getAttribute('d') ?? '').match(/Q([\d.-]+),/)?.[1]).filter((x): x is string => !!x),
    )
    expect(new Set(xs).size).toBeGreaterThan(1)
  })

  test('quiet commits collapse into a group you can hover, inspect and expand', async ({ page }) => {
    await pair(page)
    const svg = board(page, 'repo-a').locator('svg[aria-hidden="true"]').last()
    const commitsBefore = await svg.locator('circle[class*="commit"]').count()
    await page.getByLabel('Collapse quiet commits').check()
    const group = svg.locator('g[class*="group"]').first()
    await expect(group).toContainText('8')
    expect(await svg.locator('circle[class*="commit"]').count()).toBe(commitsBefore - 8)
    await group.scrollIntoViewIfNeeded()
    await group.hover()
    const card = page.getByRole('dialog', { name: 'Commit details' })
    await expect(card).toContainText('8 quiet commits on claude/scratch-a8de')
    await card.getByText('Scratch step 6').hover()
    await expect(card).toContainText('local only')
    await card.getByRole('button', { name: 'Show these commits on the graph' }).click()
    await expect(svg.locator('g[class*="group"]')).toHaveCount(0)
    expect(await svg.locator('circle[class*="commit"]').count()).toBe(commitsBefore)
    // Switching collapsing on again re-collapses everything.
    await page.getByLabel('Collapse quiet commits').uncheck()
    await page.getByLabel('Collapse quiet commits').check()
    await expect(svg.locator('g[class*="group"]')).toHaveCount(1)
    await svg.locator('g[class*="group"]').first().click()
    await expect(svg.locator('g[class*="group"]')).toHaveCount(0)
    await page.getByLabel('Collapse quiet commits').uncheck()
  })

  test('agents are one line; details expand on demand or on hover; spawned agents can be hidden', async ({ page }) => {
    await pair(page)
    const parent = row(page, /^Claude session c3d2e4f6, Claude Code agent/)
    await expect(parent).toContainText('Working')
    await expect(parent).not.toContainText('synthetic answer')
    const box = (await parent.boundingBox())!
    expect(box.height).toBeLessThanOrEqual(30)
    // Hover card shows the details.
    await parent.getByText('Claude session c3d2e4f6').hover()
    await expect(page.getByRole('dialog', { name: 'Agent details' })).toContainText('synthetic answer')
    // The chevron expands one agent.
    await parent.getByRole('button', { name: /^Expand / }).click()
    await expect(parent).toContainText('synthetic answer')
    await expect(parent).toContainText('Running subagents')
    await parent.getByRole('button', { name: /^Collapse / }).click()
    await expect(parent).not.toContainText('synthetic answer')
    const child = row(page, /^Map the feature module/)
    await expect(child).toBeVisible()
    // Spawned agents are cards indented under their parent; the tree line runs left of the cards.
    const left = async (r: typeof child) => (await r.locator('[class*="card"]').first().boundingBox())!.x
    expect(await left(child)).toBeGreaterThan((await left(parent)) + 10)
    await expect(child.locator('[class*="guide_"]')).toHaveCount(1)
    await page.getByLabel('Hide spawned agents').check()
    await expect(child).toBeHidden()
    await page.getByLabel('Hide spawned agents').uncheck()
    await expect(child).toBeVisible()
  })

  test('filters by harness, status and last-message time', async ({ page }) => {
    await pair(page)
    await expect(row(page, /^Add rename detection test/)).toBeVisible()
    await page.getByLabel('Codex', { exact: true }).uncheck()
    await expect(row(page, /^Add rename detection test/)).toBeHidden()
    await expect(row(page, /^Tighten status parser/)).toBeVisible()
    await page.getByLabel('Codex', { exact: true }).check()
    await page.getByRole('button', { name: 'Needs input', exact: true }).click()
    await expect(row(page, /^Add rename detection test/)).toBeVisible()
    await expect(row(page, /^Document worktree states/)).toBeHidden()
    await page.getByRole('button', { name: 'Needs input', exact: true }).click()
    await page.getByLabel('Last message').selectOption({ label: 'Last 24 hours' })
    await expect(row(page, /^Resolve merge plan/)).toBeHidden()
    await expect(row(page, /^Document worktree states/)).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(row(page, /^Resolve merge plan/)).toBeVisible()
  })

  test('keyboard: arrows move between rows, Enter opens details', async ({ page }) => {
    await pair(page)
    await page.getByLabel(/^Branches and agents\. Use the arrow keys/).focus()
    await page.keyboard.press('ArrowDown')
    await expect(row(page, /^main branch/).first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    const focused = page.locator('[data-nav-row]:focus')
    await expect(focused).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('ArrowRight')
    await expect(focused).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(focused).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Enter')
    await expect(details(page).getByRole('heading', { level: 2 })).toBeVisible()
    await expect(details(page).getByLabel('Review state')).toBeVisible()
  })

  test('notes: review dropdown, tag autocomplete, multi-line notes, checklist collapse, persistence', async ({ page }) => {
    await pair(page)
    await openCard(page, 'Review ref grouping')
    const d = details(page)
    await d.getByLabel('Review state').selectOption('flagged')
    await d.getByRole('combobox', { name: 'Tags' }).fill('needs-tests')
    await d.getByRole('combobox', { name: 'Tags' }).press('Enter')
    await d.getByLabel('Notes').fill('Line one\nLine two')
    await d.getByLabel('New checklist item').fill('Verify fixture coverage')
    await d.getByLabel('New checklist item').press('Enter')
    await expect(d.getByText(/^Saved /)).toBeVisible()
    await d.getByRole('checkbox', { name: 'Verify fixture coverage' }).click() // collapses on completion
    await expect(d.getByText('All 1 checklist item complete')).toBeVisible()
    await expect(d.getByText(/^Saved /)).toBeVisible()

    // Another session: typing a prefix and Tab completes the existing tag.
    await openCard(page, 'Tighten status parser')
    await d.getByRole('combobox', { name: 'Tags' }).fill('need')
    await expect(d.getByRole('option', { name: 'needs-tests' })).toBeVisible()
    await d.getByRole('combobox', { name: 'Tags' }).press('Tab')
    await expect(d.getByRole('button', { name: 'Remove tag needs-tests' })).toBeVisible()
    await expect(d.getByText(/^Saved /)).toBeVisible()

    await page.reload()
    await openCard(page, 'Review ref grouping')
    await expect(d.getByLabel('Notes')).toHaveValue('Line one\nLine two')
    await expect(d.getByLabel('Review state')).toHaveValue('flagged')
    await d.getByRole('button', { name: 'Show completed' }).click()
    await expect(d.getByRole('checkbox', { name: 'Verify fixture coverage' })).toBeChecked()

    // Details mode shows notes (with the line break) and tags on the card; the tag filter narrows.
    await page.getByLabel('Expand agent details').check()
    const card = row(page, /^Review ref grouping/)
    // innerText honours the card's pre-wrap styling, so the line break must survive rendering.
    expect(await card.locator('p', { hasText: 'Line one' }).evaluate((e) => (e as HTMLElement).innerText)).toBe('Line one\nLine two')
    await expect(card).toContainText('needs-tests')
    await page.getByRole('combobox', { name: 'Filter by tags' }).fill('needs')
    await page.getByRole('combobox', { name: 'Filter by tags' }).press('Enter')
    await expect(row(page, /^Document worktree states/)).toBeHidden()
    await expect(row(page, /^Tighten status parser/)).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await page.getByLabel('Expand agent details').uncheck()
  })

  test('the status on a card and in its hover card is a review menu', async ({ page }) => {
    await pair(page)
    const card = row(page, /^Document worktree states/)
    const status = card.getByRole('button', { name: /change review state/ })
    await expect(status).toHaveText('Unreviewed') // finished but not reviewed: never shown as a success
    await status.click()
    const menu = page.getByRole('menu', { name: 'Review state of Document worktree states' })
    await expect(menu.getByRole('menuitemradio', { name: 'Unreviewed' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('ArrowDown') // keyboard works inside the menu
    await expect(menu.getByRole('menuitemradio', { name: 'Needs review' })).toBeFocused()
    await menu.getByRole('menuitemradio', { name: 'Complete' }).click()
    await expect(menu).toBeHidden()
    await expect(status).toHaveText('Complete')

    // The same menu from the hover card.
    await page.mouse.move(5, 5)
    await card.getByText('Document worktree states', { exact: true }).hover()
    const hover = page.getByRole('dialog', { name: 'Agent details' })
    await hover.getByRole('button', { name: /change review state/ }).click()
    await hover.getByRole('menuitemradio', { name: 'Needs review' }).click()
    await expect(status).toHaveText('Needs review')
    await status.click()
    await page.getByRole('menuitemradio', { name: 'Unreviewed' }).click()
    await expect(status).toHaveText('Unreviewed')
  })

  test('ribbon menus, command palette and shortcuts drive the dockable layout', async ({ page }) => {
    await pair(page)
    const repos = page.getByRole('complementary', { name: 'Repositories panel' })
    await expect(details(page)).toBeVisible()
    await expect(repos).toBeVisible()

    // A menu toggles the details panel; the state survives a reload.
    await page.getByRole('button', { name: 'View', exact: true }).click()
    const menu = page.getByRole('menu', { name: 'View menu' })
    await expect(menu.getByRole('menuitemcheckbox', { name: /Details panel/ })).toHaveAttribute('aria-checked', 'true')
    await menu.getByRole('menuitemcheckbox', { name: /Details panel/ }).click()
    await expect(details(page)).toBeHidden()
    await page.reload()
    await expect(board(page, 'repo-a')).toBeVisible()
    await expect(details(page)).toBeHidden()

    // Ctrl+B toggles the repositories panel; the quick button shows its state.
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+B')
    await expect(repos).toBeHidden()
    await expect(page.getByRole('button', { name: 'Repositories panel' })).toHaveAttribute('aria-pressed', 'false')

    // The command palette finds and runs any command.
    await page.keyboard.press('Control+K')
    const palette = page.getByRole('dialog', { name: 'Search commands' })
    await palette.getByRole('combobox').fill('compressed')
    await page.keyboard.press('Enter')
    await expect(palette).toBeHidden()
    await expect(page.getByText('Calendar, compressed →')).toBeVisible()

    // Selecting an agent brings the details panel back; reset restores the default arrangement.
    await openCard(page, 'Tighten status parser')
    await expect(details(page)).toBeVisible()
    await page.getByRole('button', { name: 'Reset layout' }).click()
    await expect(repos).toBeVisible()
    await expect(details(page)).toBeVisible()
    await page.getByRole('button', { name: 'Maximize dashboard' }).click()
    await expect(repos).toBeHidden()
    await page.getByRole('button', { name: 'Maximize dashboard' }).click()
    await expect(repos).toBeVisible()
    await page.getByLabel('Axis').selectOption('sequence')
  })

  test('agent labels on the timeline and names in the list toggle independently', async ({ page }) => {
    await pair(page)
    const svg = board(page, 'repo-a').locator('svg[aria-hidden="true"]').last()
    const label = svg.locator('text[data-bar-label^="claude:c3d2e4f6"]').first()
    await expect(label).toContainText('Claude session c3d2e4f6')
    await expect(label).toContainText('Working')
    const parent = row(page, /^Claude session c3d2e4f6, Claude Code agent/)
    const before = (await parent.boundingBox())!.width

    // Names only on the timeline: the column narrows, cards keep their status menu and stay named for assistive tech.
    await page.getByLabel('Agent names in list').uncheck()
    await expect(parent).not.toContainText('Claude session c3d2e4f6')
    await expect(parent.getByRole('button', { name: /change review state/ })).toBeVisible()
    expect((await parent.locator('[class*="label"]').first().boundingBox())!.width).toBeLessThan(before)
    await expect(label).toBeVisible()

    // Names only in the list.
    await page.getByLabel('Agent names in list').check()
    await page.getByLabel('Agent labels on timeline').uncheck()
    await expect(svg.locator('text[data-bar-label]')).toHaveCount(0)
    await expect(parent).toContainText('Claude session c3d2e4f6')
    await page.getByLabel('Agent labels on timeline').check()
  })

  test('the history zooms horizontally', async ({ page }) => {
    await pair(page)
    const svg = board(page, 'repo-a').locator('svg[aria-hidden="true"]').last()
    const width = async () => Number(await svg.getAttribute('width'))
    const before = await width()
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect(page.getByRole('button', { name: /^Zoom 150%/ })).toBeVisible()
    expect(await width()).toBeGreaterThan(before * 1.4)
    await page.getByRole('button', { name: /^Zoom 150%/ }).click()
    expect(await width()).toBe(before)
  })

  test('long agent lists collapse behind "show more"', async ({ page }) => {
    await pair(page)
    const more = board(page, 'repo-b').getByRole('listitem', { name: /^Show \d+ more agents/ })
    await expect(more).toBeVisible()
    await more.click()
    await expect(more).toBeHidden()
    expect(await board(page, 'repo-b').getByRole('listitem', { name: /Bulk session/ }).count()).toBeGreaterThan(300)
  })

  test('external Git and agent changes appear without a browser refresh', async ({ page }) => {
    await pair(page)
    await expect(row(page, /^unicode-branch branch, at main$/)).toBeVisible()
    fs.writeFileSync(path.join(state().git.worktrees.unicode, 'from-outside.txt'), 'x')
    await expect(row(page, /^unicode-branch branch, 1 uncommitted change/)).toBeVisible({ timeout: 15_000 })

    const cwd = state().git.repoB
    const { writeClaudeSession } = await import('../../fixtures/session-fixtures.ts')
    writeClaudeSession(state().claudeHome, cwd, 'live0000-0000-4000-8000-000000000001', [
      claude.title('live0000-0000-4000-8000-000000000001', 'Started after repobs'),
      claude.prompt('live0000-0000-4000-8000-000000000001', cwd, Date.now()),
    ])
    await expect(row(page, /^Started after repobs/)).toBeVisible({ timeout: 15_000 })
    await expect(row(page, /^Started after repobs/)).toContainText('Working')
  })

  test('theme choice persists across reloads', async ({ page }) => {
    await pair(page)
    const toggle = page.getByRole('button', { name: /Switch theme/ })
    for (let i = 0; i < 3; i++) {
      if ((await page.locator('html').getAttribute('data-theme')) === 'dark') break
      await toggle.click()
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('settings: turning off message excerpts removes them from cards', async ({ page }) => {
    await pair(page)
    await page.getByLabel('Expand agent details').check()
    await expect(row(page, /^Document worktree states/)).toContainText('synthetic answer')
    await page.getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByLabel('Show latest message excerpts on agent cards').uncheck()
    await settings.getByRole('button', { name: 'Save settings' }).click()
    await expect(row(page, /^Document worktree states/)).not.toContainText('synthetic answer', { timeout: 15_000 })
    await page.getByRole('button', { name: 'Settings' }).click()
    await settings.getByLabel('Show latest message excerpts on agent cards').check()
    await settings.getByRole('button', { name: 'Save settings' }).click()
    await page.getByLabel('Expand agent details').uncheck()
  })

  test('diagnostics report adapters without transcript text', async ({ page }) => {
    await pair(page)
    await page.getByRole('button', { name: 'Diagnostics' }).click()
    const diag = page.getByRole('dialog', { name: 'Diagnostics' })
    await expect(diag.getByRole('cell', { name: 'Claude Code' })).toBeVisible()
    await expect(diag).not.toContainText('synthetic prompt')
    await page.keyboard.press('Escape')
  })

  test('removing a repository only removes the dashboard entry', async ({ page }) => {
    await pair(page)
    await page.getByRole('button', { name: 'Remove repo-b from the dashboard' }).click()
    const dialog = page.getByRole('dialog', { name: 'Remove repository from dashboard' })
    await expect(dialog).toContainText('No files, branches or worktrees are deleted')
    await dialog.getByRole('button', { name: 'Remove from dashboard' }).click()
    await expect(board(page, 'repo-b')).toBeHidden()
    expect(fs.existsSync(path.join(state().git.repoB, 'b.txt'))).toBe(true)
  })
})
