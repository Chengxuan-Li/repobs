import { spawn } from 'node:child_process'

/** Open a loopback URL in the default browser (argv only, no shell). */
export function openInBrowser(url: string): void {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/[#A-Za-z0-9=._~/-]*$/.test(url)) throw new Error('Refusing to open a non-loopback URL')
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  const child = spawn(cmd, args, { shell: false, detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => console.log(`Could not open a browser automatically. Open this link: ${url}`))
  child.unref()
}
