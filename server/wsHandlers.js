const {
  getOrCreateSession,
  addParticipant,
  removeParticipant,
  rosterSnapshot,
} = require('./session');
const { submitMessage, wordIntervalMs } = require('./playback');

const INSTRUCTOR_PASSCODE = process.env.INSTRUCTOR_PASSCODE || null;
const DEFAULT_SESSION_ID = 'NET1';

function send(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Broadcasts to every participant in the session. Pass { instructorOnly: true }
// to restrict delivery to instructor sockets (used for the hidden transcript).
function makeBroadcast(session) {
  return (message, opts = {}) => {
    for (const participant of session.participants.values()) {
      if (opts.instructorOnly && participant.role !== 'instructor') continue;
      send(participant.ws, message);
    }
  };
}

function sessionSnapshot(session, forParticipant) {
  const snapshot = {
    wpm: session.wpm,
    participants: rosterSnapshot(session),
    queueLength: session.queue.length,
    current: null,
  };

  if (session.current) {
    snapshot.current = {
      id: session.current.id,
      senderName: session.current.senderName,
      wordCount: session.current.text.length,
      revealedCount: session.current.revealedCount,
      intervalMs: wordIntervalMs(session.wpm),
    };
  }

  if (forParticipant.role === 'instructor') {
    snapshot.log = session.log;
  }

  return snapshot;
}

function handleConnection(ws) {
  let session = null;
  let participant = null;

  ws.on('error', (err) => console.error('[ws]', err));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'join') {
      handleJoin(msg);
      return;
    }

    // All other message types require an established session/participant.
    if (!session || !participant) return;

    if (msg.type === 'submit' && typeof msg.text === 'string') {
      submitMessage(session, makeBroadcast(session), {
        senderId: participant.id,
        senderName: participant.name,
        text: msg.text,
      });
      return;
    }

    if (msg.type === 'set-wpm' && participant.role === 'instructor') {
      const wpm = Number(msg.wpm);
      if (Number.isFinite(wpm) && wpm >= 20 && wpm <= 300) {
        session.wpm = wpm;
        makeBroadcast(session)({ type: 'wpm-changed', wpm });
      }
      return;
    }

    if (msg.type === 'kick' && participant.role === 'instructor') {
      const target = session.participants.get(msg.targetId);
      if (target && target.id !== participant.id) {
        send(target.ws, { type: 'kicked' });
        target.ws.close();
        removeParticipant(session, target.id);
        makeBroadcast(session)({ type: 'roster-update', participants: rosterSnapshot(session) });
      }
      return;
    }
  });

  ws.on('close', () => {
    if (session && participant) {
      removeParticipant(session, participant.id);
      if (session.participants.size > 0) {
        makeBroadcast(session)({ type: 'roster-update', participants: rosterSnapshot(session) });
      }
    }
  });

  function handleJoin(msg) {
    if (session) return; // already joined on this socket

    const name = String(msg.name || '').trim().slice(0, 40) || 'Anonymous';
    const sessionId = String(msg.sessionCode || DEFAULT_SESSION_ID).trim().toUpperCase().slice(0, 20) || DEFAULT_SESSION_ID;
    const requestedRole = msg.role === 'instructor' ? 'instructor' : 'participant';

    if (requestedRole === 'instructor' && INSTRUCTOR_PASSCODE && msg.passcode !== INSTRUCTOR_PASSCODE) {
      send(ws, { type: 'join-error', reason: 'Incorrect instructor passcode.' });
      return;
    }

    session = getOrCreateSession(sessionId);
    participant = addParticipant(session, { name, role: requestedRole, ws });

    send(ws, {
      type: 'joined',
      you: { id: participant.id, name: participant.name, role: participant.role },
      sessionId,
      snapshot: sessionSnapshot(session, participant),
    });

    makeBroadcast(session)({ type: 'roster-update', participants: rosterSnapshot(session) });
  }
}

module.exports = { handleConnection };
