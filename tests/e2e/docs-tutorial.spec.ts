import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, type Locator, test } from '@playwright/test'
// @ts-expect-error -- plain ESM helper shared with the launcher scripts
import { mintPairingToken } from '../../scripts/lib.mjs'
import { claude, writeClaudeSession } from '../../fixtures/session-fixtures.ts'
import { readE2EState } from './state.ts'

// Regenerates the tutorial's pictures (docs/assets/tutorial/<name>.png and <name>-dark.png) from the
// real app on synthetic demo data: the steps a reader follows, in the order of the tutorial.
// Run alone:  REPOBS_DOCS_SCREENSHOT=1 npx playwright test docs-tutorial
// With REPOBS_DOCS_SCREENSHOT=check it walks the same steps without taking pictures: CI runs it so
// a tutorial step that no longer works in the app fails the build (AGENTS.md).
test.skip(!process.env.REPOBS_DOCS_SCREENSHOT, 'documentation screenshots only on request')
const CHECK_ONLY = process.env.REPOBS_DOCS_SCREENSHOT === 'check'
test.setTimeout(240_000)

const OUT = path.resolve('docs/assets/tutorial')
const PAD = 12

test('tutorial screenshots', async ({ page }) => {
  const state = readE2EState(Number(process.env.REPOBS_E2E_PORT ?? 47399))
  if (!CHECK_ONLY) fs.mkdirSync(OUT, { recursive: true })

  // Synthetic material the demo lacks: a folder without Git with one agent, and an agent with a
  // long working history (tools of every kind, Git commands, tests, thinking and token counts).
  const notes = path.join(state.root, 'meeting-notes')
  fs.mkdirSync(notes, { recursive: true })
  const nid = 'f1e2d3c4-6666-4aaa-8bbb-000000000006'
  writeClaudeSession(state.claudeHome, notes, nid, [claude.title(nid, 'Tidy meeting notes'), claude.prompt(nid, notes, Date.now() - 50 * 60_000), claude.endTurn(nid, notes, Date.now() - 45 * 60_000)])
  writeClaudeSession(state.claudeHome, state.git.repoA, RICH_ID, richHistory(state.git.repoA))

  // Pictures: the window, or the area around some elements, in light then dark.
  // Temporary-folder paths (shown in full, or from the profile folder as ~\...) become the usual
  // places; the fixtures' placeholder reply reads as one an agent would write.
  const tilde = `~${state.root.slice(os.homedir().length)}`
  const swaps: Array<[string, string]> = [
    ...[state.root, tilde].flatMap((r): Array<[string, string]> => [
      [path.join(r, 'repobs-data'), '%LOCALAPPDATA%\\repobs'],
      [path.join(r, 'claude-home'), '~\\.claude'],
      [path.join(r, 'codex-home'), '~\\.codex'],
      [path.join(r, 'src'), 'C:\\src'],
      [r, 'C:\\src'],
    ]),
    ['synthetic answer', 'Done: the parser handles detached HEAD and the tests pass.'],
  ]
  const sanitize = () =>
    page.evaluate((pairs) => {
      const fix = (s: string) => pairs.reduce((t, [from, to]) => t.split(from).join(to), s)
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue && fix(n.nodeValue) !== n.nodeValue) n.nodeValue = fix(n.nodeValue)
      for (const el of document.querySelectorAll('[title]')) el.setAttribute('title', fix(el.getAttribute('title') ?? ''))
      for (const el of document.querySelectorAll('input')) if (fix(el.value) !== el.value) el.value = fix(el.value)
    }, swaps)
  type Clip = { x: number; y: number; width: number; height: number }
  /** A picture of the window, or of the area around some elements (`pad` px around; `fullWidth`). */
  const shoot = async (name: string, around: Locator[] = [], { pad = PAD, fullWidth = false, clip: given }: { pad?: number; fullWidth?: boolean; clip?: Clip } = {}) => {
    await sanitize()
    let clip = given
    if (!clip && around.length) {
      const boxes = (await Promise.all(around.map((l) => l.boundingBox()))).filter((b) => b !== null)
      const vp = page.viewportSize()!
      const x = fullWidth ? 0 : Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad)
      const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad)
      const right = fullWidth ? vp.width : Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad)
      const bottom = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad)
      clip = { x, y, width: right - x, height: bottom - y }
    }
    // Checking: every element pictured is there and has a size; no pictures are written.
    if (CHECK_ONLY) return expect(clip === undefined || (clip.width > 0 && clip.height > 0)).toBe(true)
    await page.screenshot({ path: path.join(OUT, `${name}.png`), clip, animations: 'disabled' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot({ path: path.join(OUT, `${name}-dark.png`), clip, animations: 'disabled' })
    await page.emulateMedia({ colorScheme: 'light' })
  }
  // Away from everything: hover cards close (interactive ones after a short delay).
  const rest = async () => {
    await page.mouse.move(2, 400)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expect(page.getByRole('dialog', { name: 'Agent details' })).toBeHidden()
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  }
  const menu = (name: string) => page.getByRole('menu', { name })
  const openMenu = async (name: string) => {
    await page.getByRole('button', { name, exact: true }).click()
    return menu(`${name} menu`)
  }
  const dropdown = (label: string) => page.getByRole('button', { name: new RegExp(`^${label}(:|$)`) })
  const scroller = page.getByLabel(/^Branches and agents\. Use the arrow keys/)
  const panel = page.getByRole('complementary', { name: 'Details panel' })
  const row = (name: RegExp) => page.getByRole('listitem', { name })

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto(`/#pair=${mintPairingToken(state.dataDir) as string}`)

  // 1. Start: the empty dashboard, adding repositories and a folder, the result, Diagnostics.
  await expect(page.getByRole('heading', { name: /Observe your Git worktrees/ })).toBeVisible()
  await rest()
  await shoot('start-empty')
  // The dialog asks for suggestions when it opens: wait until the folder's session has been discovered.
  await expect
    .poll(async () => JSON.stringify(await (await page.request.get('/api/v1/repositories/suggestions')).json()), { timeout: 20_000 })
    .toContain('meeting-notes')
  await page.getByRole('button', { name: 'Add repositories' }).first().click()
  const add = page.getByRole('dialog', { name: /^Add repositories/ })
  await expect(add.getByRole('list', { name: 'Repositories and folders to add' }).getByRole('checkbox')).toHaveCount(3, { timeout: 20_000 })
  await add.getByLabel('Select all').check()
  await shoot('start-add', [add], { pad: 0 })
  await add.getByRole('button', { name: /^Add \d/ }).click()
  await expect(add).toBeHidden()
  await page.getByRole('button', { name: 'Collapse storefront-web' }).click()
  await expect(row(/^Add parser tests/)).toBeVisible({ timeout: 20_000 })
  await scroller.evaluate((el) => (el.scrollTop = 0))
  await rest()
  await shoot('start-dashboard')
  const file = await openMenu('File')
  await file.getByRole('menuitem', { name: 'Diagnostics' }).click()
  const diag = page.getByRole('dialog', { name: 'Diagnostics' })
  await expect(diag).toContainText('Claude Code')
  await shoot('start-diagnostics', [diag], { pad: 0 })
  await page.keyboard.press('Escape')

  // 2. Reading the dashboard: a repository's rows, a commit, quiet commits, the axis, the legend.
  const toolbar = page.getByRole('toolbar', { name: 'Workbench commands' })
  for (const p of ['Repositories panel', 'Details panel']) {
    const t = toolbar.getByRole('button', { name: p })
    if ((await t.getAttribute('aria-pressed')) === 'true') await t.click()
  }
  await scroller.evaluate((el) => (el.scrollTop = 0))
  await rest()
  const kit = page.getByRole('region', { name: 'git-status-kit repository' })
  await shoot('dashboard-repository')
  await scroller.evaluate((el) => (el.scrollLeft = 0))
  const local = kit.locator('svg[data-lanes] circle[class*="local"]').first()
  await local.scrollIntoViewIfNeeded()
  const lb = (await local.boundingBox())!
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2)
  const tip = page.getByRole('tooltip')
  await expect(tip).toBeVisible()
  await shoot('dashboard-commit', [local, tip])
  await rest()
  const branches = dropdown('Branches')
  await branches.click()
  await menu('Branches').getByRole('menuitemcheckbox', { name: 'Collapse quiet commits' }).click()
  await page.keyboard.press('Escape')
  const pill = kit.locator('svg[data-lanes] g[class*="group"]').first()
  await pill.scrollIntoViewIfNeeded()
  const pb = (await pill.boundingBox())!
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2)
  const groupCard = page.getByRole('dialog', { name: 'Commit details' })
  await expect(groupCard).toBeVisible()
  await shoot('dashboard-quiet', [pill, groupCard])
  await rest()
  await dropdown('Timeline').click()
  await shoot('dashboard-timeline', [dropdown('Timeline'), menu('Timeline')])
  await page.keyboard.press('Escape')
  await scroller.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  const sb = (await scroller.boundingBox())!
  const rb = (await kit.locator('[data-row-id]').nth(2).boundingBox())!
  await shoot('dashboard-axis', [], { clip: { x: sb.x, y: sb.y, width: sb.width, height: rb.y + rb.height - sb.y } })
  await page.setViewportSize({ width: 1280, height: 1400 })
  await (await openMenu('Help')).getByRole('menuitem', { name: 'Legend and controls' }).click()
  const legend = page.getByRole('dialog', { name: 'Legend and controls' })
  await shoot('dashboard-legend', [legend], { pad: 0 })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1280, height: 720 })

  // 3. Agents: cards and statuses, a hover card, the details panel and activity, spawned agents,
  // the agent's plan, the Agents options, activity on the line.
  await scroller.evaluate((el) => (el.scrollTop = 0))
  await rest()
  const agentRows = kit.locator('[data-session-id]')
  await shoot('agents-cards', [agentRows.first(), agentRows.nth(5)])
  await row(/^Tighten status parser/).getByText('Tighten status parser', { exact: true }).hover()
  const hover = page.getByRole('dialog', { name: 'Agent details' })
  await expect(hover).toBeVisible()
  await shoot('agents-hover', [row(/^Tighten status parser/), hover])
  await rest()
  await toolbar.getByRole('button', { name: 'Details panel' }).click()
  await row(/^Add parser tests/).getByText('Add parser tests', { exact: true }).click()
  await expect(panel.getByRole('heading', { name: 'Add parser tests' })).toBeVisible()
  const toolsBar = panel.getByRole('button', { name: /^Tools, / })
  await expect(toolsBar).toBeVisible({ timeout: 20_000 })
  await rest()
  await shoot('agents-details', [panel], { pad: 0 })
  await toolsBar.click()
  const activity = panel.locator('section', { has: page.getByText('Activity', { exact: true }) })
  await shoot('agents-activity-amounts', [activity])
  await toolsBar.click()
  await shoot('agents-activity-shares', [activity])
  await toolsBar.click()
  await toolbar.getByRole('button', { name: 'Details panel' }).click()
  const parent = row(/^Claude session c3d2e4f6/)
  await parent.getByRole('button', { name: /spawned/ }).click()
  await expect(row(/^Map the feature module/)).toBeVisible()
  await rest()
  await shoot('agents-spawned', [parent, row(/^Draft the test plan/)])
  await row(/^Tighten status parser/).getByRole('button', { name: /^Checklist of Tighten status parser/ }).click()
  const checklist = page.getByRole('dialog', { name: 'Checklist of Tighten status parser' })
  await expect(checklist.getByRole('region', { name: 'Agent plan' })).toBeVisible()
  await checklist.hover()
  await expect(page.getByRole('dialog', { name: 'Agent details' })).toBeHidden()
  await shoot('agents-plan', [row(/^Tighten status parser/), checklist])
  await page.keyboard.press('Escape')
  await dropdown('Agents').click()
  await shoot('agents-options', [dropdown('Agents'), menu('Agents')])
  await menu('Agents').getByRole('menuitemradio', { name: 'Always' }).click()
  await page.keyboard.press('Escape')
  await dropdown('Timeline').click()
  await menu('Timeline').getByRole('menuitemradio', { name: 'Calendar time' }).click()
  await menu('Timeline').getByRole('menuitemradio', { name: '24 hours' }).click()
  await page.keyboard.press('Escape')
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Zoom in' }).click()
  const line = kit.locator(`svg[data-lanes] g[data-agent$="${RICH_ID}"]`)
  await line.scrollIntoViewIfNeeded()
  await scroller.evaluate((el, left) => (el.scrollLeft += left - el.getBoundingClientRect().left - 420), (await line.boundingBox())!.x)
  await rest()
  await shoot('agents-line', [line, kit.locator('[data-bar-label]', { hasText: 'Add parser tests' })], { pad: 16 })
  await dropdown('Agents').click()
  await menu('Agents').getByRole('menuitemradio', { name: /^Auto/ }).click()
  await page.keyboard.press('Escape')
  await dropdown('Timeline').click()
  await menu('Timeline').getByRole('menuitemradio', { name: 'Commit order' }).click()
  await menu('Timeline').getByRole('menuitemradio', { name: 'All loaded' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Zoom \d+%, reset$/ }).click()

  // 4. Review and notes: the review menu, your notes, filters, hiding, automation.
  await scroller.evaluate((el) => (el.scrollTop = 0))
  // Opened from the keyboard, so no hover card covers it.
  await rest()
  await row(/^Document worktree states/).getByRole('button', { name: /change review state/ }).focus()
  await page.keyboard.press('Enter')
  const review = page.getByRole('menu', { name: /^Review state of Document worktree states/ })
  await expect(review).toBeVisible()
  await shoot('review-menu', [row(/^Document worktree states/), review])
  await review.getByRole('menuitemradio', { name: 'Reviewed', exact: true }).click()
  await toolbar.getByRole('button', { name: 'Details panel' }).click()
  await row(/^Review ref grouping/).getByText('Review ref grouping', { exact: true }).click()
  await panel.getByRole('combobox', { name: 'Tags' }).fill('needs-tests')
  await panel.getByRole('combobox', { name: 'Tags' }).press('Enter')
  await panel.getByLabel('Notes').fill('Check the remote-only refs against git branch -a.')
  await panel.getByLabel('New checklist item').fill('Compare with a fresh clone')
  await panel.getByLabel('New checklist item').press('Enter')
  await expect(panel.locator('[data-save]')).toHaveAttribute('data-save', 'saved')
  await rest()
  const notesSection = panel.locator('section', { has: page.getByText('Your notes', { exact: true }) })
  await notesSection.scrollIntoViewIfNeeded()
  await shoot('review-notes', [notesSection], { pad: 0 })
  await toolbar.getByRole('button', { name: 'Details panel' }).click()
  await dropdown('Status').click()
  await shoot('review-status-filter', [dropdown('Status'), menu('Status')])
  await page.keyboard.press('Escape')
  await row(/^Resolve merge plan/).getByRole('button', { name: /change review state/ }).click()
  await page.getByRole('menu', { name: /^Review state of Resolve merge plan/ }).getByRole('menuitem', { name: 'Hide from this view' }).click()
  await dropdown('Hidden').click()
  await shoot('review-hidden', [dropdown('Hidden'), page.getByRole('dialog', { name: 'Hidden' }).or(menu('Hidden'))])
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Alt+U')
  const automation = page.getByRole('complementary', { name: 'Automation panel' })
  await expect(automation).toBeVisible()
  await rest()
  await shoot('review-automation', [automation.getByText('Automation', { exact: true }), automation.getByRole('button', { name: /^Ask for review/ })], { pad: 8 })
  await page.keyboard.press('Control+Alt+U')

  // 5. Workspace: views, the command palette, the menus, settings, the repositories panel.
  await page.keyboard.press('Control+Alt+N')
  await expect(page.locator('.flexlayout__tab_button', { hasText: /^View 1$/ })).toBeVisible()
  await rest()
  await shoot('workspace-views')
  await page.keyboard.press('Control+K')
  const palette = page.getByRole('dialog', { name: 'Search commands' })
  await palette.getByRole('combobox').fill('zoom')
  await shoot('workspace-palette', [palette], { pad: 0 })
  await page.keyboard.press('Escape')
  await shoot('workspace-file-menu', [page.getByRole('button', { name: 'File', exact: true }), await openMenu('File')])
  await page.keyboard.press('Escape')
  await shoot('workspace-view-menu', [page.getByRole('button', { name: 'View', exact: true }), await openMenu('View')])
  await page.keyboard.press('Escape')
  await shoot('workspace-help-menu', [page.getByRole('button', { name: 'Help', exact: true }), await openMenu('Help')])
  await page.keyboard.press('Escape')
  await (await openMenu('File')).getByRole('menuitem', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByText('Appearance')).toBeVisible()
  await shoot('workspace-settings', [settings], { pad: 0 })
  await page.keyboard.press('Escape')
  await toolbar.getByRole('button', { name: 'Repositories panel' }).click()
  const repos = page.getByRole('complementary', { name: 'Repositories panel' })
  await rest()
  await shoot('workspace-repositories', [repos.getByText('Repositories', { exact: true }), repos.getByText('meeting-notes')], { pad: 8 })
})

const RICH_ID = 'a7b6c5d4-7777-4aaa-8bbb-000000000007'

/**
 * A synthetic Claude Code history of about two hours in four turns: reads and searches, edits,
 * shell commands (Git, tests), responses with thinking, token usage growing with the context.
 */
function richHistory(cwd: string): unknown[] {
  const now = Date.now()
  const out: unknown[] = [claude.title(RICH_ID, 'Add parser tests')]
  const common = (at: number) => ({ sessionId: RICH_ID, cwd, timestamp: new Date(at).toISOString(), version: '2.1.286', gitBranch: 'main', userType: 'external', entrypoint: 'cli', isSidechain: false, uuid: `${RICH_ID}-${at}` })
  const tools: Array<[string, Record<string, unknown>]> = [
    ['Read', { file_path: 'src/parser.ts' }],
    ['Grep', { pattern: 'detached' }],
    ['Read', { file_path: 'src/status.ts' }],
    ['Bash', { command: 'git status' }],
    ['Edit', { file_path: 'src/parser.ts' }],
    ['Edit', { file_path: 'tests/parser.test.ts' }],
    ['Bash', { command: 'npm test' }],
    ['Edit', { file_path: 'src/parser.ts' }],
    ['Bash', { command: 'npm test' }],
    ['Bash', { command: 'git diff' }],
    ['Bash', { command: 'git commit -m "Parse detached HEAD"' }],
  ]
  let context = 18_000
  let n = 0
  const turns = [130, 95, 60, 25] // minutes ago
  for (const [ti, start] of turns.entries()) {
    let at = now - start * 60_000
    out.push({ ...common(at), type: 'user', message: { role: 'user', content: 'synthetic prompt' } })
    for (const [name, input] of tools.slice(0, 4 + ti * 2 + (ti === 3 ? 1 : 0))) {
      at += 20_000 + ((n * 7919) % 40_000)
      context += 2_500
      n++
      out.push({
        ...common(at),
        type: 'assistant',
        message: {
          id: `msg-${n}`,
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [...(n % 3 === 0 ? [{ type: 'thinking', thinking: '' }] : []), { type: 'tool_use', id: `tool-${n}`, name, input }],
          usage: { input_tokens: 40, cache_read_input_tokens: context - 2_000, cache_creation_input_tokens: 1_960, output_tokens: 300 + (n % 5) * 120 },
        },
      })
      at += 4_000 + ((n * 104_729) % 50_000)
      out.push({ ...common(at), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tool-${n}`, content: 'synthetic output', is_error: name === 'Bash' && n === 7 }] } })
    }
    at += 15_000
    out.push({
      ...common(at),
      type: 'assistant',
      message: { id: `msg-end-${ti}`, role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'synthetic answer' }], usage: { input_tokens: 30, cache_read_input_tokens: context, cache_creation_input_tokens: 0, output_tokens: 420 } },
    })
  }
  return out
}

