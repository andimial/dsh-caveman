/**
 * Route-guard regression lock for 「设置页的输出精简开关点了没反应」.
 *
 * ROOT CAUSE THIS LOCKS DOWN
 * The Desktop composition runs its renderer on `dsh-app://app`; every plugin
 * HTTP request the renderer makes is forwarded to the host loopback server by
 * the Electron main process (`dsh-desktop` `forwardWebRequest`), which DELETES
 * the `host`, `origin`, `cookie` and `sec-fetch-site` headers and re-attaches the
 * host's own signed cookie. The route's old `sameOrigin()` guard required an
 * `origin` header that is present and equal to `host`, so every Desktop write
 * was answered `403 {"error":"untrusted origin"}`; the browser half swallows
 * that rejection, so the toggle rendered and clicking it did nothing.
 *
 * THE CONTRACT
 * Writes are admitted by the host's own `connection` service
 * (`@deepseek-ai/dsh-client-connection` → `Connection.requestRejection`: 403 on
 * a failed Host/Origin fence, 401 without the signed browser cookie, undefined
 * when admitted) whenever that service is present, and by the classic
 * Origin===Host CSRF check when it is absent (CLI-only compositions).
 *
 * Run: node --test test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mountCavemanRoutes } from '../src/routes.ts'

/** Faithful port of the platform fence this plugin delegates to. */
function platformRejection(headers) {
  const host = headers.host
  if (host === undefined) return 403
  if (headers['sec-fetch-site'] === 'cross-site') return 403
  const origin = headers.origin
  if (origin !== undefined && new URL(origin).host !== host) return 403
  return headers.cookie === undefined ? 401 : undefined
}

/** Mount the real routes on a real server with a stubbed host context. */
async function startHost({ connection }) {
  let state = { enabled: false, level: 'full' }
  const routes = new Map()
  const webServer = {
    register(route) {
      routes.set(route.path, route.handler)
      return () => routes.delete(route.path)
    },
  }
  const ctx = {
    get(name) {
      if (name === 'webServer') return webServer
      if (name === 'connection') return connection
      return undefined
    },
  }
  mountCavemanRoutes(ctx, () => state, (next) => { state = next })
  const server = createServer((request, response) => {
    const handler = routes.get(new URL(request.url, 'http://localhost').pathname)
    if (handler === undefined) {
      response.writeHead(404).end()
      return
    }
    Promise.resolve(handler(request, response)).catch(() => response.destroy())
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    base,
    getState: () => state,
    send: (path, init) => fetch(base + path, init),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function post(base, headers, body) {
  return fetch(`${base}/caveman/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

test('desktop composition: forwarded write (no origin, host cookie) is admitted', async () => {
  const host = await startHost({ connection: { requestRejection: (request) => platformRejection(request.headers) } })
  try {
    const response = await post(host.base, { cookie: 'dsh-auth-host=<signed>' }, { enabled: true })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { enabled: true, level: 'full' })
    assert.equal(host.getState().enabled, true)
  } finally {
    await host.close()
  }
})

test('desktop composition: forwarded write without the host cookie is 401', async () => {
  const host = await startHost({ connection: { requestRejection: (request) => platformRejection(request.headers) } })
  try {
    const response = await post(host.base, {}, { enabled: true })
    assert.equal(response.status, 401)
    assert.equal(host.getState().enabled, false)
  } finally {
    await host.close()
  }
})

test('cross-site write is 403 even with a connection service present', async () => {
  const host = await startHost({ connection: { requestRejection: (request) => platformRejection(request.headers) } })
  try {
    const response = await post(host.base, {
      origin: 'https://evil.example',
      cookie: 'dsh-auth-host=<signed>',
      'sec-fetch-site': 'cross-site',
    }, { enabled: true })
    assert.equal(response.status, 403)
    assert.equal(host.getState().enabled, false)
  } finally {
    await host.close()
  }
})

test('browser composition: direct write with a matching origin is admitted', async () => {
  const host = await startHost({ connection: { requestRejection: (request) => platformRejection(request.headers) } })
  try {
    const response = await post(host.base, { origin: host.base, cookie: 'dsh-auth-host=<signed>' }, { enabled: true })
    assert.equal(response.status, 200)
    assert.equal(host.getState().enabled, true)
  } finally {
    await host.close()
  }
})

test('no connection service: Origin===Host fallback still admits the browser and refuses no-origin', async () => {
  const host = await startHost({ connection: undefined })
  try {
    const refused = await post(host.base, {}, { enabled: true })
    assert.equal(refused.status, 403)
    const admitted = await post(host.base, { origin: host.base }, { enabled: true })
    assert.equal(admitted.status, 200)
    assert.equal(host.getState().enabled, true)
  } finally {
    await host.close()
  }
})

test('GET /caveman/status is readable from every composition', async () => {
  const host = await startHost({ connection: { requestRejection: (request) => platformRejection(request.headers) } })
  try {
    const response = await fetch(`${host.base}/caveman/status`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { enabled: false, level: 'full' })
  } finally {
    await host.close()
  }
})
