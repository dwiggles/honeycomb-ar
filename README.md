# Honeycomb AR

A zero-build web app that opens your phone's camera and overlays a honeycomb
grid of dots. Designed to run in **iOS Safari**.

- **Phase 1:** camera feed + screen-locked honeycomb dot overlay, with live
  controls for spacing, dot size, opacity, and color.
- **Phase 2 (current):** tap **Lock to surface** to pin the dots to a real
  plane (tabletop) using OpenCV.js feature tracking + RANSAC homography, so
  the grid appears painted onto the surface as the camera moves. Tracking
  re-seeds features as the view changes and falls back to the screen-locked
  grid if it loses the plane (e.g. a blank, textureless surface).

## How Phase 2 tracking works

1. **Lock** — `goodFeaturesToTrack` finds corner features on the surface;
   these become the reference (plane) point set.
2. **Each frame** — Lucas-Kanade optical flow (`calcOpticalFlowPyrLK`) follows
   those points; `findHomography(..., RANSAC)` fits the reference → current
   transform. That homography warps the honeycomb onto the live frame.
3. **Re-seed** — when tracked points thin out, fresh features are detected and
   their plane coordinates recovered via the inverse homography.

Tracking runs on a downscaled (360px-wide) grayscale copy of the frame for
speed. See `tracker.js`.

## Why no WebXR?

iOS Safari does not support WebXR AR hit-testing, so true plane detection
isn't available natively. Phase 2 approximates it with classic computer
vision (optical flow + homography), which works well for a single flat plane.

## Run locally

The camera needs a **secure context**. `localhost` counts as secure:

```sh
# any static server works; e.g.
python3 -m http.server 8000
# then open http://localhost:8000 on the same Mac
```

To test on an **iPhone**, you need HTTPS (a LAN IP is not a secure context).
Easiest path: deploy to GitHub Pages (below) and open the URL on the phone.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → Source: deploy from `main` branch, root.
3. Open the published `https://…github.io/…` URL in iOS Safari and tap
   **Start camera**.

## Files

- `index.html` — markup, control panel, lock bar, OpenCV.js include
- `style.css` — fullscreen camera + overlay styling
- `app.js` — camera, canvas sizing, honeycomb rendering, screen/locked modes
- `tracker.js` — OpenCV.js plane tracker (optical flow + homography)
