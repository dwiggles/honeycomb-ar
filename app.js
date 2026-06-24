// Honeycomb AR
// Phase 1: camera feed + screen-locked honeycomb dot overlay.
// Phase 2: lock the grid to a real surface via OpenCV.js plane tracking.

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const errorMsg = document.getElementById('error-msg');
const controls = document.getElementById('controls');
const toggleControls = document.getElementById('toggle-controls');
const panel = document.getElementById('panel');
const lockbar = document.getElementById('lockbar');
const lockBtn = document.getElementById('lock-btn');
const statusEl = document.getElementById('status');

const settings = {
  spacing: 56,   // distance between dots, in display px
  dotSize: 3,    // dot radius, in display px
  opacity: 0.85,
  color: '#00e5ff',
};

const tracker = new PlaneTracker();
let mode = 'screen';     // 'screen' (Phase 1) | 'locked' (Phase 2)
let gridRef = [];        // honeycomb points in tracker proc/plane space

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
    lockbar.classList.remove('hidden');
    resize();
    updateLockBtn();
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

// --- Canvas sizing --------------------------------------------------------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in display px
  if (mode === 'locked') buildGridRef();
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// --- proc/plane space <-> display space mapping ---------------------------
// The video is shown with object-fit: cover. coverScale + offsets describe that
// crop; combined with procScale they map a tracker point to a screen point.

function displayMapping() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const dispW = window.innerWidth, dispH = window.innerHeight;
  const coverScale = Math.max(dispW / vw, dispH / vh);
  return {
    factor: coverScale / tracker.procScale, // proc px -> display px
    offX: (dispW - vw * coverScale) / 2,
    offY: (dispH - vh * coverScale) / 2,
    dispW,
    dispH,
  };
}

// --- Honeycomb grids ------------------------------------------------------

// Screen-space honeycomb (Phase 1 + fallback).
function drawScreen() {
  const w = window.innerWidth, h = window.innerHeight;
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
}

// Build the honeycomb in tracker proc/plane space, covering the locked frame
// plus a margin so dots appear as you pan onto new parts of the surface.
function buildGridRef() {
  gridRef = [];
  if (!tracker.procW) return;
  const { factor } = displayMapping();
  const sProc = settings.spacing / factor; // display spacing -> proc spacing
  if (!(sProc > 0)) return;
  const rowH = sProc * Math.sqrt(3) / 2;
  const margin = 0.6;
  const x0 = -tracker.procW * margin, x1 = tracker.procW * (1 + margin);
  const y0 = -tracker.procH * margin, y1 = tracker.procH * (1 + margin);
  let row = 0;
  for (let y = y0; y <= y1; y += rowH) {
    const off = (row % 2) * (sProc / 2);
    for (let x = x0; x <= x1; x += sProc) gridRef.push({ x: x + off, y });
    row++;
  }
}

// Draw the honeycomb warped through the tracked homography.
function drawLocked() {
  const H = tracker.lastH;
  const { factor, offX, offY, dispW, dispH } = displayMapping();
  ctx.globalAlpha = settings.opacity;
  ctx.fillStyle = settings.color;
  for (const g of gridRef) {
    const w = H[6] * g.x + H[7] * g.y + H[8];
    if (w <= 0) continue;
    const cx = (H[0] * g.x + H[1] * g.y + H[2]) / w;
    const cy = (H[3] * g.x + H[4] * g.y + H[5]) / w;
    const sx = cx * factor + offX;
    const sy = cy * factor + offY;
    if (sx < -20 || sy < -20 || sx > dispW + 20 || sy > dispH + 20) continue;
    ctx.beginPath();
    ctx.arc(sx, sy, settings.dotSize, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- Main render loop -----------------------------------------------------

function draw() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if (mode === 'locked' && tracker.tracking) {
    const ok = tracker.update(video);
    if (ok) {
      drawLocked();
    } else {
      mode = 'screen';
      setStatus('Tracking lost — re-lock');
      updateLockBtn();
      drawScreen();
    }
  } else {
    drawScreen();
  }
  requestAnimationFrame(draw);
}

// --- Lock / unlock --------------------------------------------------------

function setStatus(text) { statusEl.textContent = text; }

function updateLockBtn() {
  if (!tracker.ready) {
    lockBtn.textContent = 'Loading CV…';
    lockBtn.disabled = true;
    return;
  }
  lockBtn.disabled = false;
  lockBtn.textContent = mode === 'locked' ? 'Unlock' : 'Lock to surface';
}

lockBtn.addEventListener('click', () => {
  if (!tracker.ready) return;
  if (mode === 'locked') {
    tracker.unlock();
    mode = 'screen';
    setStatus('Screen-locked');
    updateLockBtn();
    return;
  }
  if (tracker.lock(video)) {
    mode = 'locked';
    buildGridRef();
    setStatus('Tracking surface');
  } else {
    setStatus('Not enough texture — aim at a detailed surface');
  }
  updateLockBtn();
});

// --- Controls -------------------------------------------------------------

toggleControls.addEventListener('click', () => panel.classList.toggle('hidden'));

document.getElementById('spacing').addEventListener('input', (e) => {
  settings.spacing = +e.target.value;
  if (mode === 'locked') buildGridRef();
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

// --- OpenCV.js readiness --------------------------------------------------

function whenOpenCvReady(cb) {
  if (window.cv && window.cv.Mat) { cb(); return; }
  if (window.cv && typeof window.cv.then === 'function') {
    window.cv.then((c) => { window.cv = c; cb(); });
    return;
  }
  if (window.cv) { window.cv.onRuntimeInitialized = cb; return; }
  setTimeout(() => whenOpenCvReady(cb), 50);
}

whenOpenCvReady(() => {
  tracker.ready = true;
  updateLockBtn();
  if (mode !== 'locked') setStatus('Ready — tap Lock to surface');
});
