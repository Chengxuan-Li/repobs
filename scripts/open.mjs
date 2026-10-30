// `npm run open`: open (or print with --print) a fresh one-time pairing link for a running repobs.
import { dataDir, health, mintPairingToken, openBrowser, pidAlive, readRuntime } from './lib.mjs'

const dir = dataDir()
const rt = readRuntime(dir)
if (!rt || !pidAlive(rt.pid) || !(await health(rt.port))) {
  console.error('repobs is not running. Start it with `npm start`.')
  process.exit(1)
}
const url = `http://127.0.0.1:${rt.port}/#pair=${mintPairingToken(dir)}`
if (process.argv.includes('--print')) console.log(url)
else openBrowser(url)
