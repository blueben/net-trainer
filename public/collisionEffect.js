// Renders a scrambled/garbled-text effect for the radio display when a
// "doubling" collision event arrives. No real message content is ever
// available client-side for a collision, so this just generates noise.
const GARBLE_CHARS = '#%&$@*!?/\\|~^';

function randomGarbleWord(length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += GARBLE_CHARS[Math.floor(Math.random() * GARBLE_CHARS.length)];
  }
  return out;
}

function randomGarbleLine() {
  const wordCount = 3 + Math.floor(Math.random() * 3);
  const words = [];
  for (let i = 0; i < wordCount; i++) {
    words.push(randomGarbleWord(2 + Math.floor(Math.random() * 5)));
  }
  return words.join(' ');
}

function startCollisionEffect(el, durationMs) {
  el.classList.add('collision');
  const intervalId = setInterval(() => {
    el.textContent = randomGarbleLine();
  }, 80);

  setTimeout(() => {
    clearInterval(intervalId);
    el.classList.remove('collision');
    el.textContent = '';
  }, durationMs);
}
