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
  await expect(page.getByRole('button', { name: 'Add repository' }).first()).toBeVisible()
}

const tree = (page: Page) => page.getByRole('tree')
const item = (page: Page, name: string | RegExp) => tree(page).getByRole('treeitem', { name })

test.describe.serial('repobs workbench (synthetic data)', () => {
  test('an unpaired browser gets instructions, not data', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'This browser is not paired with repobs' })).toBeVisible()
    const res = await page.request.get('/api/v1/snapshot')
    expect(res.status()).toBe(401)
  })

  test('first launch shows a real empty state; registering repositories fills the tree', async ({ page }) => {
    await pair(page)
    await expect(page.getByRole('heading', { name: /Observe your Git worktrees/ })).toBeVisible()
    await expect(page.getByText('0 repos')).toBeVisible()

    for (const repoPath of [state().git.worktrees.feature, state().git.repoB]) {
      await page.getByRole('button', { name: 'Add repository' }).first().click()
      const dialog = page.getByRole('dialog', { name: 'Add repository' })
      await dialog.getByLabel('Local repository path').fill(repoPath)
      await dialog.getByRole('button', { name: 'Add repository' }).click()
      await expect(dialog).toBeHidden()
    }
    await expect(item(page, 'repo-a repository')).toBeVisible()
    await expect(item(page, 'repo-b repository')).toBeVisible()
    await expect(item(page, /^main branch/).first()).toBeVisible()
    await expect(item(page, /Tighten status parser/)).toBeVisible()
    await expect(item(page, /Review ref grouping/)).toBeVisible()
    await expect(tree(page).getByRole('treeitem', { name: /^conflict worktree/ })).toContainText('merge')
    await expect(page.getByText('2 repos')).toBeVisible()
  })

  test('duplicate and invalid registrations are explained', async ({ page }) => {
    await pair(page)
    await page.getByRole('button', { name: 'Add repository' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Add repository' })
    await dialog.getByLabel('Local repository path').fill(state().git.repoA)
    await dialog.getByRole('button', { name: 'Add repository' }).click()
    await expect(dialog.getByRole('alert')).toContainText('already registered')
    await dialog.getByLabel('Local repository path').fill(path.join(state().root, 'nowhere'))
    await dialog.getByRole('button', { name: 'Add repository' }).click()
    await expect(dialog.getByRole('alert')).toContainText('does not exist')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('the tree is fully keyboard operable', async ({ page }) => {
    await pair(page)
    const first = item(page, 'repo-a repository')
    await first.click()
    await expect(page.getByRole('heading', { level: 1, name: 'repo-a' })).toBeVisible()
    await page.keyboard.press('ArrowDown') // main
    await page.keyboard.press('ArrowDown') // primary worktree
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1, name: 'repo-a' })).toBeVisible()
    await expect(page.getByText('Primary worktree')).toBeVisible()
    await page.keyboard.press('ArrowLeft') // collapse the worktree
    await expect(item(page, /Tighten status parser/)).toBeHidden()
    await page.keyboard.press('ArrowRight') // expand again
    await expect(item(page, /Tighten status parser/)).toBeVisible()
    await page.keyboard.press('Shift+F10')
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'Copy worktree path' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await page.keyboard.press('Home')
    await expect(first).toBeFocused()
  })

  test('long session lists are virtualized and still navigable', async ({ page }) => {
    await pair(page)
    const total = await page.evaluate(async () => (await (await fetch('/api/v1/snapshot')).json()).sessions.length)
    expect(total).toBeGreaterThan(350)
    const rendered = await tree(page).getByRole('treeitem').count()
    expect(rendered).toBeLessThan(total)
    await item(page, 'repo-a repository').focus()
    await page.keyboard.press('End')
    await expect(tree(page).getByRole('treeitem').last()).toBeFocused()
  })

  test('session status shows evidence; annotations save, collapse when done, and survive reload', async ({ page }) => {
    await pair(page)
    await item(page, /Review ref grouping/).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Review ref grouping' })).toBeVisible()
    await expect(page.getByText('Inferred from local session records')).toBeVisible()

    const notes = page.getByRole('complementary', { name: 'Inspector' })
    await notes.getByRole('radio', { name: 'Flagged' }).click()
    await notes.getByLabel('Tags').fill('needs-tests')
    await notes.getByLabel('Tags').press('Enter')
    await notes.getByLabel('Scratch note').fill('<img src=x onerror=alert(1)> check this literally')
    await notes.getByLabel('New checklist item').fill('Verify fixture coverage')
    await notes.getByLabel('New checklist item').press('Enter')
    await expect(notes.getByText(/^Saved /)).toBeVisible()
    await notes.getByRole('checkbox', { name: 'Verify fixture coverage' }).click() // collapses on completion
    await expect(notes.getByText('All 1 checklist item complete')).toBeVisible()
    await expect(notes.getByRole('checkbox', { name: 'Verify fixture coverage' })).toBeHidden()
    await expect(notes.getByText(/^Saved /)).toBeVisible()

    await page.reload()
    await expect(notes.getByLabel('Scratch note')).toHaveValue('<img src=x onerror=alert(1)> check this literally')
    await expect(notes.getByRole('radio', { name: 'Flagged' })).toHaveAttribute('aria-checked', 'true')
    await notes.getByRole('button', { name: 'Show completed' }).click()
    await expect(notes.getByRole('checkbox', { name: 'Verify fixture coverage' })).toBeChecked()
    await expect(item(page, /Review ref grouping/)).toContainText('Flagged')
  })

  test('two sessions on one worktree keep independent notes', async ({ page }) => {
    await pair(page)
    const notes = page.getByRole('complementary', { name: 'Inspector' })
    await item(page, /Tighten status parser/).click()
    await notes.getByLabel('Scratch note').fill('note for the parser session')
    await expect(notes.getByText(/^Saved /)).toBeVisible()
    await item(page, /Document worktree states/).click()
    await expect(notes.getByLabel('Scratch note')).toHaveValue('')
    await item(page, /Tighten status parser/).click()
    await expect(notes.getByLabel('Scratch note')).toHaveValue('note for the parser session')
  })

  test('external Git and agent changes appear without a browser refresh', async ({ page }) => {
    await pair(page)
    const unicode = tree(page).getByRole('treeitem', { name: /^wt ü space worktree/ })
    await expect(unicode).toContainText('clean')
    fs.writeFileSync(path.join(state().git.worktrees.unicode, 'from-outside.txt'), 'x')
    await expect(unicode).toContainText('?1', { timeout: 15_000 })

    const cwd = state().git.repoB
    const { writeClaudeSession } = await import('../../fixtures/session-fixtures.ts')
    writeClaudeSession(state().claudeHome, cwd, 'live0000-0000-4000-8000-000000000001', [
      claude.title('live0000-0000-4000-8000-000000000001', 'Started after repobs'),
      claude.prompt('live0000-0000-4000-8000-000000000001', cwd, Date.now()),
    ])
    // repo-b holds hundreds of sessions (virtualized), so narrow the tree to the new one.
    await page.getByLabel('Filter the tree').fill('Started after')
    await expect(item(page, /Started after repobs/)).toBeVisible({ timeout: 15_000 })
    await expect(item(page, /Started after repobs/)).toContainText('Running')
    await page.getByLabel('Filter the tree').fill('')
  })

  test('the attention filter narrows the tree to what needs a human', async ({ page }) => {
    await pair(page)
    await page.getByRole('radio', { name: 'Attention' }).click()
    await expect(item(page, /Add rename detection test/)).toBeVisible() // approval request recorded
    await expect(item(page, /Review ref grouping/)).toBeVisible() // flagged by the user
    await expect(item(page, /Document worktree states/)).toBeHidden()
    await page.getByRole('radio', { name: 'All' }).click()
    await page.getByLabel('Filter the tree').fill('needs-tests')
    await expect(item(page, /Review ref grouping/)).toBeVisible()
    await expect(item(page, /Tighten status parser/)).toBeHidden()
    await page.getByLabel('Filter the tree').fill('')
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
    const settings = await page.evaluate(async () => (await (await fetch('/api/v1/settings')).json()).theme)
    expect(settings).toBe('dark')
  })

  test('removing a repository only removes the dashboard entry', async ({ page }) => {
    await pair(page)
    await item(page, 'repo-b repository').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Remove from dashboard…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Remove repository from dashboard' })
    await expect(dialog).toContainText('No files, branches or worktrees are deleted')
    await dialog.getByRole('button', { name: 'Remove from dashboard' }).click()
    await expect(item(page, 'repo-b repository')).toBeHidden()
    expect(fs.existsSync(path.join(state().git.repoB, 'b.txt'))).toBe(true)
  })

  test('settings and diagnostics open, explain themselves and report no transcript text', async ({ page }) => {
    await pair(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings.getByText('Nothing is sent while this is off')).toBeVisible()
    await settings.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: 'Diagnostics' }).click()
    const diag = page.getByRole('dialog', { name: 'Diagnostics' })
    await expect(diag.getByRole('cell', { name: 'Claude Code' })).toBeVisible()
    await expect(diag).not.toContainText('synthetic prompt')
    await page.keyboard.press('Escape')
  })
})
