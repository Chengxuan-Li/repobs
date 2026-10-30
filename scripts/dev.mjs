// `npm run dev`: DEVELOPMENT MODE. Runs the backend from TypeScript sources with --watch and the
// Vite dev UI on http://127.0.0.1:5173 (proxying /api). Not for everyday use: `npm start` serves
// the built UI from the backend itself.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkNode } from './lib.mjs'

checkNode()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const devOrigin = 'http://127.0.0.1:5173'
const port = process.env.REPOBS_PORT ?? '47322'
const env = { ...process.env, REPOBS_DEV_UI_ORIGIN: devOrigin, REPOBS_PORT: port }

console.log(`\n  repobs DEVELOPMENT MODE — backend on 127.0.0.1:${port}, dev UI on ${devOrigin}\n`)
const children = [
  spawn(process.execPath, ['--conditions=development', '--watch', path.join('apps', 'server', 'src', 'index.ts')], { cwd: root, env, stdio: 'inherit' }),
  spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: path.join(root, 'apps', 'web'), env, stdio: 'inherit' }),
]
const stop = () => children.forEach((c) => !c.killed && c.kill())
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const c of children) c.on('exit', () => {
  stop()
  process.exitCode = c.exitCode ?? 0
})
