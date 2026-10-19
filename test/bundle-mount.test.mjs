/**
 * End-to-end lock on the SHIPPED artifact: the built host bundle (lib/index.js)
 * mounted into a stub host, exercised with the Desktop composition's forwarded
 * request shape.
 *
 * test/routes-guard.test.mjs proves the route module's guard; this one proves the
 * wiring that ships — `apply()` acquiring webServer, mounting /caveman/*, and
 * persisting a Desktop-shaped write — so a bundle that drifts from src cannot
 * pass the suite.
 *
 * Run: node --test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

/** Platform fence port (see test/routes-guard.test.mjs for the source). */
function platformRejection(headers) {
  const host = headers.host
  if (host === undefined) return 403
  if (headers['sec-fetch-site'] === 'cross-site') return 403
  const origin = headers.origin
  if (origin !== undefined && new URL(origin).host !== host) return 403
  return headers.cookie === undefined ? 401 : undefined
}

/** Mount the built plugin into a real HTTP server with stub host services. */
async function startBundleHost() {
  const home = mkdtempSync(join(tmpdir(), 'caveman-home-'))
  // stateDir() reads homedir() lazily on first load/save, so redirecting the
  // home here keeps the machine's real ~/.dsh-caveman/state.json untouched.
  const previousHome = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME }
  process.env.USERPROFILE = home
  process.env.HOME = home

  const routes = new Map()
  const commands = []
  const webServer = {
    register(route) {
      routes.set(route.path, route.handler)
      return () => routes.delete(route.path)
    },
  }
  const connection = { requestRejection: (request) => platformRejection(request.headers) }
  const ctx = {
    get: (name) => (name === 'webServer' ? webServer : name === 'connection' ? connection : undefined),
    effect: (body) => {
      // Two shapes in play: a generator that yields disposables (the lifetime
      // section + commands) and a plain arrow returning one disposer (routes).
      const result = body()
      if (result !== undefined && typeof result.next === 'function') {
        let step = result.next()
        while (step.done !== true) step = result.next()
        return () => {}
      }
      return typeof result === 'function' ? result : () => {}
    },
    inject: (_names, body) => {
      body(ctx)
      return () => {}
    },
    systemPrompt: { context: () => ({ dispose: () => {} }) },
    commands: { register: (command) => { commands.push(command); return () => {} } },
  }

  apply(ctx)

  const server = createServer((request, response) => {
    const handler = routes.get(new URL(request.url, 'http://localhost').pathname)
    if (handler === undefined) {
      response.writeHead(404).end()
      return
    }
    Promise.resolve(handler(request, response)).catch(() => response.destroy())
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    base: `http://127.0.0.1:${server.address().port}`,
    commands,
    stateFile: join(home, '.dsh-caveman', 'state.json'),
    close: async () => {
      await new Promise((resolve) => server.close(resolve))
      process.env.USERPROFILE = previousHome.USERPROFILE
      process.env.HOME = previousHome.HOME
      rmSync(home, { recursive: true, force: true })
    },
  }
}

test('built bundle: desktop-forwarded write flips state and persists it', async () => {
  const host = await startBundleHost()
  try {
    const before = await (await fetch(`${host.base}/caveman/status`)).json()
    assert.deepEqual(before, { enabled: false, level: 'full' })

    // The exact Desktop shape: no origin, host cookie attached.
    const response = await fetch(`${host.base}/caveman/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'dsh-auth-host=<signed>' },
      body: JSON.stringify({ enabled: true }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { enabled: true, level: 'full' })

    const after = await (await fetch(`${host.base}/caveman/status`)).json()
    assert.deepEqual(after, { enabled: true, level: 'full' })
    assert.deepEqual(JSON.parse(readFileSync(host.stateFile, 'utf8')), { enabled: true, level: 'full' })

    // The prompt section follows the live state (the point of the toggle).
    assert.deepEqual(host.commands.map((command) => command.name).sort(), [
      'caveman-level', 'caveman-off', 'caveman-on', 'caveman-status',
    ])
  } finally {
    await host.close()
  }
})

test('built bundle: cross-site write is still refused', async () => {
  const host = await startBundleHost()
  try {
    const response = await fetch(`${host.base}/caveman/state`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
        cookie: 'dsh-auth-host=<signed>',
        'sec-fetch-site': 'cross-site',
      },
      body: JSON.stringify({ enabled: true }),
    })
    assert.equal(response.status, 403)
    assert.deepEqual(await (await fetch(`${host.base}/caveman/status`)).json(), { enabled: false, level: 'full' })
  } finally {
    await host.close()
  }
})
