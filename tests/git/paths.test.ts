import { describe, expect, it } from 'vitest'
import { isAbsoluteLocalPath, isWithin, pathKey, toDisplayPath } from '../../apps/server/src/platform/paths.ts'

describe('Windows path identity', () => {
  it('normalizes separators, drive case, namespace prefixes and trailing separators', () => {
    expect(toDisplayPath('d:/src/repo/', 'win32')).toBe('D:\\src\\repo')
    expect(toDisplayPath('\\\\?\\D:\\src\\repo', 'win32')).toBe('D:\\src\\repo')
    expect(toDisplayPath('D:\\', 'win32')).toBe('D:\\')
    expect(pathKey('D:\\Src\\Repo', 'win32')).toBe(pathKey('d:/src/repo', 'win32'))
  })

  it('matches on path boundaries only', () => {
    expect(isWithin('D:\\src\\repo\\sub', 'D:\\src\\repo', 'win32')).toBe(true)
    expect(isWithin('d:\\SRC\\repo', 'D:\\src\\repo', 'win32')).toBe(true)
    expect(isWithin('D:\\src\\repo-b', 'D:\\src\\repo', 'win32')).toBe(false)
    expect(isWithin('/home/u/repo2', '/home/u/repo', 'linux')).toBe(false)
    expect(isWithin('/home/u/Repo', '/home/u/repo', 'linux')).toBe(false)
  })

  it('accepts only absolute local paths', () => {
    expect(isAbsoluteLocalPath('relative\\path')).toBe(false)
    expect(isAbsoluteLocalPath('C:\\x\0y')).toBe(false)
    if (process.platform === 'win32') {
      expect(isAbsoluteLocalPath('C:\\src')).toBe(true)
      expect(isAbsoluteLocalPath('\\\\server\\share')).toBe(false)
    }
  })
})
