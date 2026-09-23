const { randomUUID } = require('crypto');

const MAX_LOG_ENTRIES = 500;

const sessions = new Map(); // sessionId -> Session

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function createSession(sessionId) {
  const session = {
    id: sessionId,
    wpm: 100,
    participants: new Map(), // clientId -> Participant
    queue: [],
    current: null, // { id, text, senderName, senderId, revealedCount, timer }
    log: [],
  };
  sessions.set(sessionId, session);
  return session;
}

function removeSessionIfEmpty(session) {
  if (session.participants.size === 0) {
    if (session.current && session.current.timer) {
      clearInterval(session.current.timer);
    }
    sessions.delete(session.id);
  }
}

function addParticipant(session, { name, role, ws }) {
  const id = randomUUID();
  const participant = { id, name, role, ws, connectedAt: Date.now(), lastSubmitAt: 0 };
  session.participants.set(id, participant);
  return participant;
}

// Appends to the log, trimming the oldest entry once the cap is reached, so
// a long-running session can't grow its log without bound.
function pushLog(session, entry) {
  session.log.push(entry);
  if (session.log.length > MAX_LOG_ENTRIES) {
    session.log.shift();
  }
}

function removeParticipant(session, clientId) {
  session.participants.delete(clientId);
  removeSessionIfEmpty(session);
}

function rosterSnapshot(session) {
  return [...session.participants.values()].map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
  }));
}

module.exports = {
  sessions,
  getSession,
  createSession,
  removeSessionIfEmpty,
  addParticipant,
  removeParticipant,
  rosterSnapshot,
  pushLog,
};
