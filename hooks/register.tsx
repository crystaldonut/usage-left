import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Area, Limit, Pr, Worktree } from '../types'

const limitsAtom = atom({ plugin: 'usage-left', key: 'limits' } as const, [] as Limit[])
const modelAtom = atom({ plugin: 'usage-left', key: 'model' } as const, '')
const effortAtom = atom({ plugin: 'usage-left', key: 'effort' } as const, '')
const worktreeAtom = atom({ plugin: 'usage-left', key: 'worktree' } as const, null as Worktree | null)
const fableAtom = atom({ plugin: 'usage-left', key: 'fable' } as const, null as Limit | null)
const nowAtom = atom({ plugin: 'usage-left', key: 'now' } as const, 0)

const BAR = 20
// The weekly limit covers the Fable line as a whole, not one model version.
const FABLE_LABEL = 'Fable (Usage)'
const LEVELS = {
  normal: { fg: '#22c55e', bg: '#14532d' },
  caution: { fg: '#eab308', bg: '#713f12' },
  critical: { fg: '#ef4444', bg: '#7f1d1d' },
}

function level(used: number) {
  if (used >= 90) return LEVELS.critical
  if (used >= 70) return LEVELS.caution
  return LEVELS.normal
}

function clockTime(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  return `Resets ${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
}

function countdown(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return `Resets in ${d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`}`
}

function shortModel(model: string): string {
  const name = model.replace(/^claude-/, '').replace(/\[.*\]$/, '')
  const m = name.match(/^([a-z]+)-(\d+)(?:-(\d+))?/i)
  const [, f = '', major = '', minor] = m ?? []
  if (!m || !f) return name || 'Model'
  const fam = f.charAt(0).toUpperCase() + f.slice(1)
  return minor ? `${fam} ${major}.${minor}` : `${fam} ${major}`
}

// Per-repository product areas, read from areas.json on every refresh, so an
// edit there shows on the next reply.
type AreaRule = { name: string; color: string; paths: string[]; branchWords: string[] }
type RepoConfig = {
  fallback: Area
  areas: AreaRule[]
  ticket: { pattern: RegExp; url: string } | null
}

const GREY = '#94a3b8'

function str(v: unknown, d: string): string {
  return typeof v === 'string' && v ? v : d
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []
}

function toRepoConfig(raw: unknown, repoName: string): RepoConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const fb = (r.fallback && typeof r.fallback === 'object' ? r.fallback : {}) as Record<string, unknown>
  const areas = (Array.isArray(r.areas) ? r.areas : []).flatMap(a => {
    if (!a || typeof a !== 'object') return []
    const o = a as Record<string, unknown>
    if (typeof o.name !== 'string' || !o.name) return []
    return [{ name: o.name, color: str(o.color, GREY), paths: strs(o.paths), branchWords: strs(o.branchWords) }]
  })
  let ticket: RepoConfig['ticket'] = null
  const t = (r.ticket && typeof r.ticket === 'object' ? r.ticket : null) as Record<string, unknown> | null
  if (t && typeof t.pattern === 'string' && typeof t.url === 'string') {
    try {
      ticket = { pattern: new RegExp(t.pattern, 'i'), url: t.url }
    } catch {
      ticket = null
    }
  }
  return { fallback: { name: str(fb.name, repoName), color: str(fb.color, GREY) }, areas, ticket }
}

// The config for a repository: looked up by "owner/repo" from origin, then
// by repo name, then by the main checkout's folder name, then "*".
async function repoConfig($: EngineInterface, keys: string[], repoName: string): Promise<RepoConfig> {
  for (const file of await areasFiles($)) {
    try {
      const text = await $.fs.read(file)
      const repos = (JSON.parse(text) as { repos?: Record<string, unknown> }).repos ?? {}
      for (const k of [...keys, '*']) if (k && repos[k]) return toRepoConfig(repos[k], repoName)
      break
    } catch {
      // no file here or bad JSON: try the next place
    }
  }
  return toRepoConfig({}, repoName)
}

// Where areas.json is looked for, first found wins. The Claude Code config
// folder comes first because an installed plugin's own folder is replaced on
// every update; the plugin folder serves a mod run straight from its checkout.
async function areasFiles($: EngineInterface): Promise<string[]> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  const base = configDir || (home ? `${home}/.claude` : '')
  return [...(base ? [`${base}/usage-left/areas.json`] : []), `${$.plugin.root}/areas.json`]
}

function domainsOf(cfg: RepoConfig, paths: string[], branch: string): Area[] {
  const byName = new Map<string, Area>()
  let other = false
  for (const p of paths) {
    if (!p) continue
    const hit = cfg.areas.find(a => a.paths.some(prefix => p.startsWith(prefix)))
    if (hit) byName.set(hit.name, { name: hit.name, color: hit.color })
    else other = true
  }
  if (byName.size > 0) return [...byName.values()]
  if (other) return [cfg.fallback]
  const words = branch.toLowerCase().split(/[^a-z0-9]+/)
  const hinted = cfg.areas.filter(a => a.branchWords.some(w => words.includes(w.toLowerCase())))
  return hinted.length > 0 ? hinted.map(a => ({ name: a.name, color: a.color })) : [cfg.fallback]
}

async function git($: EngineInterface, cwd: string, args: string[]): Promise<string | null> {
  const r = await $.process.run(['git', ...args], { cwd })
  return r.exitCode === 0 ? r.stdout.trim() : null
}

async function findPr($: EngineInterface, cwd: string, branch: string): Promise<Pr | null> {
  try {
    const r = await $.process.run(
      ['gh', 'pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number,url,state,isDraft'],
      { cwd },
    )
    if (r.exitCode !== 0) return null
    const list = JSON.parse(r.stdout) as Pr[]
    return list[0] ?? null
  } catch {
    return null
  }
}

let lastPrCheck = { key: '', at: 0, pr: null as Pr | null }

// The linked git worktree the session is in, with the app areas its changes
// touch, its ticket and its pull request; null in a main checkout or
// outside git.
async function findWorktree($: EngineInterface): Promise<Worktree | null> {
  const cwd = await $.session.cwd()
  const head = await git($, cwd, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir', '--abbrev-ref', 'HEAD'])
  if (head === null) return null
  const [top = '', gitDir = '', commonDir = '', branch = ''] = head.split('\n')
  const common = commonDir.startsWith('/') ? commonDir : `${top}/${commonDir}`
  if (gitDir.replace(/\/$/, '') === common.replace(/\/$/, '')) return null

  const base = (await git($, cwd, ['merge-base', 'HEAD', 'origin/main'])) ?? 'HEAD'
  const committed = (await git($, cwd, ['diff', '--name-only', base, 'HEAD'])) ?? ''
  const local = (await git($, cwd, ['status', '--porcelain'])) ?? ''
  const paths = [
    ...committed.split('\n'),
    ...local.split('\n').map(l => l.slice(3).split(' -> ').pop() ?? ''),
  ]

  const origin = (await git($, cwd, ['remote', 'get-url', 'origin'])) ?? ''
  const slug = origin.replace(/\.git$/, '').match(/[:/]([^/:]+\/[^/]+)$/)?.[1] ?? ''
  const folder = common.replace(/\/\.git\/?$/, '').split('/').pop() ?? ''
  const repoName = slug.split('/').pop() || folder
  const cfg = await repoConfig($, [slug, repoName, folder], repoName)

  const id = cfg.ticket ? branch.match(cfg.ticket.pattern)?.[0]?.toUpperCase() : undefined
  const ticket = id && cfg.ticket ? { id, url: cfg.ticket.url.replace('{ticket}', id) } : null
  const now = Date.now()
  const key = `${top}|${branch}`
  if (key !== lastPrCheck.key || now - lastPrCheck.at > 120_000) {
    lastPrCheck = { key, at: now, pr: branch && branch !== 'HEAD' ? await findPr($, cwd, branch) : null }
  }

  return {
    name: top.split('/').pop() ?? top,
    branch,
    domains: domainsOf(cfg, paths, branch),
    ticket,
    pr: lastPrCheck.pr,
  }
}

type AccountLimit = {
  kind?: string
  percent?: number
  resets_at?: string
  scope?: { model?: { display_name?: string | null } | null } | null
}

let lastFableFetch = 0

// The weekly Fable limit, read from the account usage endpoint that /usage
// shows; the per-reply rate-limit figures the engine hands mods do not carry it.
async function refreshFable($: EngineInterface): Promise<void> {
  const now = Date.now()
  if (now - lastFableFetch < 60_000) return
  lastFableFetch = now
  try {
    const authz = await $.session.authorize()
    if (!authz) return
    const r = await $.http.fetch('https://api.anthropic.com/api/oauth/usage', {
      auth: authz.handle,
      headers: { 'anthropic-beta': 'oauth-2025-04-20' },
    })
    if (!r.ok) return
    const body = JSON.parse(r.text) as { limits?: AccountLimit[] }
    const hit = (body.limits ?? []).find(
      l => l.kind === 'weekly_scoped' && /fable/i.test(l.scope?.model?.display_name ?? ''),
    )
    const fable: Limit | null = hit
      ? { kind: 'fable_weekly', percentUsed: hit.percent ?? 0, resetsAt: hit.resets_at }
      : null
    await update($, fableAtom, () => fable)
  } catch {
    // keep the last reading
  }
}

export const register: Register = on => {
  let timer: Timer | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.ui.status(undefined)
    const usage = await $.session.usage()
    await update($, limitsAtom, () => usage.rateLimits)
    await update($, modelAtom, () => '')
    await update($, nowAtom, () => Date.now())
    const wt = await findWorktree($)
    await update($, worktreeAtom, () => wt)
    await refreshFable($)
    timer?.cancel()
    timer = await $.clock.every(60_000, () => {
      void update($, nowAtom, () => Date.now())
      void refreshFable($)
    })
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, limitsAtom, () => e.rateLimits)
    await refreshFable($)
    const wt = await findWorktree($)
    await update($, worktreeAtom, () => wt)
    await update($, nowAtom, () => Date.now())
    const model = await $.session.model()
    await update($, modelAtom, () => model)
    return next(e)
  })

  on('tool.call', { tool: ['EnterWorktree', 'ExitWorktree'] }, async ($, e, next) => {
    const result = await next(e)
    const wt = await findWorktree($)
    await update($, worktreeAtom, () => wt)
    return result
  })

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const effort = e.effort === undefined ? '' : String(e.effort)
      await update($, effortAtom, () => effort)
      await update($, modelAtom, () => e.model)
    }
    return yield* next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const engineLine = await next(e)
    const limits = await read($, limitsAtom)
    const now = (await read($, nowAtom)) || Date.now()
    let model = await read($, modelAtom)
    if (!model) model = await $.session.model()
    const effort = await read($, effortAtom)
    // A value stored by an older version of the mod may be a plain string.
    const stored: unknown = await read($, worktreeAtom)
    const worktree =
      stored &&
      typeof stored === 'object' &&
      Array.isArray((stored as Worktree).domains) &&
      (stored as Worktree).domains.every(d => d && typeof d === 'object') &&
      ((stored as Worktree).ticket === null || typeof (stored as Worktree).ticket === 'object')
        ? (stored as Worktree)
        : null
    const modelLabel = effort ? `${shortModel(model)} (${effort})` : shortModel(model)
    const { Box, Link, Text } = $.ui.resolve(e)

    const session = limits.find(l => l.kind === 'five_hour')
    const fable = await read($, fableAtom)

    const bar = (key: string, label: string, l: Limit | undefined, reset: string) => {
      if (!l) {
        return (
          <Text key={key} dimColor>
            {label}: no reading yet
          </Text>
        )
      }
      const used = Math.min(100, Math.max(0, l.percentUsed))
      const filled = Math.round((used / 100) * BAR)
      const c = level(used)
      return (
        <Text key={key}>
          {label}: <Text color={c.fg}>{'█'.repeat(filled)}</Text>
          <Text color={c.bg}>{'█'.repeat(BAR - filled)}</Text> {Math.round(100 - used)}% left · {reset}
        </Text>
      )
    }

    return (
      <Box flexDirection="column">
        {worktree ? (
          <Box key="wt">
            <Text>⎇ {worktree.name}</Text>
            {worktree.branch && worktree.branch !== worktree.name ? <Text dimColor> ({worktree.branch})</Text> : null}
            {worktree.domains.map(d => (
              <Text key={`d-${d.name}`}>
                {' '}
                <Text color="#000000" backgroundColor={d.color}>{` ${d.name} `}</Text>
              </Text>
            ))}
            {worktree.ticket ? (
              <Text key="ticket">
                {'   '}
                <Link href={worktree.ticket.url}>{worktree.ticket.id}</Link>
              </Text>
            ) : null}
            {worktree.pr ? (
              <Text key="pr">
                {'   '}
                <Link href={worktree.pr.url}>{`PR #${worktree.pr.number}`}</Link>
                <Text dimColor>{` ${worktree.pr.isDraft && worktree.pr.state === 'OPEN' ? 'draft' : worktree.pr.state.toLowerCase()}`}</Text>
              </Text>
            ) : null}
          </Box>
        ) : null}
        <Box>
          {bar('model', modelLabel, session, clockTime(session?.resetsAt))}
          <Text>{'   |   '}</Text>
          {bar('fable', FABLE_LABEL, fable ?? undefined, countdown(fable?.resetsAt, now))}
        </Box>
        {engineLine}
      </Box>
    )
  })
}
