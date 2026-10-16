import { expect, mock, test } from 'claude-code/testing'

import { escapeXml, formatDuration, formatMoney, formatTokens, parseExtraUsage, parseGitStatus, tileSvg, totalTokens } from '../hooks/register'

const BAND = {
  plugin: 'desktop-hud',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const USAGE = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 600_000, cache_creation_input_tokens: 50_000, model: 'claude-opus-5-5' }

test('helpers', async () => {
  expect(parseGitStatus('## main...origin/main [ahead 1]\n M a.ts\n')).toEqual({ branch: 'main', isDirty: true })
  expect(parseGitStatus('## feature/x\n')).toEqual({ branch: 'feature/x', isDirty: false })
  expect(formatDuration(45 * 60_000)).toBe('45 min')
  expect(formatDuration(90 * 60_000)).toBe('1 h 30')
  expect(formatDuration(3 * 1440 * 60_000)).toBe('3 j')
  expect(formatMoney(12.34, 'EUR')).toBe('12,34 €')
  expect(totalTokens(USAGE)).toBe(653_000)
  expect(formatTokens(653_000)).toBe('653 k')
  expect(formatTokens(1_250_000)).toBe('1,3 M')
  expect(formatTokens(900)).toBe('900')
  expect(escapeXml('a&b<c>"d')).toBe('a&#38;b&#60;c&#62;&#34;d')
  expect(parseExtraUsage('{"extra_usage":{"is_enabled":true,"monthly_limit":5000,"used_credits":1234,"utilization":24.68,"currency":"eur"}}'))
    .toEqual({ isEnabled: true, usedCents: 1234, limitCents: 5000, percent: 24.68, currency: 'EUR' })
  expect(parseExtraUsage('{"extra_usage":{"is_enabled":false,"monthly_limit":null,"used_credits":null,"utilization":null}}'))
    .toEqual({ isEnabled: false, usedCents: null, limitCents: null, percent: null, currency: 'USD' })
  expect(parseExtraUsage('{"five_hour":{}}')).toBeUndefined()
  expect(parseExtraUsage('pas du json')).toBeUndefined()
})

test('tuile SVG : petite police, jauge, détail dessous', async () => {
  const gauge = tileSvg('LIMITE 5 H', [{ text: '25 %', color: '#2da44e', isBold: true }], { gauge: 25, below: '↻ 1 h 30' })
  expect(gauge.height).toBe(44)
  expect(gauge.source).toContain('font-size="9.5"')
  expect(gauge.source).toContain('font-size="11.5"')
  expect(gauge.source).toContain('<rect y="18.5" width="12" height="5" rx="2.5" fill="#2da44e"/>')
  expect(gauge.source).toContain('>↻ 1 h 30</text>')
  expect(gauge.alt).toBe('LIMITE 5 H 25 % ↻ 1 h 30')

  const empty = tileSvg('LIMITE 7 J', [{ text: '0 %' }], { gauge: 0 })
  expect(empty.height).toBe(30)
  expect(empty.source).not.toContain('fill="#2da44e"')

  expect(tileSvg('PROJET', [{ text: 'a&b' }]).source).toContain('a&#38;b')
})

test('bandeau sur desktop, rien sur le terminal', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-16T10:00:00Z') })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.root', () => ({ value: '/home/jriboux/web/projet' }))
  on('session.usage', () => ({ value: {
    startedAt: Date.parse('2026-10-16T09:15:00Z'),
    context: { tokens: 360_000, window: 1_000_000, percent: 36 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 25, resetsAt: '2026-10-16T11:30:00Z' },
      { kind: 'seven_day', percentUsed: 88 },
    ],
    cost: { usd: 1.5 },
  } }))
  const fetched: { url: string; auth?: string }[] = []
  on('session.authorize', () => ({ value: { handle: 'poignee', kind: 'bearer' } }))
  on('http.fetch', (_$, e) => {
    fetched.push({ url: e.url, auth: e.init?.auth })
    const body = { extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1234, utilization: 24.68, currency: 'EUR' } }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '## main...origin/main\n M a.ts\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  await $.session.start({ cwd: '/home/jriboux/web/projet', surface: 'desktop', isInteractive: true })
  // Deux tours, dont un de sous-agent : les tokens s'additionnent.
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', usage: USAGE })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'a1', usage: USAGE })

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(fetched).toEqual([{ url: 'https://api.anthropic.com/api/oauth/usage', auth: 'poignee' }])
  const svgs = await desktop.findAll({ type: 'Svg' })
  expect(svgs).toHaveLength(5)
  const drawn = svgs.map(svg => String(svg.props.source)).join('\n')
  for (const text of ['PROJET', 'projet', '⎇ main', '●', 'LIMITE 5 H', '25 %', '↻ 1 h 30', 'LIMITE 7 J', '88 %', 'EXTRA', '12,34 € / 50,00 €', 'SESSION', '1,3 M tokens · 45 min']) {
    expect({ text, found: drawn.includes(text) }).toEqual({ text, found: true })
  }
  expect(drawn).not.toContain('$')
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await terminal.findAll({ type: 'Svg' })).toHaveLength(0)
  await terminal.unmount()
})
