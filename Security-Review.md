# Security Review

**Date:** 2026-09-22
**Scope:** All application code at commit `0a8a72c` — `server/` (index, wsHandlers, session, playback, collision) and `public/` (client, collisionEffect, index.html).
**Framing:** OWASP Top 10 (2021).

## Threat model

The app is a classroom training simulator. There is no persistence, no user
accounts, and no PII store. The only secret is an optional shared instructor
passcode read from the environment.

Two properties of the deployment shape everything below:

- The server binds `0.0.0.0` by default, so anyone on the same network can
  reach it.
- The instructor transcript contains the full text of messages that
  participants are told were destroyed in a collision. That content is the
  main thing worth protecting here.

## Findings

| ID | Severity | Finding |
|---|---|---|
| [A01-2](#a01-2--no-origin-check-on-the-websocket-upgrade) | High | No Origin check on the WebSocket upgrade (CSWSH) |
| [A01-3](#a01-3--session-codes-are-guessable-and-auto-created) | Medium | Session codes are guessable and auto-created |
| [A05-4](#a05-4--participant-leak-on-repeated-join) | High | Participant leak on repeated join (confirmed) |
| [A05-5](#a05-5--no-maxpayload-limit) | High | No `maxPayload` limit; default is 100 MiB |
| [A05-6](#a05-6--no-error-handlers-on-ws-or-wss) | High | No `error` handlers on `ws` or `wss` |
| [A05-7](#a05-7--unbounded-queue-and-log) | Medium | Unbounded queue and log; no submit rate limit |
| [A05-8](#a05-8--no-heartbeat) | Low | No heartbeat; half-open sockets linger |
| [A05-9](#a05-9--missing-security-headers) | Low | Missing security headers |
| [A03-10](#a03-10--unescaped-status-in-an-innerhtml-sink) | Low | Unescaped `status` in an `innerHTML` sink |
| [A09-13](#a09-13--no-audit-logging) | Low | No audit logging of joins, kicks, or failed auth |

---

### A01-2 — No Origin check on the WebSocket upgrade

**Severity:** High
**Location:** `server/index.js:13`

`new WebSocketServer({ server, path: '/ws' })` accepts upgrade requests from
any origin. Any web page a participant visits while the trainer is running can
open a socket to it, join, and stream the entire net transcript out. This is
Cross-Site WebSocket Hijacking.

There are no cookies, so no credential is being replayed. The exposure comes
from the fact that joining requires nothing but a session code — so a
malicious page needs no stolen state to succeed.

**Remediation:** Reject upgrades whose `Origin` is not on an allowlist.

```js
const ALLOWED_ORIGINS = new Set([`http://localhost:${PORT}`]);

const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ origin }) => ALLOWED_ORIGINS.has(origin),
});
```

Note that non-browser clients can send any `Origin` they like; this defends
against browser-driven attacks, not against a direct connection.

---

### A01-3 — Session codes are guessable and auto-created

**Severity:** Medium
**Location:** `server/session.js:5`, `server/wsHandlers.js:115`

`getOrCreateSession` mints a session for any string it is handed, and the
default code is `NET1`. Codes carry no entropy and no ownership, so anyone who
guesses or observes a code joins that net. There is no way to run a private
session.

**Remediation:** Depends on how much you want the app to enforce. Options, in
increasing order of effort:

- Generate a random code when a session is created rather than accepting an
  arbitrary one, and have participants join only existing sessions.
- Require the instructor passcode to *create* a session, while letting
  participants join an existing one freely.

---

### A05-4 — Participant leak on repeated join

**Severity:** High
**Location:** `server/wsHandlers.js:113-134`

`handleJoin` can be called any number of times on a single socket. Each call
reassigns the `session` and `participant` closure variables but leaves the
previous participant registered in `session.participants`. The `close` handler
removes only the most recent one, so every earlier participant is stranded in
the map — which also keeps `removeSessionIfEmpty` from ever reclaiming the
session.

Confirmed by test: five joins on one socket produced five participants; after
closing that socket, four remained and the session was never freed. A single
connection can therefore grow memory without bound and permanently pollute the
roster.

**Remediation:** Make join idempotent per socket.

```js
function handleJoin(msg) {
  if (session) return; // already joined on this socket
  // ...
}
```

---

### A05-5 — No `maxPayload` limit

**Severity:** High
**Location:** `server/index.js:13`, `server/playback.js:10-12`

`ws` defaults `maxPayload` to 100 MiB (verified in
`ws/lib/websocket-server.js:74`), and the server does not override it. A client
can push frames of that size repeatedly.

The impact is amplified by `tokenize`, which runs
`text.trim().split(/\s+/)` across the **entire** string and only then slices to
50 words. A large payload builds a correspondingly large intermediate array
before any limit applies.

The client's `maxlength="500"` is a UI affordance, not a control — the server
accepts any string a socket sends.

**Remediation:** Bound both the frame and the field.

```js
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
```

```js
const MAX_TEXT_CHARS = 500;

function tokenize(text) {
  return text.slice(0, MAX_TEXT_CHARS).trim().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
}
```

---

### A05-6 — No `error` handlers on `ws` or `wss`

**Severity:** High
**Location:** `server/index.js`, `server/wsHandlers.js`

Neither the server nor individual sockets register an `error` listener. On an
`EventEmitter`, an unhandled `error` event is thrown — which terminates the
Node process and every session running on it. A single malformed frame or
abrupt transport failure is enough.

**Remediation:**

```js
wss.on('error', (err) => console.error('[wss]', err));
```

```js
function handleConnection(ws) {
  ws.on('error', (err) => console.error('[ws]', err));
  // ...
}
```

---

### A05-7 — Unbounded queue and log

**Severity:** Medium
**Location:** `server/playback.js:93`, `server/session.js:14`

Three related limits are missing:

- `session.queue.push` has no cap.
- There is no rate limit on `submit`, so one participant can enqueue
  continuously.
- `session.log` accumulates for the entire life of the session and is never
  trimmed.

None of these is reachable by accident in a classroom, but all are trivially
reachable by a script.

**Remediation:** Cap the queue (reject or drop when full), add a short
per-participant cooldown between submissions, and hold the log in a ring buffer
with a fixed ceiling.

---

### A05-8 — No heartbeat

**Severity:** Low
**Location:** `server/wsHandlers.js`

Without ping/pong, sockets that die without a clean close stay in the
participants map as phantom roster entries until TCP eventually gives up.

**Remediation:** Run the standard `ws` heartbeat — mark each socket alive on
`pong`, ping on an interval, and terminate any socket that missed the previous
round.

---

### A05-9 — Missing security headers

**Severity:** Low
**Location:** `server/index.js:10`

`express.static` serves the front end with no `Content-Security-Policy`,
`X-Content-Type-Options`, or `Referrer-Policy`. A CSP in particular is cheap
defense-in-depth for the `innerHTML` sink described in A03-10.

**Remediation:** `app.use(helmet())`, with `connect-src` configured to permit
the WebSocket origin.

---

### A03-10 — Unescaped `status` in an `innerHTML` sink

**Severity:** Low (not currently exploitable)
**Location:** `public/client.js:149-165`

`appendLogRow` escapes `senderName` and `fullText`, but interpolates
`entry.status` raw into both an attribute and a text node:

```js
<td class="status-${entry.status}">${entry.status}</td>
```

`status` is server-generated from three fixed literals, so there is no
injection today. It is flagged because the sink is unescaped and one refactor
away from carrying attacker-influenced data.

A related weakness makes that future worse: `escapeHtml` builds its result via
`textContent` → `innerHTML`, which escapes `&`, `<`, and `>` but **not quotes**.
That is correct for text nodes, where the other two values land — but it is the
wrong tool for the attribute context above, which is exactly where quote
escaping matters.

**Remediation:** Build the row from DOM nodes instead of markup, which removes
the sink rather than patching it.

```js
function appendLogRow(entry) {
  const row = document.createElement('tr');
  const time = new Date(entry.playedAt || entry.submittedAt).toLocaleTimeString();

  for (const value of [time, entry.senderName, entry.fullText, entry.status]) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.appendChild(cell);
  }
  row.lastChild.className = `status-${entry.status}`;

  logBody.prepend(row);
}
```

With every value set through `textContent` and the class set via `className`,
`escapeHtml` is no longer needed for this path.

---

### A09-13 — No audit logging

**Severity:** Low
**Location:** `server/wsHandlers.js`

Joins, kicks, and failed instructor passcode attempts are not recorded. Failed
authentication is the notable gap: a brute-force attempt against the passcode
is currently invisible, both live and after the fact.

**Remediation:** Log join, kick, and failed-auth events with a timestamp and
remote address. For a tool of this size, `console.error` is sufficient.

---

## Verified clean

- **Dependencies.** `npm audit --omit=dev` reports 0 vulnerabilities. express
  4.22.3 and ws 8.21.3 are both current.
- **Secrets.** Nothing sensitive is committed. The instructor passcode is read
  from the environment rather than hardcoded; `node_modules/` is ignored.
- **`set-wpm` validation.** Checked with `Number.isFinite` and bounded to
  20–300 before use.
- **`kick` authorization.** Scoped to the caller's own session map and prevents
  self-kick.
- **Identifiers.** Participant and message IDs use `crypto.randomUUID`.
- **XSS elsewhere in the client.** Roster chips and the radio display both
  assign through `textContent`.

## Not included in this review

Two findings from the review discussion were excluded from this document at the
maintainer's direction, and remain open:

- The instructor role is self-asserted at join time, and the passcode gate is
  optional — so with no passcode configured, any client can claim it.
- The passcode has no brute-force protection and is compared with `!==` rather
  than a constant-time comparison.

## Suggested order of work

`A05-4`, `A05-5`, and `A05-6` first — each is an outright crash or
resource-exhaustion vector, and all three are small, self-contained fixes.
`A01-2` next, as the only finding here that leaks transcript content to a
third party.
