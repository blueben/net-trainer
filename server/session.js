const { randomUUID } = require('crypto');

const sessions = new Map(); // sessionId -> Session

function getOrCreateSession(sessionId) {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      id: sessionId,
      wpm: 100,
      participants: new Map(), // clientId -> Participant
      queue: [],
      current: null, // { id, text, senderName, senderId, revealedCount, timer }
      log: [],
    };
    sessions.set(sessionId, session);
  }
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
  const participant = { id, name, role, ws, connectedAt: Date.now() };
  session.participants.set(id, participant);
  return participant;
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
  getOrCreateSession,
  removeSessionIfEmpty,
  addParticipant,
  removeParticipant,
  rosterSnapshot,
};
