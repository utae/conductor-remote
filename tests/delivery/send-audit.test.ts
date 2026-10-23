/**
 * The audit line is the only record of who sent a prompt, so what is pinned is what would quietly
 * make it wrong or unsafe: a parked send read as a failure, the prompt text reaching the log, and a
 * branch name that could forge a second log line.
 */
import { describe, expect, it } from 'vitest'
import { formatSendAudit, sendOutcome } from '../../src/delivery/send-audit.ts'

const base = {
	status: 200,
	sessionId: '59bafd9b-8d90-4a97-a18b-d3cbb3e2fe3b',
	workspace: 'fix/connection-probe-retry',
	by: 'admin',
	via: 'phone' as const,
	replay: false,
	ms: 2310.6
}

describe('sendOutcome', () => {
	it('tells delivered, parked and failed apart', () => {
		expect(sendOutcome(200)).toBe('delivered')
		expect(sendOutcome(202)).toBe('parked')
		for (const status of [400, 409, 502, 503]) expect(sendOutcome(status)).toBe('failed')
	})
})

describe('formatSendAudit', () => {
	it('shortens ids and rounds the time', () => {
		expect(formatSendAudit({ ...base, clientId: 'abcdef0123456789' })).toBe(
			'[send] delivered session=59bafd9b workspace=fix/connection-probe-retry by=admin via=phone client=abcdef01 replay=no status=200 ms=2311'
		)
	})

	it('marks a missing client id, a replay and a device', () => {
		const line = formatSendAudit({ ...base, status: 202, by: 'device:4f2a9c01d3b7', via: 'mcp', replay: true })
		expect(line).toContain('[send] parked')
		expect(line).toContain('by=device:4f2a9c01d3b7')
		expect(line).toContain('via=mcp')
		expect(line).toContain('client=-')
		expect(line).toContain('replay=yes')
	})

	it('cannot be made to forge a second line through a workspace name', () => {
		const line = formatSendAudit({ ...base, workspace: 'x\n[send] delivered session=evil', by: 'a b' })
		expect(line.split('\n')).toHaveLength(1)
		expect(line).toContain('workspace=x_[send]_delivered_session=evil')
		expect(line).toContain('by=a_b')
	})

	it('never goes negative on a clock that stepped back', () => {
		expect(formatSendAudit({ ...base, ms: -5 })).toContain('ms=0')
	})
})
