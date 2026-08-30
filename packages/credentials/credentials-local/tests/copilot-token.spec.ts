import { describe, expect, it, vi } from 'vitest'
import {
  AGENCY_COPILOT_CREDENTIAL_REF,
  type CredentialCommand,
  getCopilotCliToken,
} from '../src/copilot-token.ts'

describe('Agency Copilot credential discovery', () => {
  it('reads the macOS copilot-cli keychain entry', () => {
    const run = vi.fn(() => 'copilot-token')
    expect(getCopilotCliToken('darwin', run)).toBe('copilot-token')
    expect(run).toHaveBeenCalledWith('security', [
      'find-generic-password', '-s', 'copilot-cli', '-w',
    ])
  })

  it('reads the Windows copilot-cli credential through encoded PowerShell', () => {
    const run = vi.fn<CredentialCommand>(() => 'copilot-token')
    expect(getCopilotCliToken('win32', run)).toBe('copilot-token')
    expect(run).toHaveBeenCalledOnce()
    const [command, args] = run.mock.calls[0]!
    expect(command).toBe('powershell')
    expect(args.slice(0, 5)).toEqual([
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
    ])
    expect(args[5]).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('does not probe an unsupported platform', () => {
    const run = vi.fn(() => 'unexpected')
    expect(getCopilotCliToken('linux', run)).toBeUndefined()
    expect(run).not.toHaveBeenCalled()
  })

  it('exports the reference used by the shipped profile', () => {
    expect(AGENCY_COPILOT_CREDENTIAL_REF).toBe('CLAUDE_CODE_COPILOT_TOKEN')
  })
})
