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
  spacing: 56,    // distance between circles, in display px
  dotSize: 6,     // circle radius, in display px
  lineWidth: 1.5, // ring stroke width, in display px
  opacity: 0.85,
  color: '#00e5ff',
};

const APP_VERSION = 'v8';

const tracker = new PlaneTracker();
let mode = 'screen';     // 'screen' (Phase 1) | 'locked' (Phase 2)
let gridRef = [];        // honeycomb points in tracker proc/plane space
let lockMap = null;      // proc<->display mapping captured at lock time

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
  if (mode === 'locked') { setGate(); buildGridRef(); }
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

// Tell the tracker which proc-space points are the visible screen corners, so
// its freeze deadband gates on what the user actually sees at the periphery.
function setGate() {
  if (!tracker.procW) return;
  const { factor, offX, offY, dispW, dispH } = displayMapping();
  const toProc = (X, Y) => ({ x: (X - offX) / factor, y: (Y - offY) / factor });
  tracker.gateCorners = [toProc(0, 0), toProc(dispW, 0), toProc(dispW, dispH), toProc(0, dispH)];
  tracker.gateScale = factor;
}

// --- Honeycomb grids ------------------------------------------------------

// Screen-space honeycomb (Phase 1 + fallback).
function drawScreen() {
  const w = window.innerWidth, h = window.innerHeight;
  const s = settings.spacing;
  const rowH = s * Math.sqrt(3) / 2;
  ctx.globalAlpha = settings.opacity;
  ctx.strokeStyle = settings.color;
  ctx.lineWidth = settings.lineWidth;
  let row = 0;
  for (let y = -s; y <= h + s; y += rowH) {
    const offset = (row % 2) * (s / 2);
    for (let x = -s; x <= w + s; x += s) {
      ctx.beginPath();
      ctx.arc(x + offset, y, settings.dotSize, 0, Math.PI * 2);
      ctx.stroke();
    }
    row++;
  }
}

// Build the honeycomb as plane (proc) coordinates. We lay out the exact same
// lattice drawScreen() uses — same -spacing phase, same row parity — extended
// past the screen by a margin, then map each display point back through the
// lock-time mapping. At lock (H = identity) this reproduces the on-screen grid
// pixel-for-pixel, so locking causes no jump; tracking then moves it as one.
function buildGridRef() {
  gridRef = [];
  if (!tracker.procW || !lockMap) return;
  const s = settings.spacing;
  if (!(s > 0)) return;
  const rowH = s * Math.sqrt(3) / 2;
  const W = window.innerWidth, Hh = window.innerHeight;
  const margin = 0.6;
  const yStart = -s - Math.ceil((margin * Hh) / rowH) * rowH;
  const xStart = -s - Math.ceil((margin * W) / s) * s;
  const yEnd = Hh + s + margin * Hh;
  const xEnd = W + s + margin * W;
  for (let yd = yStart; yd <= yEnd; yd += rowH) {
    const row = Math.round((yd + s) / rowH);
    const off = (((row % 2) + 2) % 2) * (s / 2); // match drawScreen row parity
    for (let xd = xStart; xd <= xEnd; xd += s) {
      gridRef.push({
        x: (xd + off - lockMap.offX) / lockMap.factor,
        y: (yd - lockMap.offY) / lockMap.factor,
      });
    }
  }
}

// Draw the honeycomb warped through the tracked homography.
function drawLocked() {
  const H = tracker.lastH;
  const { factor, offX, offY, dispW, dispH } = displayMapping();
  ctx.globalAlpha = settings.opacity;
  ctx.strokeStyle = settings.color;
  ctx.lineWidth = settings.lineWidth;
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
    ctx.stroke();
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
    lockMap = null;
    tracker.gateCorners = null;
    setStatus('Screen-locked');
    updateLockBtn();
    return;
  }
  if (tracker.lock(video)) {
    mode = 'locked';
    lockMap = displayMapping();
    setGate();
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
document.getElementById('line-width').addEventListener('input', (e) => {
  settings.lineWidth = +e.target.value;
});
document.getElementById('opacity').addEventListener('input', (e) => {
  settings.opacity = e.target.value / 100;
});
document.getElementById('color').addEventListener('input', (e) => {
  settings.color = e.target.value;
});

document.getElementById('version').textContent = APP_VERSION;

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
