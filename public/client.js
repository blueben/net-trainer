const COLLISION_EFFECT_MS = 1500; // must match server/collision.js COLLISION_DELAY_MS
const WORD_DISPLAY_MS = 2200; // how long a single word stays on screen before it fades
const WORD_FADE_MS = 300; // portion of WORD_DISPLAY_MS spent fading out
let wordTimers = []; // pending {fadeTimeout, removeTimeout} pairs, for cleanup
const canSpeak = 'speechSynthesis' in window;

const joinScreen = document.getElementById('join-screen');
const joinForm = document.getElementById('join-form');
const joinError = document.getElementById('join-error');
const passcodeField = document.getElementById('passcode-field');

const netScreen = document.getElementById('net-screen');
const headerSessionCode = document.getElementById('header-session-code');
const rosterEl = document.getElementById('roster');
const radioText = document.getElementById('radio-text');
const radioStatus = document.getElementById('radio-status');
const sendForm = document.getElementById('send-form');
const sendText = document.getElementById('send-text');
const instructorPanel = document.getElementById('instructor-panel');
const wpmSlider = document.getElementById('wpm-slider');
const wpmValue = document.getElementById('wpm-value');
const logBody = document.getElementById('log-body');
const speechFallback = document.getElementById('speech-fallback');
const textFold = document.getElementById('text-fold');

if (!canSpeak) {
  showSpeechFallback();
}

function showSpeechFallback() {
  speechFallback.hidden = false;
  textFold.open = true;
}

const SPEECH_RATE = 1;
let voicePool = [];
let voiceBySender = new Map(); // senderName -> assigned voice, stable for the session
let currentVoice = null; // the voice for whichever message is currently playing

function loadVoicePool() {
  if (!canSpeak) return;
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return;
  const english = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
  voicePool = english.length ? english : voices;
}

if (canSpeak) {
  loadVoicePool();
  speechSynthesis.addEventListener('voiceschanged', loadVoicePool);
}

// Assigns each station a consistent voice for the session, so listeners can
// tell speakers apart by ear without any per-user controls.
function voiceForSender(senderName) {
  if (voicePool.length === 0) return null;
  if (!voiceBySender.has(senderName)) {
    let hash = 0;
    for (let i = 0; i < senderName.length; i++) hash = (hash * 31 + senderName.charCodeAt(i)) >>> 0;
    voiceBySender.set(senderName, voicePool[hash % voicePool.length]);
  }
  return voiceBySender.get(senderName);
}

let ws = null;
let me = null; // { id, name, role }

joinForm.querySelectorAll('input[name="role"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    passcodeField.hidden = joinForm.role.value !== 'instructor';
  });
});

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  joinError.hidden = true;

  const sessionCode = document.getElementById('join-code').value;
  const role = joinForm.role.value;
  const passcode = document.getElementById('join-passcode').value;

  connect({ sessionCode, role, passcode });
});

function connect({ sessionCode, role, passcode }) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'join', sessionCode, role, passcode }));
  });

  ws.addEventListener('message', (event) => {
    handleServerMessage(JSON.parse(event.data));
  });

  ws.addEventListener('close', () => {
    if (netScreen.hidden === false) {
      clearWords();
      cancelSpeech();
      radioStatus.textContent = 'Disconnected from net';
    }
  });
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'join-error':
      joinError.textContent = msg.reason;
      joinError.hidden = false;
      break;
    case 'joined':
      onJoined(msg);
      break;
    case 'roster-update':
      renderRoster(msg.participants);
      break;
    case 'message-start':
      clearWords();
      cancelSpeech();
      currentVoice = voiceForSender(msg.senderName);
      radioStatus.textContent = `Receiving from ${msg.senderName}...`;
      break;
    case 'word-reveal':
      addWord(msg.word);
      speakWord(msg.word);
      break;
    case 'message-end':
      radioStatus.textContent = 'Channel idle';
      break;
    case 'collision':
      clearWords();
      cancelSpeech();
      radioStatus.textContent = 'Two transmissions collided';
      startCollisionEffect(radioText, COLLISION_EFFECT_MS);
      setTimeout(() => {
        radioStatus.textContent = 'Channel idle';
      }, COLLISION_EFFECT_MS);
      break;
    case 'wpm-changed':
      wpmSlider.value = msg.wpm;
      wpmValue.textContent = msg.wpm;
      break;
    case 'kicked':
      alert('You have been removed from the net by the instructor.');
      break;
    case 'log-update':
      appendLogRow(msg.entry);
      break;
  }
}

function onJoined(msg) {
  me = msg.you;
  joinScreen.hidden = true;
  netScreen.hidden = false;
  headerSessionCode.textContent = `— ${msg.sessionId}`;

  renderRoster(msg.snapshot.participants);
  wpmSlider.value = msg.snapshot.wpm;
  wpmValue.textContent = msg.snapshot.wpm;

  if (me.role === 'instructor') {
    instructorPanel.hidden = false;
    (msg.snapshot.log || []).forEach(appendLogRow);
  }

  if (msg.snapshot.current) {
    currentVoice = voiceForSender(msg.snapshot.current.senderName);
    radioStatus.textContent = `Receiving from ${msg.snapshot.current.senderName}...`;
  } else {
    radioStatus.textContent = 'Channel idle';
  }
}

// Each word gets its own lifetime: it appears, sits, fades, then leaves the
// DOM — so the display only ever shows the last few words, like something
// spoken rather than a sentence building up and sitting there.
function addWord(word) {
  const span = document.createElement('span');
  span.className = 'radio-word';
  span.textContent = word;
  radioText.appendChild(span);

  const fadeTimeout = setTimeout(() => {
    span.classList.add('fading');
  }, WORD_DISPLAY_MS - WORD_FADE_MS);

  const removeTimeout = setTimeout(() => {
    span.remove();
  }, WORD_DISPLAY_MS);

  wordTimers.push(fadeTimeout, removeTimeout);
}

function clearWords() {
  wordTimers.forEach(clearTimeout);
  wordTimers = [];
  radioText.textContent = '';
}

// Speech isn't kept in sync with the on-screen word reveal — it just queues
// and plays at its own pace. The word display is the fallback, not the
// primary experience, so drift between the two doesn't matter.
function speakWord(word) {
  if (!canSpeak) return;
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.rate = SPEECH_RATE;
  if (currentVoice) utterance.voice = currentVoice;
  utterance.addEventListener('error', (e) => {
    // 'interrupted'/'canceled' are expected — cancelSpeech() clears the
    // queue when a message ends or a new one starts. Anything else means
    // speech itself isn't working.
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    showSpeechFallback();
  });
  speechSynthesis.speak(utterance);
}

function cancelSpeech() {
  if (canSpeak) speechSynthesis.cancel();
}

function renderRoster(participants) {
  rosterEl.innerHTML = '';
  participants.forEach((p) => {
    const chip = document.createElement('span');
    chip.className = `chip${p.role === 'instructor' ? ' instructor' : ''}`;
    chip.textContent = p.name;

    if (me && me.role === 'instructor' && p.id !== me.id) {
      const kickBtn = document.createElement('button');
      kickBtn.type = 'button';
      kickBtn.textContent = '✕';
      kickBtn.title = `Remove ${p.name}`;
      kickBtn.addEventListener('click', () => {
        ws.send(JSON.stringify({ type: 'kick', targetId: p.id }));
      });
      chip.appendChild(kickBtn);
    }

    rosterEl.appendChild(chip);
  });
}

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

sendForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = sendText.value.trim();
  if (!text || !ws) return;
  ws.send(JSON.stringify({ type: 'submit', text }));
  sendText.value = '';
});

wpmSlider.addEventListener('input', () => {
  wpmValue.textContent = wpmSlider.value;
});

wpmSlider.addEventListener('change', () => {
  if (!ws) return;
  ws.send(JSON.stringify({ type: 'set-wpm', wpm: Number(wpmSlider.value) }));
});
