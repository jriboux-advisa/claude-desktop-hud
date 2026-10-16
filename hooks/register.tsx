import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, SessionUsage } from 'claude-code'

import type { Extra, Hud } from '../types'

// Équivalent Desktop de la statusline claude-hud : le terminal a déjà la sienne,
// le bandeau ne s'affiche donc que sur les autres surfaces. Le modèle et le
// contexte n'y figurent pas : Desktop les affiche déjà (barre d'état, sidebar).

const hud = atom({ plugin: 'desktop-hud', key: 'hud' } as const, { isDirty: false, limits: [], now: 0 } as Hud)

const LIMIT_LABELS: Record<string, string> = { five_hour: 'LIMITE 5 H', seven_day: 'LIMITE 7 J', spend_limit: 'BUDGET' }

const patch = ($: EngineInterface, fields: Partial<Hud>) => update($, hud, s => ({ ...s, ...fields }))

const usageFields = (u: Pick<SessionUsage, 'rateLimits'>): Partial<Hud> => ({
  limits: u.rateLimits.map(l => ({ kind: l.kind, percent: l.percentUsed, resetsAt: l.resetsAt })),
})

// Première ligne de `git status --porcelain --branch` : « ## main...origin/main [ahead 1] ».
export const parseGitStatus = (out: string) => {
  const [head = '', ...rest] = out.split('\n')
  const branch = head.replace(/^## (No commits yet on )?/, '').split(/\.\.\.| /)[0]
  return { branch: branch || undefined, isDirty: rest.some(l => l.trim() !== '') }
}

const refreshGit = async ($: EngineInterface) => {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'status', '--porcelain', '--branch'], { cwd: await $.session.root(), timeoutMs: 5000 })
    await patch($, exitCode === 0 ? parseGitStatus(stdout) : { branch: undefined, isDirty: false })
  } catch {
    await patch($, { branch: undefined, isDirty: false })
  }
}

// Hors forfait : /api/oauth/usage, que le moteur interroge aussi pour /usage. Le jeton
// n'est jamais vu ici : le moteur le pose lui-même à partir du handle d'authorize().
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

export const parseExtraUsage = (text: string): Extra | undefined => {
  try {
    const x = JSON.parse(text)?.extra_usage
    if (!x || typeof x.is_enabled !== 'boolean') return undefined
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const currency = typeof x.currency === 'string' ? x.currency.toUpperCase() : 'USD'
    return { isEnabled: x.is_enabled, usedCents: num(x.used_credits), limitCents: num(x.monthly_limit), percent: num(x.utilization), currency }
  } catch {
    return undefined
  }
}

const refreshExtra = async ($: EngineInterface) => {
  const auth = await $.session.authorize()
  if (auth?.kind !== 'bearer') return
  try {
    const r = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
    const extra = r.ok ? parseExtraUsage(r.text) : undefined
    if (extra) await patch($, { extra })
  } catch {
    // Réseau ou politique de l'organisation : on garde la dernière valeur connue.
  }
}

// Au plus une requête par minute, le hors forfait bougeant peu.
let extraFetchedAt = -Infinity

const maybeRefreshExtra = async ($: EngineInterface) => {
  const now = await $.clock.now()
  if (now - extraFetchedAt < 60_000) return
  extraFetchedAt = now
  await refreshExtra($)
}

const refreshSession = async ($: EngineInterface) => {
  const [root, usage, now] = await Promise.all([$.session.root(), $.session.usage(), $.clock.now()])
  await patch($, { project: root.split('/').filter(Boolean).pop(), startedAt: usage.startedAt, now, ...usageFields(usage) })
}

export const levelColor = (percent: number) => (percent >= 85 ? 'error' : percent >= 70 ? 'warning' : 'success')

// Teintes moyennes lisibles sur fond clair comme sombre ; piste neutre translucide.
const GAUGE_COLORS = { success: '#2da44e', warning: '#d29922', error: '#e5534b' } as const

// Police réduite : les Text d'un mod n'ont pas de taille, chaque tuile est donc dessinée
// en SVG, avec des couleurs fixes de ton moyen pour rester lisible dans les deux thèmes.
const FONT = "system-ui, -apple-system, 'Segoe UI', Ubuntu, sans-serif"
const GRAY = '#8b8b8b'
const SIZE = { label: 9.5, value: 11.5, below: 10.5 }
const GAUGE_WIDTH = 48

export type Span = { text: string; color?: string; isBold?: boolean; gap?: number }

export const escapeXml = (t: string) => t.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)

// Aucune mesure possible ici : largeur estimée par caractère, un peu surestimée pour ne rien rogner.
export const textWidth = (t: string, size: number) =>
  [...t].reduce((w, c) => w + (c === ' ' ? 0.3 : /[a-z]/.test(c) ? 0.56 : 0.68), 0) * size

const spansWidth = (parts: Span[], size: number) => parts.reduce((w, p) => w + (p.gap ?? 0) + textWidth(p.text, size), 0)

const gaugeRects = (percent: number, y: number) => {
  const h = 5
  const p = Math.max(0, Math.min(100, percent))
  const fill = p > 0 ? Math.max(h, Math.round((p / 100) * GAUGE_WIDTH)) : 0
  const track = `<rect y="${y}" width="${GAUGE_WIDTH}" height="${h}" rx="2.5" fill="rgba(127,127,127,0.28)"/>`
  return fill > 0 ? `${track}<rect y="${y}" width="${fill}" height="${h}" rx="2.5" fill="${GAUGE_COLORS[levelColor(p)]}"/>` : track
}

// Une tuile : libellé discret, ligne de valeur (précédée d'une jauge si `gauge`), détail discret dessous.
export const tileSvg = (label: string, value: Span[], opts: { gauge?: number; below?: string | Span[] } = {}) => {
  const lead = opts.gauge === undefined ? 0 : GAUGE_WIDTH + 6
  const below = typeof opts.below === 'string' ? [{ text: opts.below }] : opts.below
  const width =
    Math.ceil(Math.max(textWidth(label, SIZE.label) + label.length * 0.5, lead + spansWidth(value, SIZE.value), below ? spansWidth(below, SIZE.below) : 0)) + 2
  const height = below ? 44 : 30
  const tspans = (parts: Span[]) =>
    parts
      .map(v => `<tspan${v.gap ? ` dx="${v.gap}"` : ''} fill="${v.color ?? GRAY}"${v.isBold ? ' font-weight="600"' : ''}>${escapeXml(v.text)}</tspan>`)
      .join('')
  const body = [
    `<text y="9" font-size="${SIZE.label}" letter-spacing="0.5" fill="${GRAY}">${escapeXml(label)}</text>`,
    opts.gauge === undefined ? '' : gaugeRects(opts.gauge, 18.5),
    `<text x="${lead}" y="25" font-size="${SIZE.value}">${tspans(value)}</text>`,
    below ? `<text y="40" font-size="${SIZE.below}">${tspans(below)}</text>` : '',
  ].join('')
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">${body}</svg>`,
    alt: [label, ...value.map(v => v.text), ...(below ?? []).map(v => v.text)].filter(Boolean).join(' '),
    width,
    height,
  }
}

export const formatDuration = (ms: number) => {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days} j${hours > 0 ? ` ${hours} h` : ''}`
  if (hours > 0) return `${hours} h ${String(minutes % 60).padStart(2, '0')}`
  return `${minutes} min`
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' }

// Comme claude-hud : entrée + sortie + lecture et écriture de cache.
export const totalTokens = (u: ModelUsage) => u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

export const formatTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.', ',')} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : `${n}`

export const formatMoney = (amount: number, currency = 'USD') => `${amount.toFixed(2).replace('.', ',')} ${CURRENCY_SYMBOLS[currency] ?? currency}`

export const truncate = (t: string, max: number) => (t.length > max ? `${t.slice(0, max)}...` : t)

export const register: Register = on => {
  let tick: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await Promise.all([refreshSession($), refreshGit($), maybeRefreshExtra($)])
    tick?.cancel()
    tick = $.clock.every(60_000, () => void $.clock.now().then(now => patch($, { now })))
    return result
  })

  on('session.measure', async ($, e, next) => {
    await patch($, { ...usageFields(e), now: await $.clock.now() })
    return next(e)
  })

  // Tokens cumulés de la session, sous-agents compris (comptés à partir du chargement du mod).
  on('turn.complete', async ($, e, next) => {
    const usage = e.usage
    if (usage) await update($, hud, s => ({ ...s, tokens: (s.tokens ?? 0) + totalTokens(usage) }))
    if (e.agentId === undefined) await Promise.all([refreshSession($), refreshGit($), maybeRefreshExtra($)])
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'terminal' || e.props.hasSurvey) return next(e)

    const s = await read($, hud)
    if (s.startedAt === undefined) return next(e)

    const { Box, Svg } = $.ui.resolve(e)
    if (!Svg) return next(e)

    const draw = (key: string, t: ReturnType<typeof tileSvg>) => (
      <Box key={key}>
        <Svg source={t.source} alt={t.alt} width={t.width} height={t.height} />
      </Box>
    )
    const pct = (p: number): Span => ({ text: `${Math.round(p)} %`, color: GAUGE_COLORS[levelColor(p)], isBold: true })
    const extraTile = (x: Extra) => {
      const money = (cents: number | null) => (cents === null ? '–' : formatMoney(cents / 100, x.currency))
      if (!x.isEnabled) return tileSvg('EXTRA', [{ text: 'désactivé' }])
      if (x.limitCents === null) return tileSvg('EXTRA', [{ text: money(x.usedCents) }], { below: 'sans plafond' })
      const percent = x.percent ?? (x.limitCents > 0 ? ((x.usedCents ?? 0) / x.limitCents) * 100 : 0)
      return tileSvg('EXTRA', [pct(percent)], { gauge: percent, below: `${money(x.usedCents)} / ${money(x.limitCents)}` })
    }
    const branch: Span[] = [
      ...(s.branch ? [{ text: `⎇ ${truncate(s.branch, 12)}` }] : []),
      ...(s.isDirty ? [{ text: '●', color: GAUGE_COLORS.warning, gap: 4 }] : []),
    ]

    const [sessionValue, sessionBelow] = [
      s.tokens !== undefined ? `${formatTokens(s.tokens)} tokens` : null,
      s.startedAt !== undefined && s.now > 0 ? formatDuration(s.now - s.startedAt) : null,
    ].filter((t): t is string => t !== null)

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={3} rowGap={1}>
        {s.project ? draw('project', tileSvg('PROJET', [{ text: s.project }], { below: branch.length > 0 ? branch : undefined })) : null}
        {s.limits.map(l =>
          draw(
            l.kind,
            tileSvg(LIMIT_LABELS[l.kind] ?? l.kind.toUpperCase(), [pct(l.percent)], {
              gauge: l.percent,
              below: l.resetsAt && s.now > 0 ? `↻ ${formatDuration(Date.parse(l.resetsAt) - s.now)}` : undefined,
            }),
          ),
        )}
        {s.extra ? draw('extra', extraTile(s.extra)) : null}
        {sessionValue ? draw('session', tileSvg('SESSION', [{ text: sessionValue }], { below: sessionBelow })) : null}
      </Box>
    )
  })
}
