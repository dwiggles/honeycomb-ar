// PlaneTracker — Phase 2 surface tracking with OpenCV.js.
//
// On lock(): detect good features in the current frame and remember them as the
// "reference" set (the plane, frozen at lock time).
// On update(): track those points frame-to-frame with Lucas-Kanade optical flow,
// then fit a homography (reference -> current) with RANSAC. lastH maps any point
// from reference/plane coordinates into the live frame. Features that drift off
// are dropped and fresh ones re-seeded (their plane coords recovered via H^-1).
//
// All coordinates here are in "proc space": the video frame downscaled to
// PROC_WIDTH for speed. app.js maps proc space -> on-screen display space.

const PROC_WIDTH = 360;
const CENTER_ROI = 0.7; // detect features only in this central fraction of the frame

// --- 3x3 homography helpers (row-major Float64Array) ----------------------

function identity3() {
  return new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

function invert3(h) {
  const a = h[0], b = h[1], c = h[2];
  const d = h[3], e = h[4], f = h[5];
  const g = h[6], i = h[7], j = h[8];
  const A = e * j - f * i;
  const B = -(d * j - f * g);
  const C = d * i - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return new Float64Array([
    A * inv, (c * i - b * j) * inv, (b * f - c * e) * inv,
    B * inv, (a * j - c * g) * inv, (c * d - a * f) * inv,
    C * inv, (b * g - a * i) * inv, (a * e - b * d) * inv,
  ]);
}

function applyH(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

// --- Tracker --------------------------------------------------------------

class PlaneTracker {
  constructor() {
    this.ready = false;     // OpenCV runtime initialized
    this.tracking = false;  // currently locked + tracking a plane
    this.lastH = identity3();  // smoothed homography (used for rendering)
    this.rawH = identity3();   // unsmoothed homography (used for re-seeding)
    this.procW = 0;
    this.procH = 0;
    this.procScale = 1;     // procPixels / videoPixels
    this.minPts = 25;        // re-seed below this; lose tracking below 4
    this.deadband = 1.5;     // display px; below this the grid is frozen (stationary)
    this.gateCorners = null; // visible screen corners in proc space (set by app.js)
    this.gateScale = 1;      // proc px -> display px, for the freeze gate

    this.ref = [];          // reference points (plane coords)
    this.cur = [];          // their current tracked positions
    this.prevGray = null;   // cv.Mat of previous frame (grayscale)

    this.canvas = document.createElement('canvas');
    this.cctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  _grabGray(video) {
    const vw = video.videoWidth, vh = video.videoHeight;
    this.procScale = PROC_WIDTH / vw;
    this.procW = PROC_WIDTH;
    this.procH = Math.round(vh * this.procScale);
    this.canvas.width = this.procW;
    this.canvas.height = this.procH;
    this.cctx.drawImage(video, 0, 0, this.procW, this.procH);
    const src = cv.imread(this.canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    src.delete();
    return gray;
  }

  _detect(gray, maxPts, mask) {
    const useMask = mask || new cv.Mat();
    const corners = new cv.Mat();
    cv.goodFeaturesToTrack(gray, corners, maxPts, 0.01, 10, useMask, 3);
    const pts = [];
    for (let k = 0; k < corners.rows; k++) {
      pts.push({ x: corners.data32F[k * 2], y: corners.data32F[k * 2 + 1] });
    }
    corners.delete();
    if (!mask) useMask.delete();
    return pts;
  }

  _ptsToMat(pts) {
    const m = new cv.Mat(pts.length, 1, cv.CV_32FC2);
    for (let k = 0; k < pts.length; k++) {
      m.data32F[k * 2] = pts[k].x;
      m.data32F[k * 2 + 1] = pts[k].y;
    }
    return m;
  }

  lock(video) {
    if (!this.ready) return false;
    if (this.prevGray) { this.prevGray.delete(); this.prevGray = null; }
    const gray = this._grabGray(video);
    const mask = this._centerMask();
    const pts = this._detect(gray, 200, mask);
    mask.delete();
    if (pts.length < this.minPts) {
      gray.delete();
      this.tracking = false;
      return false;
    }
    this.ref = pts.map((p) => ({ x: p.x, y: p.y }));
    this.cur = pts.map((p) => ({ x: p.x, y: p.y }));
    this.prevGray = gray;
    this.lastH = identity3();
    this.rawH = identity3();
    this.tracking = true;
    return true;
  }

  // Adaptive smoothing factor, keyed off how far the grid moved on screen (d,
  // in display px). Just past the deadband: light blend. Big moves: snap to live.
  _alphaFor(d) {
    const LO = this.deadband, HI = 8.0;
    const A_MIN = 0.25, A_MAX = 1.0;
    if (d <= LO) return A_MIN;
    if (d >= HI) return A_MAX;
    return A_MIN + (A_MAX - A_MIN) * (d - LO) / (HI - LO);
  }

  // Max on-screen displacement (display px) between two homographies, measured
  // at the visible screen corners (set via gateCorners) rather than the camera
  // frame corners. The frame corners sit outside the tracked center region, so
  // they're extrapolated and wobbly; the visible corners are well inside it and
  // are the periphery the user actually sees.
  _visibleChange(hA, hB) {
    const pts = this.gateCorners || [
      { x: 0, y: 0 }, { x: this.procW, y: 0 },
      { x: this.procW, y: this.procH }, { x: 0, y: this.procH },
    ];
    const scale = this.gateCorners ? this.gateScale : 1;
    let m = 0;
    for (const p of pts) {
      const a = applyH(hA, p.x, p.y), b = applyH(hB, p.x, p.y);
      m = Math.max(m, Math.hypot(a.x - b.x, a.y - b.y) * scale);
    }
    return m;
  }

  // Mask allowing feature detection only within a central ellipse — edge
  // features are noisier and swing the far corners, so we exclude them.
  _centerMask() {
    const mask = new cv.Mat(this.procH, this.procW, cv.CV_8UC1);
    mask.setTo(new cv.Scalar(0));
    const cx = Math.round(this.procW / 2), cy = Math.round(this.procH / 2);
    const ax = Math.round(this.procW * CENTER_ROI / 2);
    const ay = Math.round(this.procH * CENTER_ROI / 2);
    cv.ellipse(mask, new cv.Point(cx, cy), new cv.Size(ax, ay), 0, 0, 360, new cv.Scalar(255), -1);
    return mask;
  }

  unlock() {
    this.tracking = false;
    if (this.prevGray) { this.prevGray.delete(); this.prevGray = null; }
    this.ref = [];
    this.cur = [];
  }

  // Advance tracking by one frame. Returns true while still tracking.
  update(video) {
    if (!this.ready || !this.tracking) return false;
    const gray = this._grabGray(video);

    if (!this.prevGray || this.cur.length < 4) {
      if (this.prevGray) this.prevGray.delete();
      this.prevGray = gray;
      return true;
    }

    const prevPts = this._ptsToMat(this.cur);
    const nextPts = new cv.Mat();
    const status = new cv.Mat();
    const err = new cv.Mat();
    const winSize = new cv.Size(21, 21);
    const criteria = new cv.TermCriteria(cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT, 20, 0.03);
    cv.calcOpticalFlowPyrLK(this.prevGray, gray, prevPts, nextPts, status, err, winSize, 2, criteria);

    const newRef = [], newCur = [];
    for (let k = 0; k < status.rows; k++) {
      if (status.data[k] === 1) {
        const x = nextPts.data32F[k * 2], y = nextPts.data32F[k * 2 + 1];
        if (x >= 0 && y >= 0 && x < this.procW && y < this.procH) {
          newRef.push(this.ref[k]);
          newCur.push({ x, y });
        }
      }
    }
    prevPts.delete(); nextPts.delete(); status.delete(); err.delete();

    this.ref = newRef;
    this.cur = newCur;
    this.prevGray.delete();
    this.prevGray = gray;

    if (this.cur.length >= 4) {
      const srcM = this._ptsToMat(this.ref);
      const dstM = this._ptsToMat(this.cur);
      const mask = new cv.Mat();
      const Hmat = cv.findHomography(srcM, dstM, cv.RANSAC, 3, mask);
      if (!Hmat.empty() && Math.abs(Hmat.data64F[8]) > 1e-9) {
        const s = Hmat.data64F[8]; // normalize so H[8] == 1 before comparing
        for (let k = 0; k < 9; k++) this.rawH[k] = Hmat.data64F[k] / s;
        // Deadband: only move the rendered grid if it would shift visibly.
        const d = this._visibleChange(this.lastH, this.rawH);
        if (d >= this.deadband) {
          const a = this._alphaFor(d);
          for (let k = 0; k < 9; k++) this.lastH[k] += a * (this.rawH[k] - this.lastH[k]);
        }
      }
      srcM.delete(); dstM.delete(); mask.delete(); Hmat.delete();
    }

    // Re-seed fresh features when the tracked set thins out.
    if (this.cur.length < this.minPts) {
      const Hinv = invert3(this.rawH);
      if (Hinv) {
        const mask = this._centerMask();
        for (const p of this.cur) {
          cv.circle(mask, new cv.Point(Math.round(p.x), Math.round(p.y)), 10, new cv.Scalar(0), -1);
        }
        const fresh = this._detect(gray, 200, mask);
        mask.delete();
        for (const p of fresh) {
          const r = applyH(Hinv, p.x, p.y); // current frame -> plane coords
          this.ref.push(r);
          this.cur.push({ x: p.x, y: p.y });
        }
      }
    }

    if (this.cur.length < 4) this.tracking = false;
    return this.tracking;
  }
}
