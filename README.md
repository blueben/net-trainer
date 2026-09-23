# Radio Net Trainer

A training simulator for radio net / message-passing drills. Participants type
messages that play back word-by-word at a configurable speech rate, then
disappear — like listening to a real net rather than reading a chat log. If
two people transmit while the channel is busy, both transmissions are lost
("doubling"), matching real radio behavior.

## Run it

```bash
npm install
npm start
```

Open `http://localhost:3000` in a browser. Open multiple tabs/windows to
simulate multiple participants.

Optional: set `INSTRUCTOR_PASSCODE` to require a passcode for joining as
instructor (not real security, just guards against accidental role
selection):

```bash
INSTRUCTOR_PASSCODE=training123 npm start
```

If participants join from other devices on the same network (not just
`localhost`), set `ALLOWED_ORIGINS` to the address they'll use, or the
WebSocket connection will be rejected:

```bash
ALLOWED_ORIGINS=http://192.168.1.50:3000 npm start
```

Separate multiple origins with commas.

## Deploying

`Dockerfile` builds the app as a single container; `deploy/ecs-deploy.sh`
walks through standing it up on ECS Fargate (one task, behind an
HTTP-only ALB, us-west-2, default VPC). Session state lives in memory in
one process, so the service stays pinned at `desiredCount: 1` — read the
script before running it.

## Roles

- **Participant**: can type and send messages into the net, watches messages
  play back live.
- **Instructor**: everything a participant can do, plus a hidden transcript
  panel (full log, including doubled/lost messages, for after-action
  review), a live WPM (words-per-minute) control, and the ability to remove
  a participant from the session.

There's no name field. Joining assigns a station label ("Station 1",
"Station 2", ...) used only for the roster and the instructor's transcript.
As on a real net, say who you are inside the message itself — the send box
prompts for a call sign or name. The server also records each participant's
IP address for the instructor's audit log; it isn't shown in the UI.

Speech is how the net is received — there are no participant-facing controls
for it. Each browser reads each word aloud as it arrives, using the Web
Speech API, with each station assigned a distinct, consistent voice for the
session (picked from the browser's available voices by hashing the station
label) so listeners can tell speakers apart by ear. Speech isn't synced to
the on-screen word reveal — it just plays at its own pace — so the
word-by-word text sits collapsed under a "Show words on screen" fold instead
of being the main display. If speech fails (browser doesn't support it, or
playback errors out), a message says so and the fold opens automatically.

A low, filtered white-noise loop plays behind each transmission, like an
open radio channel: it starts when a message starts and stops 2 seconds
after it ends, rather than running for the whole session. It's generated
locally with the Web Audio API. The audio context itself is unlocked on the
join click (required for browsers' autoplay rules), even though the noise
doesn't start until the first message — otherwise the later, non-gesture
start would be silently blocked. Not adjustable, same "no participant
controls" approach as speech itself.

## Manual test script

1. `npm install && npm start`, open 3 tabs at `http://localhost:3000`.
2. Join Tab A as Instructor, Tabs B and C as Participants (same session
   code). Verify only Tab A shows the transcript/WPM/roster-kick controls.
3. Send a short message from Tab B. Verify all three tabs speak the words
   aloud, and Tab A's transcript logs it as `played`. Open the "Show words on
   screen" fold on one tab and confirm the words still appear and clear
   there too.
4. From different tabs, submit 2-3 messages while the channel is idle.
   Verify they play in submission order, one at a time.
5. **Collision test**: lower the WPM (Tab A) so playback is slow, have Tab B
   send a longer message, then while it's still visibly revealing words,
   have Tab C send another message. Verify all tabs show a garbled/collision
   effect instead of either message's content, then the net returns to
   idle (or advances to the next queued message). Verify Tab A's transcript
   shows both messages with their real text, marked `doubled-lost` and
   `doubled-new-lost`.
6. Change WPM from Tab A mid-session; verify it applies to the next message
   sent, not one already playing.
7. Kick Tab C from Tab A; verify Tab C is disconnected and Tabs A/B see the
   roster update.
8. Try joining as instructor with the wrong passcode (if configured);
   verify a clean rejection.
9. Close all tabs, then rejoin with the same session code; verify the server
   is still running and a fresh session starts cleanly.
