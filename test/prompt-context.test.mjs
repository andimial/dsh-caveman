/**
 * Regression lock for 「PTC 模式下精简规则没进 prompt」.
 *
 * ROOT CAUSE THIS LOCKS DOWN
 * Host 0.2.1-rc.2 drops a deployment-scope plugin's systemPrompt.section from
 * PTC-mode prompts (the sessions whose only tool is run_code); the same session
 * still delivers runtime context. So the terseness rule must be registered with
 * systemPrompt.context — required, function-valued, resolving the live state —
 * and must no longer ride the section slot at all.
 *
 * Run: node --test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { CONTEXT_ORDER, LEVELS } from '../src/constants.ts'

/**
 * Mount the built bundle into a stub host whose home is a temp directory, so
 * loadState() reads the state this test planted and the machine's real
 * ~/.dsh-caveman/state.json is never touched.
 */
function mountBundle(state) {
  const home = mkdtempSync(join(tmpdir(), 'caveman-home-'))
  const previousHome = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME }
  process.env.USERPROFILE = home
  process.env.HOME = home
  if (state !== undefined) {
    mkdirSync(join(home, '.dsh-caveman'), { recursive: true })
    writeFileSync(join(home, '.dsh-caveman', 'state.json'), JSON.stringify(state))
  }

  const contexts = []
  const sections = []
  const commands = []
  const disposer = { dispose: () => {} }
  const ctx = {
    get: () => undefined,
    effect: (body) => {
      const result = body()
      if (result !== undefined && typeof result.next === 'function') {
        let step = result.next()
        while (step.done !== true) step = result.next()
        return () => {}
      }
      return typeof result === 'function' ? result : () => {}
    },
    inject: () => () => {},
    systemPrompt: {
      context: (entry) => { contexts.push(entry); return disposer },
      section: (entry) => { sections.push(entry); return disposer },
    },
    commands: { register: (command) => { commands.push(command); return () => {} } },
  }

  apply(ctx)

  return {
    contexts,
    sections,
    commands,
    close: () => {
      process.env.USERPROFILE = previousHome.USERPROFILE
      process.env.HOME = previousHome.HOME
      rmSync(home, { recursive: true, force: true })
    },
  }
}

test('built bundle: registers runtime context, never a prompt section', () => {
  const host = mountBundle({ enabled: false, level: 'full' })
  try {
    assert.equal(host.sections.length, 0)
    assert.equal(host.contexts.length, 1)
    const [entry] = host.contexts
    assert.equal(entry.name, 'caveman')
    assert.equal(entry.required, true)
    assert.equal(typeof entry.text, 'function')
    // Context order space, ahead of the host's WORKING_DIRECTORY=100.
    assert.equal(entry.order, CONTEXT_ORDER)
    assert.ok(entry.order < 100, 'context order must precede WORKING_DIRECTORY')
  } finally {
    host.close()
  }
})

test('built bundle: context text follows the enabled level', () => {
  const host = mountBundle({ enabled: true, level: 'ultra' })
  try {
    assert.equal(host.contexts[0].text(), LEVELS.ultra)
  } finally {
    host.close()
  }
})

test('built bundle: context text is empty while disabled and follows the toggle', async () => {
  const host = mountBundle({ enabled: false, level: 'full' })
  try {
    assert.equal(host.contexts[0].text(), '')
    const on = host.commands.find((command) => command.name === 'caveman-on')
    assert.ok(on !== undefined, 'caveman-on must stay registered')
    await on.handler({})
    // Resolved per assembly from the live state, not captured at registration.
    assert.equal(host.contexts[0].text(), LEVELS.full)
  } finally {
    host.close()
  }
})
