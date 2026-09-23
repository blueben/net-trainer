const { pushLog } = require('./session');

// A "doubling": someone sends while another message is actively playing.
// Both transmissions are lost, mimicking two people keying up over each other.
const COLLISION_DELAY_MS = 1500;

// tryStartNext is passed in (rather than required) to avoid a circular
// dependency with playback.js, which requires this module.
function handleCollision(session, broadcast, newMessage, tryStartNext) {
  const interrupted = session.current;
  clearInterval(interrupted.timer);
  session.current = null;

  const interruptedLog = {
    id: interrupted.id,
    senderName: interrupted.senderName,
    senderId: interrupted.senderId,
    fullText: interrupted.text.join(' '),
    submittedAt: interrupted.submittedAt,
    status: 'doubled-lost',
    playedAt: Date.now(),
  };
  const newMessageLog = {
    id: newMessage.id,
    senderName: newMessage.senderName,
    senderId: newMessage.senderId,
    fullText: newMessage.text.join(' '),
    submittedAt: newMessage.submittedAt,
    status: 'doubled-new-lost',
    playedAt: Date.now(),
  };
  pushLog(session, interruptedLog);
  pushLog(session, newMessageLog);
  broadcast({ type: 'log-update', entry: interruptedLog }, { instructorOnly: true });
  broadcast({ type: 'log-update', entry: newMessageLog }, { instructorOnly: true });

  broadcast({ type: 'collision' });

  setTimeout(() => {
    tryStartNext(session, broadcast);
  }, COLLISION_DELAY_MS);
}

module.exports = { handleCollision, COLLISION_DELAY_MS };
