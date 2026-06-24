# Honeycomb AR

A zero-build web app that opens your phone's camera and overlays a honeycomb
grid of dots. Designed to run in **iOS Safari**.

- **Phase 1 (current):** camera feed + screen-locked honeycomb dot overlay,
  with live controls for spacing, dot size, opacity, and color.
- **Phase 2 (planned):** lock the dots to a real surface (tabletop) using
  OpenCV.js feature tracking + homography, so the grid appears painted onto
  the plane as the camera moves.

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

- `index.html` — markup + control panel
- `style.css` — fullscreen camera + overlay styling
- `app.js` — camera, canvas sizing, honeycomb dot rendering
