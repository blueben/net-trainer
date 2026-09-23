const { randomUUID } = require('crypto');
const { handleCollision } = require('./collision');
const { pushLog } = require('./session');

const MAX_WORDS = 50;
const MAX_TEXT_CHARS = 500;
const MAX_QUEUE_LENGTH = 20;

function wordIntervalMs(wpm) {
  return 60000 / wpm;
}

function tokenize(text) {
  return text.slice(0, MAX_TEXT_CHARS).trim().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
}

// Pulls the next queued message into `current` and starts the word-reveal timer.
// No-op if a message is already playing or the queue is empty.
function tryStartNext(session, broadcast) {
  if (session.current || session.queue.length === 0) return;

  const next = session.queue.shift();
  const intervalMs = wordIntervalMs(session.wpm);

  session.current = {
    id: next.id,
    text: next.text,
    senderName: next.senderName,
    senderId: next.senderId,
    submittedAt: next.submittedAt,
    revealedCount: 0,
    timer: null,
  };

  broadcast({
    type: 'message-start',
    id: next.id,
    senderName: next.senderName,
    text: next.text.join(' '),
    wordCount: next.text.length,
    intervalMs,
  });

  session.current.timer = setInterval(() => {
    const current = session.current;
    if (!current) return; // guard: cleared by a collision mid-tick

    broadcast({
      type: 'word-reveal',
      id: current.id,
      index: current.revealedCount,
      word: current.text[current.revealedCount],
    });
    current.revealedCount += 1;

    if (current.revealedCount >= current.text.length) {
      clearInterval(current.timer);
      broadcast({ type: 'message-end', id: current.id });

      const logEntry = {
        id: current.id,
        senderName: current.senderName,
        senderId: current.senderId,
        fullText: current.text.join(' '),
        submittedAt: current.submittedAt,
        status: 'played',
        playedAt: Date.now(),
      };
      pushLog(session, logEntry);
      broadcast({ type: 'log-update', entry: logEntry }, { instructorOnly: true });

      session.current = null;
      tryStartNext(session, broadcast);
    }
  }, intervalMs);
}

// Called when a participant sends a message. Detects the busy-channel collision
// case and otherwise queues the message for playback.
function submitMessage(session, broadcast, { senderId, senderName, text }) {
  const words = tokenize(text);
  if (words.length === 0) return;

  const message = {
    id: randomUUID(),
    text: words,
    senderName,
    senderId,
    submittedAt: Date.now(),
  };

  if (session.current) {
    handleCollision(session, broadcast, message, tryStartNext);
    return;
  }

  if (session.queue.length >= MAX_QUEUE_LENGTH) return; // net is congested; drop rather than grow without bound

  session.queue.push(message);
  tryStartNext(session, broadcast);
}

module.exports = { wordIntervalMs, tokenize, tryStartNext, submitMessage, MAX_WORDS };
