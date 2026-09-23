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

## Roles

- **Participant**: can type and send messages into the net, watches messages
  play back live.
- **Instructor**: everything a participant can do, plus a hidden transcript
  panel (full log, including doubled/lost messages, for after-action
  review), a live WPM (words-per-minute) control, and the ability to remove
  a participant from the session.

## Manual test script

1. `npm install && npm start`, open 3 tabs at `http://localhost:3000`.
2. Join Tab A as Instructor, Tabs B and C as Participants (same session
   code). Verify only Tab A shows the transcript/WPM/roster-kick controls.
3. Send a short message from Tab B. Verify all three tabs show the words
   appearing one at a time, then clearing, and Tab A's transcript logs it as
   `played`.
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
