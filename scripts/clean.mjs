// `npm run clean`: remove build output in this checkout (never app data or anything outside it).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const rel of ['apps/server/dist', 'apps/web/dist', 'packages/contracts/dist', 'site', 'test-results', 'playwright-report']) {
  fs.rmSync(path.join(root, rel), { recursive: true, force: true })
}
console.log('Removed build output.')
