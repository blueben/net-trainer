const COLLISION_EFFECT_MS = 1500; // must match server/collision.js COLLISION_DELAY_MS

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

  const name = document.getElementById('join-name').value;
  const sessionCode = document.getElementById('join-code').value;
  const role = joinForm.role.value;
  const passcode = document.getElementById('join-passcode').value;

  connect({ name, sessionCode, role, passcode });
});

function connect({ name, sessionCode, role, passcode }) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'join', name, sessionCode, role, passcode }));
  });

  ws.addEventListener('message', (event) => {
    handleServerMessage(JSON.parse(event.data));
  });

  ws.addEventListener('close', () => {
    if (netScreen.hidden === false) {
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
      radioText.textContent = '';
      radioStatus.textContent = `Receiving from ${msg.senderName}...`;
      break;
    case 'word-reveal':
      radioText.textContent = radioText.textContent ? `${radioText.textContent} ${msg.word}` : msg.word;
      break;
    case 'message-end':
      radioStatus.textContent = 'Channel idle';
      setTimeout(() => {
        radioText.textContent = '';
      }, 400);
      break;
    case 'collision':
      radioStatus.textContent = 'DOUBLE — transmissions lost';
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
    radioStatus.textContent = `Receiving from ${msg.snapshot.current.senderName}...`;
  } else {
    radioStatus.textContent = 'Channel idle';
  }
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
  row.innerHTML = `
    <td>${time}</td>
    <td>${escapeHtml(entry.senderName)}</td>
    <td>${escapeHtml(entry.fullText)}</td>
    <td class="status-${entry.status}">${entry.status}</td>
  `;
  logBody.prepend(row);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
