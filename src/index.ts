/**
 * dsh-caveman host half: injects an output-terseness rule into the model's
 * system prompt, driven by chat commands AND a browser UI, persisted to a
 * private state file.
 *
 * WHY A BROWSER HALF WITH CUSTOM HTTP ROUTES (NOT SETTINGS):
 * The dsh API gateway serves only an allowlisted set of settings namespaces to
 * the browser (model-provider namespaces + hardcoded WEB/PRODUCT allowlists).
 * A plugin-owned namespace is filtered with `settings-not-exposed`, so a
 * settings-page toggle can never read or write it through the settings API.
 * The proven escape hatch (used by dsh-market) is a dual-face plugin: the host
 * half registers plain HTTP routes on ctx.webServer and the browser half
 * fetches them directly. Same-origin checks guard writes.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-commands'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { CONTEXT_ORDER, DEFAULT_LEVEL, LEVELS, PLUGIN_NAME, type CavemanLevel } from './constants.ts'
import { mountCavemanRoutes } from './routes.ts'

export const name = PLUGIN_NAME
export const inject = ['systemPrompt', 'commands']

interface CavemanConfig {
  enabled: boolean
  level: CavemanLevel
}

const DEFAULT_CONFIG: CavemanConfig = { enabled: false, level: DEFAULT_LEVEL }

/** Private state file, outside settings.yaml (which the gateway allowlists). */
function stateDir(): string {
  return join(homedir(), '.dsh-caveman')
}

function stateFile(): string {
  return join(stateDir(), 'state.json')
}

function loadState(): CavemanConfig {
  try {
    if (!existsSync(stateFile())) return { ...DEFAULT_CONFIG }
    const parsed = JSON.parse(readFileSync(stateFile(), 'utf8')) as Partial<CavemanConfig>
    const level = parsed.level !== undefined && Object.hasOwn(LEVELS, parsed.level) ? parsed.level : DEFAULT_LEVEL
    return { enabled: parsed.enabled === true, level }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

function saveState(state: CavemanConfig): void {
  try {
    mkdirSync(stateDir(), { recursive: true })
    writeFileSync(stateFile(), JSON.stringify(state, null, 2))
  } catch {
    /* best-effort persistence */
  }
}

export function apply(ctx: Context): void {
  let state: CavemanConfig = loadState()

  const setState = (next: CavemanConfig): void => {
    state = next
    saveState(next)
  }

  ctx.effect(function* () {
    // Runtime context, not a prompt section: on host 0.2.1-rc.2 a deployment
    // plugin's section is dropped from PTC-mode prompts, while context still
    // reaches the model. required=true keeps it past runtime-context suppression.
    // Empty text (disabled) is filtered out by the host, so no fixture prose.
    yield ctx.systemPrompt.context({
      name: 'caveman',
      order: CONTEXT_ORDER,
      text: () => (state.enabled ? LEVELS[state.level] : ''),
      required: true,
    })

    yield ctx.commands.register({
      name: 'caveman-on',
      description: '开启输出精简（caveman 模式）',
      handler: async () => {
        setState({ ...state, enabled: true })
        return { kind: 'success', text: `输出精简已开启（档位 ${state.level}）` }
      },
    })

    yield ctx.commands.register({
      name: 'caveman-off',
      description: '关闭输出精简',
      handler: async () => {
        setState({ ...state, enabled: false })
        return { kind: 'success', text: '输出精简已关闭' }
      },
    })

    yield ctx.commands.register({
      name: 'caveman-level',
      description: '切换档位：lite / full / ultra / wenyan-full',
      handler: async (invocation: any) => {
        const raw = String(invocation.rawInput ?? '').trim().toLowerCase()
        if (!Object.hasOwn(LEVELS, raw)) {
          return { kind: 'error', text: `未知档位「${raw}」，可选：${Object.keys(LEVELS).join(' / ')}` }
        }
        setState({ ...state, level: raw as CavemanLevel, enabled: true })
        return { kind: 'success', text: `档位已切到 ${raw}` }
      },
    })

    yield ctx.commands.register({
      name: 'caveman-status',
      description: '查看输出精简状态',
      handler: async () => {
        return {
          kind: 'success',
          text: state.enabled ? `输出精简：开启（档位 ${state.level}）` : '输出精简：关闭',
        }
      },
    })
  }, 'dsh-caveman lifecycle')

  // Browser UI data plane. webServer only exists in web profiles — a CLI-only
  // deployment simply skips mounting and keeps commands + skill working.
  // IMPORTANT: use ctx.inject, NOT ctx.get — plugin apply() runs BEFORE the
  // webServer service is started, so a synchronous ctx.get('webServer')
  // returns undefined and the routes silently never mount (observed as the
  // SPA fallback answering /caveman/*). inject defers until it exists.
  ctx.inject(['webServer'], (scoped: Context) => {
    scoped.effect(() => mountCavemanRoutes(
      scoped,
      () => state,
      (next) => setState(next),
    ), 'dsh-caveman ui routes')
  })
}
