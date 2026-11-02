import { type RunOptions, type RunResult, runProcess } from './process.ts'

// Native folder chooser on Windows, shown by the local backend (same machine, same user). The
// PowerShell script is a fixed string with no user input, passed as -EncodedCommand so no quoting
// is involved. Other platforms fall back to path entry.
//
// The script uses the shell's folder dialog (IFileOpenDialog with FOS_PICKFOLDERS), not the legacy
// FolderBrowserDialog: that one reports any failure as "Cancel", and was seen closing itself as
// Cancel ~1.5 s after it opened, so the click looked like it did nothing. The dialog is owned by a
// transparent topmost window placed on the monitor under the pointer (where Browse was clicked),
// with a taskbar entry, so it does not open behind the browser or on another screen. Output is a
// one-word status line; anything else, a non-zero exit or a timeout is reported as an error.

const TITLE = 'Select a Git repository folder to observe with repobs'

const DIALOG_SOURCE = String.raw`
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class RepobsFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialog { }

  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint count, IntPtr filters);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem item);
    void SetFolder(IShellItem item);
    void GetFolder(out IShellItem item);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
  }

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr ctx, ref Guid handler, ref Guid iid, out IntPtr result);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint form, [MarshalAs(UnmanagedType.LPWStr)] out string name);
  }

  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr processId);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

  const uint FOS_NOCHANGEDIR = 0x8, FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, FOS_PATHMUSTEXIST = 0x800;
  const uint SIGDN_FILESYSPATH = 0x80058000;
  const int ERROR_CANCELLED = unchecked((int)0x800704C7);

  public static string Pick(string title) {
    Rectangle area = Screen.FromPoint(Cursor.Position).WorkingArea;
    using (Form owner = new Form()) {
      owner.Text = title;
      owner.FormBorderStyle = FormBorderStyle.None;
      owner.StartPosition = FormStartPosition.Manual;
      owner.Location = new Point(area.Left + area.Width / 2, area.Top + area.Height / 3);
      owner.Size = new Size(1, 1);
      owner.Opacity = 0;
      owner.ShowInTaskbar = true;
      owner.TopMost = true;
      owner.Show();
      BringToFront(owner.Handle);

      IFileDialog dialog = (IFileDialog)new FileOpenDialog();
      uint options;
      dialog.GetOptions(out options);
      dialog.SetOptions(options | FOS_NOCHANGEDIR | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
      dialog.SetTitle(title);
      int hr = dialog.Show(owner.Handle);
      if (hr == ERROR_CANCELLED) return null;
      Marshal.ThrowExceptionForHR(hr);
      IShellItem item;
      dialog.GetResult(out item);
      string path;
      item.GetDisplayName(SIGDN_FILESYSPATH, out path);
      return path;
    }
  }

  // The backend is not the foreground process, so Windows would otherwise refuse to activate the
  // window; sharing input state with the foreground thread for the call lets it come to the front.
  static void BringToFront(IntPtr window) {
    uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    uint self = GetCurrentThreadId();
    bool attached = foreground != 0 && foreground != self && AttachThreadInput(self, foreground, true);
    try {
      BringWindowToTop(window);
      SetForegroundWindow(window);
    } finally {
      if (attached) AttachThreadInput(self, foreground, false);
    }
  }
}
`

const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  `Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'${DIALOG_SOURCE}'@`,
  `$path = [RepobsFolderPicker]::Pick('${TITLE}')`,
  "$text = if ($path) { \"selected`n$path\" } else { 'cancelled' }",
  '$bytes = [System.Text.Encoding]::UTF8.GetBytes($text)',
  '$out = [Console]::OpenStandardOutput()',
  '$out.Write($bytes, 0, $bytes.Length)',
  '$out.Flush()',
].join('\n')

export const PICKER_ARGS: readonly string[] = ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')]

const TIMEOUT_MS = 10 * 60_000

export type PickerErrorCode = 'unsupported' | 'busy' | 'picker_failed' | 'picker_timeout' | 'aborted'

export class PickerError extends Error {
  readonly code: PickerErrorCode
  constructor(code: PickerErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface PickFolderOptions {
  signal?: AbortSignal
  platform?: NodeJS.Platform
  run?: (command: string, args: readonly string[], options: RunOptions) => Promise<RunResult>
}

let busy = false

export function folderPickerSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
}

export async function pickFolder(options: PickFolderOptions = {}): Promise<{ path?: string; cancelled: boolean }> {
  if (!folderPickerSupported(options.platform)) throw new PickerError('unsupported', 'Folder picker is only available on Windows')
  if (busy) throw new PickerError('busy', 'A folder picker is already open on this computer. Choose a folder there or close it first.')
  busy = true
  try {
    let result: RunResult
    try {
      result = await (options.run ?? runProcess)('powershell.exe', PICKER_ARGS, { timeoutMs: TIMEOUT_MS, maxOutputBytes: 64 * 1024, signal: options.signal })
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'aborted') throw new PickerError('aborted', 'The folder picker was closed because the request was cancelled')
      throw new PickerError('picker_failed', `The folder picker could not start: ${(err as Error).message}`)
    }
    return parsePickerResult(result)
  } finally {
    busy = false
  }
}

export function parsePickerResult(result: RunResult): { path?: string; cancelled: boolean } {
  if (result.timedOut) throw new PickerError('picker_timeout', 'The folder picker was open for 10 minutes without a choice and was closed.')
  const out = result.stdout.toString('utf8')
  if (result.code === 0 && out === 'cancelled') return { cancelled: true }
  const selected = /^selected\n(.+)$/s.exec(out)
  if (result.code === 0 && selected?.[1]?.trim()) return { path: selected[1].trim(), cancelled: false }
  const detail = firstErrorLine(result.stderr)
  throw new PickerError('picker_failed', `The folder picker failed${result.code ? ` (exit code ${result.code})` : ''}${detail ? `: ${detail}` : ' without a result'}`)
}

// PowerShell may wrap errors in CLIXML when its output is redirected; keep the first readable line.
function firstErrorLine(stderr: string): string {
  const text = stderr.includes('<Objs') ? [...stderr.matchAll(/<S S="Error">([^<]*)<\/S>/g)].map((m) => m[1]!.replace(/_x000D__x000A_/g, '\n')).join('') : stderr
  const line = text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#< CLIXML'))
  return line ? line.trim().slice(0, 300) : ''
}
