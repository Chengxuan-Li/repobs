// `npm run package`: a ready-to-run release of the built app (run `npm run build` first).
//
//   release/repobs-<version>.zip         unzip and `npm start`; needs Node.js 24 only
//   release/SHA256SUMS.txt               checksum of the zip
//   release/notes-<version>.md           release notes: the version's CHANGELOG section + install steps
//
// The zip holds the built server, web UI and contracts, the launcher scripts, the runtime
// dependency (zod) and the licences of everything bundled. No install, build or download is needed
// to run it. `--tag vX.Y.Z` refuses to package when the tag and the package version disagree.
// The zip is written by this script (deflate + CRC from node:zlib) with sorted entries and the
// release commit's timestamp (or SOURCE_DATE_EPOCH), so the same sources give the same archive on any machine.
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version
const tagArg = process.argv.indexOf('--tag')
const tag = tagArg > 0 ? process.argv[tagArg + 1] : undefined
if (tag && tag !== `v${version}`) fail(`Tag ${tag} does not match package version ${version}.`)

const name = `repobs-${version}`
const out = path.join(root, 'release')

function fail(message) {
  console.error(`package: ${message}`)
  process.exit(1)
}

for (const built of ['apps/server/dist/index.js', 'apps/web/dist/index.html', 'packages/contracts/dist/index.js']) {
  if (!fs.existsSync(path.join(root, built))) fail(`${built} is missing; run \`npm run build\` first.`)
}

/** @type {Map<string, Buffer>} archive path (inside `${name}/`) -> contents */
const files = new Map()
const add = (archivePath, data) => files.set(archivePath, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'))

/** Adds a directory's files, skipping type declarations, build info and anything `skip` rejects. */
function addTree(from, to, skip = () => false) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dest = `${to}/${entry.name}`
    if (skip(entry.name, src)) continue
    if (entry.isDirectory()) addTree(src, dest, skip)
    else if (entry.isFile() && !/\.d\.ts(\.map)?$|\.tsbuildinfo$/.test(entry.name)) add(dest, fs.readFileSync(src))
  }
}
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))

// The app: built output only, with the package manifests Node needs to load it as ES modules.
addTree(path.join(root, 'apps/server/dist'), 'apps/server/dist')
add('apps/server/package.json', JSON.stringify(pick(readJson(path.join(root, 'apps/server/package.json')), ['name', 'version', 'private', 'license', 'type']), null, 2) + '\n')
addTree(path.join(root, 'apps/web/dist'), 'apps/web/dist')
const contracts = readJson(path.join(root, 'packages/contracts/package.json'))
addTree(path.join(root, 'packages/contracts/dist'), 'node_modules/@repobs/contracts/dist')
add(
  'node_modules/@repobs/contracts/package.json',
  JSON.stringify({ ...pick(contracts, ['name', 'version', 'private', 'license', 'type']), exports: { '.': { default: './dist/index.js' } } }, null, 2) + '\n',
)
for (const script of ['start.mjs', 'open.mjs', 'lib.mjs', 'start.ps1']) add(`scripts/${script}`, fs.readFileSync(path.join(root, 'scripts', script)))
add(
  'package.json',
  JSON.stringify(
    {
      ...pick(pkg, ['name', 'version', 'private', 'description', 'license', 'type', 'engines']),
      scripts: { start: 'node scripts/start.mjs', open: 'node scripts/open.mjs' },
    },
    null,
    2,
  ) + '\n',
)
for (const doc of ['LICENSE', 'README.md', 'CHANGELOG.md', 'SECURITY.md']) add(doc, fs.readFileSync(path.join(root, doc)))
add(
  'START-HERE.txt',
  `repobs ${version} — ready to run

Requirements: Node.js 24 LTS (24.11 or newer) and Git for Windows on PATH.
Nothing else is installed, built or downloaded.

Start (in this folder):
  npm start
or
  powershell -ExecutionPolicy Bypass -File scripts\\start.ps1

repobs starts on http://127.0.0.1:47321 (loopback only) and opens your browser with a one-time
pairing link. Press Ctrl+C to stop it. \`npm run open\` opens a new pairing link for a running repobs.

Your annotations and settings live in %LOCALAPPDATA%\\repobs, not in this folder, so you can replace
this folder with a newer release at any time.

See README.md, CHANGELOG.md and SECURITY.md; THIRD-PARTY-NOTICES.txt lists bundled software.
`,
)

// Runtime dependencies: the server's (copied as packages) and the web UI's (bundled into its
// JavaScript and fonts); both are listed with their licences.
const nodeModules = path.join(root, 'node_modules')
const runtimeDeps = (manifest) => Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }).filter((d) => !d.startsWith('@repobs/'))
function closure(names) {
  const seen = new Map()
  const visit = (dep) => {
    if (seen.has(dep)) return
    const dir = path.join(nodeModules, dep)
    if (!fs.existsSync(path.join(dir, 'package.json'))) return // optional and not installed
    const manifest = readJson(path.join(dir, 'package.json'))
    seen.set(dep, { dir, manifest })
    for (const d of runtimeDeps(manifest)) visit(d)
  }
  names.forEach(visit)
  return seen
}
const serverDeps = closure(runtimeDeps(readJson(path.join(root, 'apps/server/package.json'))))
for (const [dep, { dir }] of serverDeps) addTree(dir, `node_modules/${dep}`, (entry) => entry === 'node_modules')
const webDeps = closure(runtimeDeps(readJson(path.join(root, 'apps/web/package.json'))))

const notices = [`Third-party software in repobs ${version}\n`, 'repobs itself is MIT-licensed (LICENSE). It includes the following packages.\n']
for (const [dep, { dir, manifest }] of [...new Map([...serverDeps, ...webDeps])].sort(([a], [b]) => a.localeCompare(b))) {
  const licenceFile = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f))
  const text = licenceFile ? fs.readFileSync(path.join(dir, licenceFile), 'utf8').trim() : `License: ${manifest.license ?? 'see the package'}`
  notices.push(`\n${'='.repeat(78)}\n${dep} ${manifest.version} (${manifest.license ?? 'unknown licence'})\n${'='.repeat(78)}\n\n${text}\n`)
}
add('THIRD-PARTY-NOTICES.txt', notices.join(''))

// The zip.
// SOURCE_DATE_EPOCH (the reproducible-builds convention) wins, for builds outside a Git checkout.
const commitTime =
  Number(process.env.SOURCE_DATE_EPOCH) ||
  Number(spawnSync('git', ['log', '-1', '--format=%ct'], { cwd: root, encoding: 'utf8' }).stdout?.trim()) ||
  Math.floor(Date.now() / 1000)
const zip = writeZip(
  [...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([p, data]) => ({ name: `${name}/${p}`, data })),
  new Date(commitTime * 1000),
)
fs.mkdirSync(out, { recursive: true })
const zipName = `${name}.zip`
fs.writeFileSync(path.join(out, zipName), zip)
const sha = crypto.createHash('sha256').update(zip).digest('hex')
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), `${sha}  ${zipName}\n`)

// Release notes: the version's CHANGELOG section, then how to install.
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
const section = changelog.split(/^## /m).find((s) => s.startsWith(`[${version}]`))
if (!section) fail(`CHANGELOG.md has no section for ${version}.`)
const body = section.slice(section.indexOf('\n') + 1).trim()
fs.writeFileSync(
  path.join(out, `notes-${version}.md`),
  `${body}

## Install

1. Install [Node.js 24 LTS](https://nodejs.org/) (24.11 or newer) and Git for Windows.
2. Download \`${zipName}\` below and unzip it.
3. In the unzipped \`${name}\` folder run \`npm start\` (or \`powershell -ExecutionPolicy Bypass -File scripts\\start.ps1\`).

No install or build step and no downloads: the zip holds the built app and its one runtime dependency. Your annotations live in \`%LOCALAPPDATA%\\repobs\`, so a new release can replace the folder. To build from source instead, use the source archive and the README.

SHA-256 of \`${zipName}\`: \`${sha}\`
`,
)

console.log(`package: ${path.relative(root, path.join(out, zipName))} (${files.size} files, ${(zip.length / 1024).toFixed(0)} KiB)`)
console.log(`package: sha256 ${sha}`)

/** A plain zip archive (deflate, UTF-8 names, no zip64: entries and sizes stay far below its limits). */
function writeZip(entries, date) {
  const dosTime = ((date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2)) & 0xffff
  const dosDate = (((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()) & 0xffff
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name: entryName, data } of entries) {
    const nameBuf = Buffer.from(entryName, 'utf8')
    const compressed = zlib.deflateRawSync(data, { level: 9 })
    const crc = zlib.crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += local.length + nameBuf.length + compressed.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}
