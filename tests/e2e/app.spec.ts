import fs from 'node:fs'
import path from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
// @ts-expect-error -- plain ESM helper shared with the launcher scripts
import { mintPairingToken } from '../../scripts/lib.mjs'
import { claude, writeClaudeSession } from '../../fixtures/session-fixtures.ts'
import { readE2EState } from './state.ts'

const port = Number(process.env.REPOBS_E2E_PORT ?? 47399)
const state = () => readE2EState(port)

async function pair(page: Page) {
  await page.goto(`/#pair=${mintPairingToken(state().dataDir) as string}`)
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible()
}

/** Runs a ribbon menu command (File or View). */
async function runMenu(page: Page, menuName: 'File' | 'View', item: string) {
  await page.getByRole('button', { name: menuName, exact: true }).click()
  const menu = page.getByRole('menu', { name: `${menuName} menu` })
  await menu.getByRole('menuitem', { name: item }).or(menu.getByRole('menuitemcheckbox', { name: item })).click()
}
const view = (page: Page, name: string) => page.getByRole('main', { name: `${name} dashboard` })
const viewTab = (page: Page, name: string) => page.locator('.flexlayout__tab_button', { hasText: new RegExp(`^${name}$`) })

const board = (page: Page, repo: string) => page.getByRole('region', { name: `${repo} repository` })
const row = (page: Page, name: string | RegExp) => page.getByRole('listitem', { name })
const details = (page: Page) => page.getByRole('complementary', { name: 'Details panel' })
/** Click a card by its title (the row centre can be the card's own review dropdown). */
const openCard = (page: Page, title: string) => row(page, new RegExp('^' + title)).getByText(title, { exact: true }).click()
const filterBar = (page: Page) => page.getByRole('region', { name: 'Filters and view options' })
const dropdown = (page: Page, name: string) => filterBar(page).getByRole('button', { name: new RegExp(`^${name}(:|$)`) })

/** Opens a filter-bar dropdown, sets one of its options, and closes it again. */
async function setOption(page: Page, menuName: string, option: string, checked = true) {
  await dropdown(page, menuName).click()
  const menu = page.getByRole('menu', { name: menuName })
  const item = menu.getByRole('menuitemcheckbox', { name: option, exact: true }).or(menu.getByRole('menuitemradio', { name: option, exact: true }))
  if ((await item.getAttribute('aria-checked')) !== String(checked)) await item.click()
  if (await menu.isVisible()) await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
}

/**
 * Hovers something drawn in the lanes. The history is wider than the window, so bring it into view
 * three quarters across (clear of the sticky label column on the left), let that scroll pass (a
 * scroll closes hover cards), then move the pointer onto it without the further scrolling a
 * locator hover may do.
 */
async function hoverInLanes(page: Page, target: Locator) {
  await target.evaluate((el) => new Promise<void>((done) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
    let sc = el.parentElement!
    while (sc.scrollWidth <= sc.clientWidth) sc = sc.parentElement!
    const view = sc.getBoundingClientRect()
    sc.scrollLeft += el.getBoundingClientRect().left - (view.left + view.width * 0.75)
    requestAnimationFrame(() => requestAnimationFrame(() => done()))
  }))
  const box = (await target.boundingBox())!
  await page.mouse.move(box.x + Math.min(box.width / 2, 20), box.y + box.height / 2)
}

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
    const list = dialog.getByRole('list', { name: 'Repositories and folders to add' })
    await expect(list.getByRole('checkbox')).toHaveCount(2)
    await dialog.getByLabel('Select all').check()
    await dialog.getByRole('button', { name: 'Add 2 repositories' }).click()
    await expect(dialog).toBeHidden()
    await expect(board(page, 'git-status-kit')).toBeVisible()
    await expect(board(page, 'storefront-web')).toBeVisible()
    await expect(page.getByText('2 repos')).toBeVisible()
  })

  test('invalid and duplicate paths are reported per path', async ({ page }) => {
    await pair(page)
    await page.getByRole('complementary', { name: 'Repositories panel' }).getByRole('button', { name: 'Add', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add repositories' })
    for (const p of [state().git.repoA, path.join(state().root, 'nowhere')]) {
      await dialog.getByLabel('Local repository or folder path').fill(p)
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
    const a = board(page, 'git-status-kit')
    await expect(row(page, /^main branch, \d+ uncommitted changes/)).toBeVisible()
    await expect(row(page, /^feature\/tracked branch/)).toBeVisible()
    const svg = a.locator('svg[data-lanes]')
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
    await setOption(page, 'Timeline', 'Calendar time')
    await expect(page.getByText('Calendar time →')).toBeVisible()
    // Compressed calendar: no two commits on the axis closer than the minimum spacing.
    await setOption(page, 'Timeline', 'Calendar, compressed')
    await expect(page.getByText('Calendar, compressed →')).toBeVisible()
    const xs = await board(page, 'git-status-kit')
      .locator('svg[data-lanes]')
      .locator('circle[class*="commit"]')
      .evaluateAll((els) => els.map((e) => Number(e.getAttribute('cx'))))
    const sorted = [...new Set(xs)].sort((a, b) => a - b)
    expect(sorted.length).toBeGreaterThan(5)
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(21.9)
    await setOption(page, 'Timeline', 'Commit order')
  })

  test('hovering a commit shows its message; the legend explains the marks', async ({ page }) => {
    await pair(page)
    const svg = board(page, 'git-status-kit').locator('svg[data-lanes]')
    // The newest end is shown first; the first local commit can sit under the sticky label column.
    await page.getByLabel(/^Branches and agents. Use the arrow keys/).evaluate((el) => (el.scrollLeft = 0))
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
    const svg = board(page, 'git-status-kit').locator('svg[data-lanes]')
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
    const svg = board(page, 'git-status-kit').locator('svg[data-lanes]')
    // Every fork from main's commit gets its own vertical track until the tracks run out.
    const xs = await svg.locator('path[class*="edgeCross"]').evaluateAll((els) =>
      els.map((e) => (e.getAttribute('d') ?? '').match(/Q([\d.-]+),/)?.[1]).filter((x): x is string => !!x),
    )
    expect(new Set(xs).size).toBeGreaterThan(1)
  })

  test('quiet commits collapse into a group you can hover, inspect and expand', async ({ page }) => {
    await pair(page)
    const svg = board(page, 'git-status-kit').locator('svg[data-lanes]')
    const commitsBefore = await svg.locator('circle[class*="commit"]').count()
    await setOption(page, 'Branches', 'Collapse quiet commits')
    const group = svg.locator('g[class*="group"]').first()
    await expect(group).toContainText('8')
    expect(await svg.locator('circle[class*="commit"]').count()).toBe(commitsBefore - 8)
    await hoverInLanes(page, group)
    const card = page.getByRole('dialog', { name: 'Commit details' })
    await expect(card).toContainText('8 quiet commits on claude/scratch-a8de')
    await card.getByText('Scratch step 6').hover()
    await expect(card).toContainText('local only')
    await card.getByRole('button', { name: 'Show these commits on the graph' }).click()
    await expect(svg.locator('g[class*="group"]')).toHaveCount(0)
    expect(await svg.locator('circle[class*="commit"]').count()).toBe(commitsBefore)
    // Switching collapsing on again re-collapses everything.
    await setOption(page, 'Branches', 'Collapse quiet commits', false)
    await setOption(page, 'Branches', 'Collapse quiet commits')
    await expect(svg.locator('g[class*="group"]')).toHaveCount(1)
    await svg.locator('g[class*="group"]').first().click()
    await expect(svg.locator('g[class*="group"]')).toHaveCount(0)
    await setOption(page, 'Branches', 'Collapse quiet commits', false)
  })

  test('agents are one line with details on hover; the chevron shows spawned agents', async ({ page }) => {
    await pair(page)
    const parent = row(page, /^Claude session c3d2e4f6, Claude Code agent/)
    await expect(parent).toContainText('Working')
    await expect(parent).not.toContainText('synthetic answer')
    expect((await parent.boundingBox())!.height).toBeLessThanOrEqual(30)
    // Hover card shows the details; the dashboard itself never expands an agent.
    await parent.getByText('Claude session c3d2e4f6').hover()
    await expect(page.getByRole('dialog', { name: 'Agent details' })).toContainText('synthetic answer')
    await page.mouse.move(5, 5)
    // Only an agent that spawned others has a chevron; its agents start hidden.
    await expect(row(page, /^Add rename detection test/).getByRole('button', { name: /spawned agent/ })).toHaveCount(0)
    const child = row(page, /^Map the feature module/)
    await expect(child).toBeHidden()
    await parent.getByRole('button', { name: 'Show 2 spawned agents of Claude session c3d2e4f6' }).click()
    await expect(child).toBeVisible()
    await expect(parent).toHaveAttribute('aria-expanded', 'true')
    await expect(parent).not.toContainText('synthetic answer')
    // Spawned agents are cards indented under their parent; the tree line runs left of the cards.
    const left = async (r: typeof child) => (await r.locator('[class*="card"]').first().boundingBox())!.x
    expect(await left(child)).toBeGreaterThan((await left(parent)) + 10)
    await expect(child.locator('[class*="guide_"]')).toHaveCount(1)
    await parent.getByRole('button', { name: 'Hide 2 spawned agents of Claude session c3d2e4f6' }).click()
    await expect(child).toBeHidden()
    // Right and left arrows do the same from the keyboard.
    await parent.focus()
    await page.keyboard.press('ArrowRight')
    await expect(child).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(child).toBeHidden()
    // Turning collapsing off shows every spawned agent.
    await setOption(page, 'Agents', 'Collapse spawned agents', false)
    await expect(child).toBeVisible()
    await setOption(page, 'Agents', 'Collapse spawned agents')
    await expect(child).toBeHidden()
  })

  test('filters by harness, status and last-message time', async ({ page }) => {
    await pair(page)
    await expect(row(page, /^Add rename detection test/)).toBeVisible()
    // Harness is a multiple choice: one harness narrows, both is the same as any.
    await setOption(page, 'Harness', 'Claude Code')
    await expect(dropdown(page, 'Harness')).toHaveAccessibleName('Harness: Claude Code')
    await expect(row(page, /^Add rename detection test/)).toBeHidden()
    await expect(row(page, /^Tighten status parser/)).toBeVisible()
    await setOption(page, 'Harness', 'Codex')
    await expect(dropdown(page, 'Harness')).toHaveAccessibleName('Harness: Any')
    await expect(row(page, /^Add rename detection test/)).toBeVisible()
    await setOption(page, 'Status', 'Needs input')
    await expect(dropdown(page, 'Status')).toHaveAccessibleName('Status: Needs input')
    await expect(row(page, /^Add rename detection test/)).toBeVisible()
    await expect(row(page, /^Document worktree states/)).toBeHidden()
    await setOption(page, 'Status', 'Any status')
    await setOption(page, 'Last message', 'Last 24 hours')
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
    // An agent without spawned agents has nothing to expand (right/left arrows: see the spawned-agents test).
    await expect(focused).toHaveAttribute('data-session-id', /.+/)
    expect(await focused.getAttribute('aria-expanded')).toBeNull()
    await page.keyboard.press('Enter')
    await expect(details(page).getByRole('heading', { level: 2 })).toBeVisible()
    await expect(details(page).getByLabel('Review state')).toBeVisible()
  })

  test('notes: review dropdown, tag autocomplete, multi-line notes, checklist, persistence', async ({ page }) => {
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
    await d.getByRole('checkbox', { name: 'Verify fixture coverage' }).click() // stays listed when everything is done
    await expect(d.getByRole('checkbox', { name: 'Verify fixture coverage' })).toBeChecked()
    await expect(d.getByText(/checklist items? complete/i)).toHaveCount(0)
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
    await expect(d.getByRole('checkbox', { name: 'Verify fixture coverage' })).toBeChecked()

    // The hover card shows notes (with the line break) and tags; the tag filter narrows.
    await row(page, /^Review ref grouping/).getByText('Review ref grouping', { exact: true }).hover()
    const hover = page.getByRole('dialog', { name: 'Agent details' })
    // innerText honours the note's pre-wrap styling, so the line break must survive rendering.
    expect(await hover.locator('p', { hasText: 'Line one' }).evaluate((e) => (e as HTMLElement).innerText)).toBe('Line one\nLine two')
    await expect(hover).toContainText('needs-tests')
    await page.mouse.move(5, 5)
    await dropdown(page, 'Tags').click()
    await page.getByRole('combobox', { name: 'Filter by tags' }).fill('needs')
    await page.getByRole('combobox', { name: 'Filter by tags' }).press('Enter')
    await dropdown(page, 'Tags').click()
    await expect(page.getByRole('dialog', { name: 'Tags' })).toBeHidden()
    await expect(row(page, /^Document worktree states/)).toBeHidden()
    await expect(row(page, /^Tighten status parser/)).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
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

  test('every review state shows as itself on the card', async ({ page }) => {
    await pair(page)
    const card = row(page, /^Document worktree states/)
    const status = card.getByRole('button', { name: /change review state/ })
    const menu = page.getByRole('menu', { name: 'Review state of Document worktree states' })
    for (const state of ['Reviewed', 'Flagged', 'Outdated', 'Unreviewed']) {
      await status.click()
      await menu.getByRole('menuitemradio', { name: state, exact: true }).click()
      await expect(status).toHaveText(state)
    }
  })

  test('the checklist pill shows progress; hovering or clicking opens one list to tick items', async ({ page }) => {
    await pair(page)
    const card = row(page, /^Document worktree states/)
    const pill = card.getByRole('button', { name: /^Checklist of Document worktree states/ })
    const list = page.getByRole('dialog', { name: 'Checklist of Document worktree states' })
    await expect(pill).toHaveText('1/3')
    await pill.hover()
    await expect(list).toBeVisible()
    // The list is placed by the pill, not by the pointer: moving inside the pill does not move it.
    const before = await list.boundingBox()
    const box = (await pill.boundingBox())!
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2) // inside the rounded ends
    expect(await list.boundingBox()).toEqual(before)

    // Opened by hover, the list takes the pointer: tick an item there.
    await list.getByRole('checkbox', { name: 'Cover detached HEAD' }).check()
    await expect(pill).toHaveText('2/3')
    await page.mouse.move(5, 5)
    await expect(list).toBeHidden()
    await openCard(page, 'Document worktree states')
    await expect(details(page).getByRole('checkbox', { name: 'Cover detached HEAD' })).toBeChecked()

    // Opened by a click, the same list stays after the pointer leaves, until Escape.
    await pill.click()
    await page.mouse.move(5, 5)
    await expect(list).toBeVisible()
    await list.getByRole('checkbox', { name: 'Cover detached HEAD' }).uncheck()
    await expect(pill).toHaveText('1/3')
    await page.keyboard.press('Escape')
    await expect(list).toBeHidden()
  })

  test("the agent's own plan comes first in its checklist; your ticks override it in repobs only", async ({ page }) => {
    await pair(page)
    const card = row(page, /^Tighten status parser/)
    const pill = card.getByRole('button', { name: /^Checklist of Tighten status parser/ })
    // Task list of three steps, one advanced: step 1 done, step 2 in progress.
    await expect(pill).toHaveText('1/3')
    await pill.click()
    const list = page.getByRole('dialog', { name: 'Checklist of Tighten status parser' })
    const agent = list.getByRole('region', { name: 'Agent plan' })
    await expect(agent).toContainText('Agent plan · Claude task list')
    await expect(agent).toContainText('in progress')
    await agent.getByRole('checkbox', { name: /Add parser tests/ }).check()
    await expect(pill).toHaveText('2/3')
    await expect(agent).toContainText('ticked by you')
    await page.keyboard.press('Escape')

    // The details panel shows the same plan above your notes; unticking returns to the agent's status.
    await openCard(page, 'Tighten status parser')
    const plan = details(page).getByRole('region', { name: 'Agent plan' })
    await expect(plan).toContainText('Claude task list')
    await expect(plan.getByRole('checkbox', { name: /Add parser tests/ })).toBeChecked()
    await plan.getByRole('checkbox', { name: /Add parser tests/ }).uncheck()
    await expect(pill).toHaveText('1/3')
    await expect(plan).not.toContainText('unticked by you')

    // Codex plans too: two of three steps done, plus the ticked item you added in the notes test.
    await expect(row(page, /^Review ref grouping/).getByRole('button', { name: /^Checklist of Review ref grouping/ })).toHaveText('3/4')
  })

  test('Claude task results create a checklist and later updates sync without a refresh', async ({ page }) => {
    const { claudeHome, git } = state()
    const sid = 'task-checklist-regression'
    const time = Date.now()
    const call = (n: number, name: 'TaskCreate' | 'TaskUpdate', input: Record<string, unknown>) => claude.planCall(sid, git.repoA, time + n, name, input, `task-call-${n}`)
    const result = (n: number, value: Record<string, unknown>) => claude.planResult(sid, git.repoA, time + n + 1, `task-call-${n}`, value)
    writeClaudeSession(claudeHome, git.repoA, sid, [
      claude.title(sid, 'Track Claude task steps'),
      call(0, 'TaskCreate', { subject: 'Inspect task format' }), result(0, { task: { id: '7', subject: 'Inspect task format' } }),
      call(10, 'TaskCreate', { subject: 'Verify live checklist' }), result(10, { task: { id: '12', subject: 'Verify live checklist' } }),
      call(20, 'TaskUpdate', { taskId: '7', status: 'completed' }), result(20, { success: true, taskId: '7', updatedFields: ['status'], statusChange: { from: 'pending', to: 'completed' } }),
    ])
    await pair(page)
    const card = row(page, /^Track Claude task steps/)
    const pill = card.getByRole('button', { name: /^Checklist of Track Claude task steps/ })
    await expect(pill).toHaveText('1/2')
    await pill.click()
    const list = page.getByRole('dialog', { name: 'Checklist of Track Claude task steps' })
    await expect(list).toContainText('Claude Code tasks')
    await expect(list.getByRole('checkbox', { name: /Inspect task format/ })).toBeChecked()
    await expect(list.getByRole('checkbox', { name: /Verify live checklist/ })).not.toBeChecked()
    writeClaudeSession(claudeHome, git.repoA, sid, [
      call(30, 'TaskUpdate', { taskId: '12', status: 'completed' }), result(30, { success: true, taskId: '12', updatedFields: ['status'], statusChange: { from: 'pending', to: 'completed' } }),
    ])
    await expect(pill).toHaveText('2/2', { timeout: 10_000 })
    await list.getByRole('checkbox', { name: /Inspect task format/ }).uncheck()
    await expect(pill).toHaveText('1/2')
    await expect(list).toContainText('unticked by you')
    await page.keyboard.press('Escape')
    await openCard(page, 'Track Claude task steps')
    await expect(details(page).getByRole('region', { name: 'Agent plan' })).toContainText('Claude Code tasks')
  })

  test('hovering an agent card on the timeline shows the same agent details as the list', async ({ page }) => {
    await pair(page)
    const cards = board(page, 'git-status-kit').getByRole('group', { name: 'Agents on the timeline of git-status-kit' })
    await hoverInLanes(page, cards.locator('[data-bar-label]', { hasText: 'Tighten status parser' }).getByText('Tighten status parser'))
    const hover = page.getByRole('dialog', { name: 'Agent details' })
    await expect(hover).toContainText('Last activity')
    await expect(hover.getByRole('button', { name: /change review state of Tighten status parser/ })).toBeVisible()
  })

  test('hover cards stay where they opened while the pointer moves inside the item', async ({ page }) => {
    await pair(page)
    const label = row(page, /^Tighten status parser/).getByText('Tighten status parser', { exact: true })
    await label.hover()
    const hover = page.getByRole('dialog', { name: 'Agent details' })
    await expect(hover).toBeVisible()
    const before = await hover.boundingBox()
    const box = (await label.boundingBox())!
    await page.mouse.move(box.x + 3, box.y + box.height / 2, { steps: 4 })
    expect(await hover.boundingBox()).toEqual(before)
  })

  test('hiding an agent is a view filter: it disappears from this view only and comes back', async ({ page }) => {
    await pair(page)
    const card = row(page, /^Document worktree states/)
    await card.getByRole('button', { name: /change review state/ }).click()
    await page.getByRole('menu', { name: 'Review state of Document worktree states' }).getByRole('menuitem', { name: 'Hide from this view' }).click()
    await expect(card).toBeHidden()
    await expect(dropdown(page, 'Hidden')).toHaveAccessibleName('Hidden: 1 by hand')
    await dropdown(page, 'Hidden').click()
    const panel = page.getByRole('dialog', { name: 'Hidden' })
    await expect(panel.getByRole('list', { name: 'Agents hidden by hand' })).toContainText('Document worktree states')
    // Hiding by review state.
    await panel.getByRole('checkbox', { name: 'Unreviewed' }).check()
    await expect(row(page, /^Tighten status parser/)).toBeHidden()
    await panel.getByRole('checkbox', { name: 'Unreviewed' }).uncheck()
    await panel.getByRole('button', { name: 'Show all 1' }).click()
    await page.keyboard.press('Escape')
    await expect(card).toBeVisible()
    await expect(card.getByRole('button', { name: /change review state/ })).toHaveText('Unreviewed')
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
    await expect(board(page, 'git-status-kit')).toBeVisible()
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
    await runMenu(page, 'View', 'Reset layout')
    await expect(repos).toBeVisible()
    await expect(details(page)).toBeVisible()
    await runMenu(page, 'View', 'Maximize view')
    await expect(repos).toBeHidden()
    await runMenu(page, 'View', 'Maximize view')
    await expect(repos).toBeVisible()
    await setOption(page, 'Timeline', 'Commit order')
  })

  test('agent labels on the timeline and names in the list toggle independently', async ({ page }) => {
    await pair(page)
    const cards = board(page, 'git-status-kit').getByRole('group', { name: 'Agents on the timeline of git-status-kit' })
    const label = cards.locator('[data-bar-label^="claude:c3d2e4f6"]').first()
    await expect(label).toContainText('Claude session c3d2e4f6')
    await expect(label).toContainText('Working')
    // The card at the end of the work carries the same status menu as the card in the list.
    const idle = cards.locator('[data-bar-label]', { hasText: 'Document worktree states' })
    const menu = page.getByRole('menu', { name: 'Review state of Document worktree states' })
    await idle.getByRole('button', { name: 'Unreviewed: change review state of Document worktree states' }).click()
    await menu.getByRole('menuitemradio', { name: 'Needs review' }).click()
    await expect(idle.getByRole('button', { name: /^Needs review: change review state/ })).toBeVisible()
    await expect(row(page, /^Document worktree states/)).toContainText('Needs review')
    await idle.getByRole('button', { name: /change review state/ }).click()
    await menu.getByRole('menuitemradio', { name: 'Unreviewed' }).click()
    await expect(idle).toContainText('Unreviewed')
    const parent = row(page, /^Claude session c3d2e4f6, Claude Code agent/)
    const before = (await parent.boundingBox())!.width

    // Names only on the timeline: the column narrows, cards keep their status menu and stay named for assistive tech.
    await setOption(page, 'Agents', 'Agent names in list', false)
    await expect(parent).not.toContainText('Claude session c3d2e4f6')
    await expect(parent.getByRole('button', { name: /change review state/ })).toBeVisible()
    expect((await parent.locator('[class*="label"]').first().boundingBox())!.width).toBeLessThan(before)
    await expect(label).toBeVisible()

    // Names only in the list.
    await setOption(page, 'Agents', 'Agent names in list')
    await setOption(page, 'Agents', 'Agent labels on timeline', false)
    await expect(board(page, 'git-status-kit').locator('[data-bar-label]')).toHaveCount(0)
    await expect(parent).toContainText('Claude session c3d2e4f6')
    await setOption(page, 'Agents', 'Agent labels on timeline')
  })

  test('dragging with the mouse pans the view like a map; a plain click still selects', async ({ page }) => {
    await pair(page)
    const scroller = page.getByLabel(/^Branches and agents\. Use the arrow keys/)
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Zoom in' }).click()
    const at = () => scroller.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }))
    const before = await at()
    const box = (await scroller.boundingBox())!
    const x = box.x + box.width - 80
    const y = box.y + box.height - 60
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 150, y - 100, { steps: 10 })
    await expect(scroller).toHaveAttribute('data-panning', '')
    await page.mouse.up()
    const after = await at()
    expect(Math.abs(after.left - (before.left - 150))).toBeLessThanOrEqual(2)
    expect(Math.abs(after.top - (before.top + 100))).toBeLessThanOrEqual(2)
    await expect(scroller).not.toHaveAttribute('data-panning', '')
    // The drag did not select anything; a click still does.
    await expect(details(page)).toContainText('Select an agent card')
    await openCard(page, 'Tighten status parser')
    await expect(details(page).getByRole('heading', { name: 'Tighten status parser' })).toBeVisible()
    await page.getByRole('button', { name: /^Zoom \d+%, reset$/ }).click()
  })

  test('the history zooms horizontally', async ({ page }) => {
    await pair(page)
    const svg = board(page, 'git-status-kit').locator('svg[data-lanes]')
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
    const more = board(page, 'storefront-web').getByRole('listitem', { name: /^Show \d+ more agents/ })
    await expect(more).toBeVisible()
    await more.click()
    await expect(more).toBeHidden()
    expect(await board(page, 'storefront-web').getByRole('listitem', { name: /Bulk session/ }).count()).toBeGreaterThan(300)
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

  test('settings: turning off message excerpts removes them from agent details', async ({ page }) => {
    await pair(page)
    await openCard(page, 'Document worktree states')
    await expect(details(page)).toContainText('synthetic answer')
    await runMenu(page, 'File', 'Settings')
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByLabel('Show latest message excerpts on agent cards').uncheck()
    await settings.getByRole('button', { name: 'Save settings' }).click()
    await expect(details(page)).not.toContainText('synthetic answer', { timeout: 15_000 })
    await runMenu(page, 'File', 'Settings')
    await settings.getByLabel('Show latest message excerpts on agent cards').check()
    await settings.getByRole('button', { name: 'Save settings' }).click()
  })

  test('diagnostics report adapters without transcript text', async ({ page }) => {
    await pair(page)
    await runMenu(page, 'File', 'Diagnostics')
    const diag = page.getByRole('dialog', { name: 'Diagnostics' })
    await expect(diag.getByRole('cell', { name: 'Claude Code' })).toBeVisible()
    await expect(diag).not.toContainText('synthetic prompt')
    await page.keyboard.press('Escape')
  })

  test('views: several named dashboards, each with its own repositories', async ({ page }) => {
    await pair(page)
    await expect(view(page, 'View 0')).toBeVisible()
    await runMenu(page, 'View', 'Open new view')
    await expect(view(page, 'View 1')).toBeVisible()
    // The repository panel lists every repository; its ticks are the current view's selection.
    await page.getByRole('checkbox', { name: 'Show storefront-web in View 1' }).uncheck()
    await expect(view(page, 'View 1').getByRole('region', { name: 'storefront-web repository' })).toBeHidden()
    await expect(view(page, 'View 1').getByRole('button', { name: 'Repositories: 1 of 2' })).toBeVisible()
    await viewTab(page, 'View 0').click()
    await expect(view(page, 'View 0').getByRole('region', { name: 'storefront-web repository' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Show storefront-web in View 0' })).toBeChecked()

    // Renaming View 0 frees its number for the next new view.
    await page.keyboard.press('Control+K')
    await page.getByRole('dialog', { name: 'Search commands' }).getByRole('combobox').fill('rename view')
    await page.keyboard.press('Enter')
    const rename = page.getByRole('dialog', { name: 'Rename view' })
    await rename.getByLabel('Name').fill('View main')
    await rename.getByLabel('Name').press('Enter')
    await expect(view(page, 'View main')).toBeVisible()
    await runMenu(page, 'View', 'Open new view')
    await expect(view(page, 'View 0')).toBeVisible()

    // Names, settings and the arrangement survive a reload.
    await page.reload()
    await viewTab(page, 'View 1').click()
    await expect(view(page, 'View 1').getByRole('region', { name: 'git-status-kit repository' })).toBeVisible()
    await expect(view(page, 'View 1').getByRole('region', { name: 'storefront-web repository' })).toBeHidden()

    // Views close from their tabs, except the last one.
    for (const name of ['View 1', 'View 0']) await viewTab(page, name).locator('.flexlayout__tab_button_trailing').click()
    await expect(viewTab(page, 'View main')).toBeVisible()
    await viewTab(page, 'View main').locator('.flexlayout__tab_button_trailing').click()
    await expect(page.getByText('The last view cannot be closed.')).toBeVisible()
    await expect(view(page, 'View main')).toBeVisible()
  })

  test('File → Export writes annotations and views; Open reads them back', async ({ page }) => {
    await pair(page)
    const download = page.waitForEvent('download')
    await runMenu(page, 'File', 'Export')
    const file = await (await download).path()
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { format: string; annotations: { annotations: unknown[] }; workbench: { views: Array<{ name: string }> } }
    expect(data.format).toBe('repobs-export')
    expect(data.annotations.annotations.length).toBeGreaterThan(0)
    expect(data.workbench.views.map((v) => v.name)).toEqual(['View 0'])
    expect(JSON.stringify(data)).not.toContain('synthetic answer') // no transcript content

    // Opening a file with another view replaces the views.
    data.workbench.views = [{ ...data.workbench.views[0]!, name: 'Imported' }]
    const chooser = page.waitForEvent('filechooser')
    await runMenu(page, 'File', 'Open')
    await (await chooser).setFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) })
    await expect(page.getByText(/1 view opened/)).toBeVisible()
    await expect(view(page, 'Imported')).toBeVisible()
  })

  test('automation: a rule changes the annotations of the agents it matches', async ({ page }) => {
    await pair(page)
    await runMenu(page, 'View', 'Automation panel')
    const panel = page.getByRole('complementary', { name: 'Automation panel' })
    await expect(panel.getByText('No rules yet.', { exact: false })).toBeVisible()
    await panel.getByRole('button', { name: 'New rule' }).click()
    const editor = panel.getByRole('form', { name: 'New rule' })
    await editor.getByLabel('Name').fill('Flag merge work')
    await editor.getByLabel('Condition 1', { exact: true }).selectOption('text')
    await editor.getByLabel('Condition 1 text').fill('merge plan')
    await editor.getByLabel('Action 1', { exact: true }).selectOption('set_review')
    await editor.getByLabel('Action 1 review state').selectOption('flagged')
    await editor.getByRole('button', { name: 'Add action' }).click()
    await editor.getByLabel('Action 2', { exact: true }).selectOption('add_tag')
    await editor.getByLabel('Action 2 tag').fill('merge')
    await expect(editor).toContainText('Matches 1 agent')
    await expect(editor.getByTitle('Resolve merge plan')).toBeVisible()
    await editor.getByRole('button', { name: 'Create rule' }).click()

    const rules = panel.getByRole('list', { name: 'Automation rules' })
    await expect(rules).toContainText('When title contains “merge plan”: set review state to flagged, add tag “merge”.')
    await expect(rules).toContainText('applied to 1')
    const card = row(page, /^Resolve merge plan/)
    await expect(card.getByRole('button', { name: /change review state/ })).toHaveText('Flagged')

    // Your own change afterwards sticks; the details name the rule.
    await card.getByRole('button', { name: /change review state/ }).click()
    await page.getByRole('menu', { name: 'Review state of Resolve merge plan' }).getByRole('menuitemradio', { name: 'Reviewed', exact: true }).click()
    await expect(card.getByRole('button', { name: /change review state/ })).toHaveText('Reviewed')
    await openCard(page, 'Resolve merge plan')
    await expect(details(page)).toContainText('Automation applied: “Flag merge work”')
    await page.reload()
    await expect(row(page, /^Resolve merge plan/).getByRole('button', { name: /change review state/ })).toHaveText('Reviewed')

    // Deleting the rule keeps what it did.
    await runMenu(page, 'View', 'Automation panel')
    await panel.getByRole('button', { name: 'Delete rule Flag merge work' }).click()
    await panel.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(panel.getByText('No rules yet.', { exact: false })).toBeVisible()
  })

  test('a folder without Git is offered as a folder and shows its agents without commits (ADR 0010)', async ({ page }) => {
    const folder = path.join(state().root, 'scratch-notes')
    const quiet = path.join(state().root, 'quiet-notes')
    for (const dir of [folder, quiet]) fs.mkdirSync(dir, { recursive: true })
    const id = 'f0f0f0f0-6666-4aaa-8bbb-000000000006'
    writeClaudeSession(state().claudeHome, folder, id, [claude.title(id, 'Tidy meeting notes'), claude.endTurn(id, folder, Date.now() - 5 * 60_000)])
    await pair(page)
    // The dialog asks for suggestions when it opens: wait until the new session has been discovered.
    await expect
      .poll(async () => JSON.stringify(await (await page.request.get('/api/v1/repositories/suggestions')).json()), { timeout: 15_000 })
      .toContain('scratch-notes')
    await page.getByRole('complementary', { name: 'Repositories panel' }).getByRole('button', { name: 'Add', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add repositories or folders' })
    // The session's working directory is suggested as a folder.
    const suggested = dialog.getByRole('list', { name: 'Repositories and folders to add' }).getByRole('listitem').filter({ hasText: 'scratch-notes' })
    await expect(suggested).toContainText('folder')
    await suggested.getByRole('checkbox').check()
    // A typed path is tried as a repository; Git's refusal is shown with the choice, never a silent fallback.
    await dialog.getByLabel('Local repository or folder path').fill(quiet)
    await dialog.getByRole('button', { name: 'Add to list' }).click()
    await dialog.getByRole('button', { name: 'Add 1 repository and 1 folder' }).click()
    await expect(dialog.getByRole('alert')).toContainText('Not a Git repository')
    await dialog.getByRole('button', { name: 'Add as folder' }).click()
    await dialog.getByRole('button', { name: 'Add folder', exact: true }).click()
    await expect(dialog).toBeHidden()

    const b = board(page, 'scratch-notes')
    await expect(b.locator('header')).toContainText('folder')
    await expect(b.getByRole('listitem', { name: /^Folder without Git/ })).toBeVisible()
    await expect(b.getByText('Tidy meeting notes').first()).toBeVisible()
    expect(await b.locator('svg[data-lanes] circle').count()).toBe(0)
    await expect(board(page, 'quiet-notes').getByRole('listitem', { name: /^Folder without Git/ })).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Repositories panel' }).getByLabel('Folder without Git')).toHaveCount(2)
    await expect(page.getByRole('contentinfo')).toContainText('2 repos • 2 folders • 8 worktrees')
    // Nothing was written into the folders.
    expect(fs.readdirSync(folder)).toEqual([])
    expect(fs.readdirSync(quiet)).toEqual([])
  })

  test('removing a repository only removes it from repobs', async ({ page }) => {
    await pair(page)
    await page.getByRole('button', { name: 'Remove storefront-web from repobs' }).click()
    const dialog = page.getByRole('dialog', { name: 'Remove repository from repobs' })
    await expect(dialog).toContainText('no files, branches or worktrees are deleted')
    const top = async () => (await page.getByRole('main').first().boundingBox())?.y
    const before = await top()
    await dialog.getByRole('button', { name: 'Remove from repobs' }).click()
    await expect(board(page, 'storefront-web')).toBeHidden()
    // The confirmation floats over the workbench: the dashboard does not move down for it.
    await expect(page.getByRole('status').filter({ hasText: 'storefront-web was removed from repobs' })).toBeVisible()
    expect(await top()).toBe(before)
    expect(fs.existsSync(path.join(state().git.repoB, 'b.txt'))).toBe(true)
  })
})
