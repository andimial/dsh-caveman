#!/usr/bin/env node
/**
 * Repro harness: 「设置页的『输出精简』开关点了没反应」 in the Desktop composition.
 *
 * WHAT IT DRIVES
 * The two request shapes the /caveman/* routes actually receive:
 *
 *  1. desktop shape — what the Desktop renderer's fetch produces after the
 *     Electron main process forwards it (dsh-desktop `forwardWebRequest`):
 *     `origin` / `host` / `cookie` / `sec-fetch-site` are DELETED and the host
 *     cookie is attached. So the request reaching the route has NO `origin`.
 *  2. browser shape — a browser (or curl) hitting the loopback server directly:
 *     `origin` equals `host`.
 *
 * The host guard in src/routes.ts (`sameOrigin`) requires `origin` to be present
 * AND to match `host`, so shape 1 is rejected with 403 and the browser half's
 * `writeState().catch()` swallows it: the button renders, the click does
 * nothing.
 *
 * USAGE
 *   node scripts/repro-desktop-toggle.mjs            # against the running host
 *   CAVEMAN_BASE=http://127.0.0.1:19387 node scripts/repro-desktop-toggle.mjs
 *
 * Exit 0 = green (both shapes write). Exit 1 = red (desktop shape rejected).
 * The original state is restored before exiting, whichever way it goes.
 */
const BASE = process.env.CAVEMAN_BASE ?? 'http://127.0.0.1:19387'
const STATUS_URL = `${BASE}/caveman/status`
const STATE_URL = `${BASE}/caveman/state`

/** POST /caveman/state and report the raw status + body. */
async function post(patch, headers) {
  const response = await fetch(STATE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(patch),
  })
  const text = await response.text()
  return { status: response.status, body: text }
}

/** The header set the Electron forwarder leaves in place (no `origin`). */
function desktopHeaders() {
  return {
    // forwardWebRequest() sets the host-issued cookie and drops origin/host/
    // sec-fetch-site; every other request header survives.
    cookie: 'dsh-host-session=<forwarded>',
  }
}

/** The header set a direct loopback browser request carries. */
function browserHeaders() {
  return { origin: BASE }
}

async function readState() {
  const response = await fetch(STATUS_URL, { cache: 'no-store' })
  return await response.json()
}

const failures = []

function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures.push(`${label}: expected ${expected}, got ${actual}`)
  console.log(`[repro] ${label}: ${actual}${ok ? '' : `  <-- expected ${expected}`}`)
}

const before = await readState()
console.log(`[repro] base            : ${BASE}`)
console.log(`[repro] state before    : ${JSON.stringify(before)}`)

// The exact symptom: click the settings toggle -> a POST of the flipped flag.
const flipped = { enabled: !before.enabled }

const desktop = await post(flipped, desktopHeaders())
console.log(`[repro] POST desktop shape (no origin): HTTP ${desktop.status} ${desktop.body}`)
check('desktop-shape write', desktop.status, 200)

let afterDesktop = await readState()
check('desktop-shape applied', afterDesktop.enabled, flipped.enabled)

// Control: the same write from a direct loopback browser request.
const browser = await post(flipped, browserHeaders())
console.log(`[repro] POST browser shape (origin=host): HTTP ${browser.status} ${browser.body}`)
check('browser-shape write', browser.status, 200)

// Restore whatever the user had before this harness ran.
const restore = await post(before, browserHeaders())
if (restore.status !== 200) {
  console.log(`[repro] WARNING: could not restore state: HTTP ${restore.status} ${restore.body}`)
}
const restored = await readState()
console.log(`[repro] state restored  : ${JSON.stringify(restored)}`)

if (failures.length > 0) {
  console.log('[repro] VERDICT: RED')
  for (const failure of failures) console.log(`[repro]   - ${failure}`)
  // No process.exit(): tearing the undici pool down mid-exit trips a libuv
  // assertion on Windows. The exit code alone carries the verdict.
  process.exitCode = 1
} else {
  console.log('[repro] VERDICT: GREEN')
}
