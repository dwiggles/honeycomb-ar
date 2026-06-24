// Honeycomb AR — Phase 1: camera feed + screen-locked honeycomb dot overlay.
// Plane tracking (OpenCV.js homography) comes in Phase 2.

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const errorMsg = document.getElementById('error-msg');
const controls = document.getElementById('controls');
const toggleControls = document.getElementById('toggle-controls');
const panel = document.getElementById('panel');

const settings = {
  spacing: 56,   // distance between dots (CSS px)
  dotSize: 3,    // dot radius (CSS px)
  opacity: 0.85,
  color: '#00e5ff',
};

// --- Camera ---------------------------------------------------------------

async function startCamera() {
  errorMsg.textContent = '';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    startScreen.classList.add('hidden');
    controls.classList.remove('hidden');
    resize();
    requestAnimationFrame(draw);
  } catch (err) {
    errorMsg.textContent = describeError(err);
  }
}

function describeError(err) {
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    return 'Camera requires HTTPS. Open this page over https://.';
  }
  if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
    return 'Camera permission denied. Allow access in Settings and retry.';
  }
  if (err && err.name === 'NotFoundError') {
    return 'No camera found on this device.';
  }
  return 'Could not start camera: ' + (err && err.message ? err.message : err);
}

// --- Canvas sizing (handle device pixel ratio + orientation) --------------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// --- Honeycomb dot grid ---------------------------------------------------

// Hex-packed lattice: alternate rows offset by half a step, rows spaced by
// spacing * sqrt(3)/2. The dots sit on the vertices of a honeycomb tiling.
function draw() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);

  const s = settings.spacing;
  const rowH = s * Math.sqrt(3) / 2;
  ctx.globalAlpha = settings.opacity;
  ctx.fillStyle = settings.color;

  let row = 0;
  for (let y = -s; y <= h + s; y += rowH) {
    const offset = (row % 2) * (s / 2);
    for (let x = -s; x <= w + s; x += s) {
      ctx.beginPath();
      ctx.arc(x + offset, y, settings.dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
    row++;
  }

  requestAnimationFrame(draw);
}

// --- Controls -------------------------------------------------------------

toggleControls.addEventListener('click', () => panel.classList.toggle('hidden'));

document.getElementById('spacing').addEventListener('input', (e) => {
  settings.spacing = +e.target.value;
});
document.getElementById('dot-size').addEventListener('input', (e) => {
  settings.dotSize = +e.target.value;
});
document.getElementById('opacity').addEventListener('input', (e) => {
  settings.opacity = e.target.value / 100;
});
document.getElementById('color').addEventListener('input', (e) => {
  settings.color = e.target.value;
});

startBtn.addEventListener('click', startCamera);
