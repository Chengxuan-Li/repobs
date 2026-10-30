import { runProcess } from './process.ts'

// Native folder chooser on Windows, shown by the local backend (same machine, same user). The
// PowerShell script is a fixed string with no user input. Other platforms fall back to path entry.

const SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }',
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
  "$d.Description = 'Select a Git repository folder to observe with repobs'",
  '$d.ShowNewFolderButton = $false',
  "if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
].join('; ')

let busy = false

export function folderPickerSupported(): boolean {
  return process.platform === 'win32'
}

export async function pickFolder(): Promise<{ path?: string; cancelled: boolean }> {
  if (!folderPickerSupported()) throw Object.assign(new Error('Folder picker is only available on Windows'), { code: 'unsupported' })
  if (busy) throw Object.assign(new Error('A folder picker is already open'), { code: 'busy' })
  busy = true
  try {
    const result = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', SCRIPT], {
      timeoutMs: 10 * 60_000,
      maxOutputBytes: 64 * 1024,
    })
    const selected = result.stdout.toString('utf8').trim()
    return selected ? { path: selected, cancelled: false } : { cancelled: true }
  } finally {
    busy = false
  }
}
