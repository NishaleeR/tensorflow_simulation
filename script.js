/**
 * script.js
 * ----------------------------------------------------------------------------
 * Hand detection + gesture recognition + drawing logic, in one plain file.
 *
 * Plain classic script on purpose (no `import`/`export`) so this page can be
 * opened straight from disk — double-click index.html, or drag it into a
 * browser tab — with no dev server required. Camera access works the same
 * way it always does: the browser will prompt for permission the first time
 * `startCamera()` runs, regardless of how the page was opened.
 *
 * Sections below:
 *   1. CONFIG            — tunables
 *   2. DOM REFERENCES
 *   3. STATE
 *   4. GESTURE RECOGNITION
 *   5. DRAWING ENGINE
 *   6. CANVAS SIZING
 *   7. MEDIAPIPE HANDS SETUP + MAIN LOOP
 * ----------------------------------------------------------------------------
 */

// ============================================================================
// 1. CONFIG
// ============================================================================
const CONFIG = {
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.6,

  // A finger counts as "extended" when its tip is this many times farther
  // from the wrist than its PIP joint is.
  extensionThreshold: 1.15,

  // A gesture must win this many votes out of the last `stabilizerFrames`
  // frames before it's treated as "stable" (smooths out flicker).
  stabilizerFrames: 6,
  stabilizerMajorityRatio: 0.6,

  brushColor: '#35e0c9',
  brushSize: 6,
  eraserRadiusMultiplier: 4.5,

  skeleton: {
    pointColor: '#35e0c9',
    lineColor: 'rgba(231, 237, 240, 0.85)',
    pointRadius: 4,
    lineWidth: 2,
  },
};

const GESTURES = {
  DRAW: 'DRAW',
  ERASE: 'ERASE',
  CLEAR: 'CLEAR',
  STOP: 'STOP',
  NONE: 'NONE',
};

const STATUS_TEXT = {
  [GESTURES.DRAW]: '☝️ Drawing',
  [GESTURES.ERASE]: '✌️ Erasing',
  [GESTURES.CLEAR]: '✊ Canvas cleared',
  [GESTURES.STOP]: '✋ Stopped',
  [GESTURES.NONE]: '🖐️ Hand detected',
};

// ============================================================================
// 2. DOM REFERENCES
// ============================================================================
const video = document.getElementById('webcam');
const wrap = document.getElementById('camera-wrap');
const skeletonCanvas = document.getElementById('skeleton-canvas');
const drawCanvas = document.getElementById('draw-canvas');
const skeletonCtx = skeletonCanvas.getContext('2d');
const drawCtx = drawCanvas.getContext('2d');
const statusEl = document.getElementById('status');
const colorWheel = document.getElementById('color-wheel');
const colorSelector = document.getElementById('color-selector');
const activeColorPreview = document.getElementById('active-color-preview');
const activeColorPalette = document.getElementById('active-color-palette');
const primaryColorPalette = document.getElementById('primary-color-palette');

// ============================================================================
// 3. STATE
// ============================================================================
let lastPoint = null; // last drawn point, for connecting stroke segments
let gestureBuffer = []; // recent raw gestures, for stabilizing
let stableGesture = GESTURES.NONE;
const colorHistory = [];
const primaryColors = ['#FFFFFF', '#000000', '#FF0000', '#0000FF', '#00FF00', '#FFFF00'];
let currentColor = CONFIG.brushColor;
let lastSelectorPosition = { x: colorWheel.width / 2, y: colorWheel.height / 2 };

// ============================================================================
// 4. GESTURE RECOGNITION
// ============================================================================
// MediaPipe Hands landmark indices (21 points per hand):
//   0 wrist | 1-4 thumb | 5-8 index | 9-12 middle | 13-16 ring | 17-20 pinky
// Each finger's [tip, pip] joint pair, used by the extension heuristic below.
const FINGER_JOINTS = {
  thumb: { tip: 4, pip: 2 },
  index: { tip: 8, pip: 6 },
  middle: { tip: 12, pip: 10 },
  ring: { tip: 16, pip: 14 },
  pinky: { tip: 20, pip: 18 },
};

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Returns { thumb, index, middle, ring, pinky } booleans.
 * Heuristic: a finger is "extended" when its tip is meaningfully farther
 * from the wrist than its PIP joint is. This works regardless of hand
 * rotation (sideways/upside down), unlike a plain tip.y < pip.y check.
 */
function getFingerStates(landmarks) {
  const wrist = landmarks[0];
  const states = {};
  for (const finger in FINGER_JOINTS) {
    const { tip, pip } = FINGER_JOINTS[finger];
    const tipDist = dist(wrist, landmarks[tip]);
    const pipDist = dist(wrist, landmarks[pip]);
    states[finger] = tipDist > pipDist * CONFIG.extensionThreshold;
  }
  return states;
}

/** Maps one frame's landmarks to a GESTURES value. */
function recognizeGesture(landmarks) {
  const f = getFingerStates(landmarks);

  // ✋ open palm — everything extended
  if (f.thumb && f.index && f.middle && f.ring && f.pinky) return GESTURES.STOP;

  // ✊ fist — nothing extended
  if (!f.index && !f.middle && !f.ring && !f.pinky) return GESTURES.CLEAR;

  // ✌️ index + middle only
  if (f.index && f.middle && !f.ring && !f.pinky) return GESTURES.ERASE;

  // ☝️ index only
  if (f.index && !f.middle && !f.ring && !f.pinky) return GESTURES.DRAW;

  return GESTURES.NONE; // transitional / unrecognized shape
}

/**
 * Rolling majority-vote smoothing. Returns { gesture, changed } — `changed`
 * is true only on the exact frame the stable gesture flips, which is what
 * lets CLEAR fire once per fist instead of once per frame it's held.
 */
function stabilizeGesture(rawGesture) {
  gestureBuffer.push(rawGesture);
  if (gestureBuffer.length > CONFIG.stabilizerFrames) gestureBuffer.shift();

  const counts = {};
  for (const g of gestureBuffer) counts[g] = (counts[g] || 0) + 1;

  let winner = stableGesture;
  let winnerCount = 0;
  for (const g in counts) {
    if (counts[g] > winnerCount) {
      winner = g;
      winnerCount = counts[g];
    }
  }

  const requiredVotes = Math.ceil(gestureBuffer.length * CONFIG.stabilizerMajorityRatio);
  const isConfident = winnerCount >= requiredVotes;
  const changed = isConfident && winner !== stableGesture;
  if (isConfident) stableGesture = winner;

  return { gesture: stableGesture, changed };
}

function resetGestureState() {
  gestureBuffer = [];
  stableGesture = GESTURES.NONE;
  lastPoint = null;
}

// ============================================================================
// 5. DRAWING ENGINE
// ============================================================================
function beginStroke(x, y) {
  lastPoint = { x, y };
  drawCtx.beginPath();
  drawCtx.arc(x, y, CONFIG.brushSize / 2, 0, Math.PI * 2);
  drawCtx.fillStyle = currentColor;
  drawCtx.fill();
}

function drawTo(x, y) {
  if (!lastPoint) {
    beginStroke(x, y);
    return;
  }

  const dx = x - lastPoint.x;
  const dy = y - lastPoint.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 0.5) {
    return;
  }

  const steps = Math.max(1, Math.ceil(distance / 1.5));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = lastPoint.x + dx * t;
    const py = lastPoint.y + dy * t;

    drawCtx.strokeStyle = currentColor;
    drawCtx.lineWidth = CONFIG.brushSize;
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    drawCtx.beginPath();
    drawCtx.moveTo(lastPoint.x, lastPoint.y);
    drawCtx.lineTo(px, py);
    drawCtx.stroke();
  }

  lastPoint = { x, y };
}

function eraseAt(x, y) {
  const radius = CONFIG.brushSize * CONFIG.eraserRadiusMultiplier;
  drawCtx.save();
  drawCtx.globalCompositeOperation = 'destination-out';
  drawCtx.beginPath();
  drawCtx.arc(x, y, radius, 0, Math.PI * 2);
  drawCtx.fill();
  drawCtx.restore();
}

function clearCanvas() {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) [r, g, b] = [c, x, 0];
  else if (h >= 60 && h < 120) [r, g, b] = [x, c, 0];
  else if (h >= 120 && h < 180) [r, g, b] = [0, c, x];
  else if (h >= 180 && h < 240) [r, g, b] = [0, x, c];
  else if (h >= 240 && h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return [r + m, g + m, b + m];
}

function rgbToHex(r, g, b) {
  const toHex = (value) => Math.round(value * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hsvToHex(h, s, v) {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

function renderColorWheel() {
  const ctx = colorWheel.getContext('2d');
  const width = colorWheel.width;
  const height = colorWheel.height;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 10;
  const image = ctx.createImageData(width, height);
  const { data } = image;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.hypot(dx, dy);
      const index = (y * width + x) * 4;

      if (distance <= radius) {
        const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
        const saturation = clamp(distance / radius, 0, 1);
        const [r, g, b] = hsvToRgb(hue, saturation, 1);
        data[index] = Math.round(r * 255);
        data[index + 1] = Math.round(g * 255);
        data[index + 2] = Math.round(b * 255);
        data[index + 3] = 255;
      } else {
        data[index + 3] = 0;
      }
    }
  }

  ctx.putImageData(image, 0, 0);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.stroke();
}

function updateSelectorPosition(x, y) {
  const rect = colorWheel.getBoundingClientRect();
  const wheelX = clamp(x - rect.left, 0, rect.width);
  const wheelY = clamp(y - rect.top, 0, rect.height);
  const dx = wheelX - rect.width / 2;
  const dy = wheelY - rect.height / 2;
  const distance = Math.hypot(dx, dy);
  const maxRadius = rect.width / 2 - 12;
  const limitedDistance = Math.min(distance, maxRadius);
  const angle = Math.atan2(dy, dx);

  const nextX = rect.width / 2 + Math.cos(angle) * limitedDistance;
  const nextY = rect.height / 2 + Math.sin(angle) * limitedDistance;

  lastSelectorPosition = { x: nextX, y: nextY };
  colorSelector.style.left = `${nextX}px`;
  colorSelector.style.top = `${nextY}px`;
}

function setCurrentColor(color) {
  currentColor = color;
  CONFIG.brushColor = color;
  activeColorPreview.style.background = color;
}

function renderPalette(container, colors, activeColor) {
  container.innerHTML = '';
  colors.forEach((swatchColor) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch';
    if (swatchColor === activeColor) swatch.classList.add('is-active');
    swatch.style.background = swatchColor;
    swatch.setAttribute('aria-label', `Select ${swatchColor} color`);
    swatch.addEventListener('click', () => {
      setCurrentColor(swatchColor);
      pushColorToHistory(swatchColor);
    });
    container.appendChild(swatch);
  });
}

function pushColorToHistory(color) {
  if (!colorHistory.includes(color)) {
    colorHistory.unshift(color);
  } else {
    const existingIndex = colorHistory.indexOf(color);
    colorHistory.splice(existingIndex, 1);
    colorHistory.unshift(color);
  }

  while (colorHistory.length > 8) colorHistory.pop();
  renderPalette(activeColorPalette, colorHistory, currentColor);
}

function pickColorFromWheel(event) {
  const rect = colorWheel.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const dx = x - rect.width / 2;
  const dy = y - rect.height / 2;
  const distance = Math.hypot(dx, dy);
  const radius = rect.width / 2 - 10;

  if (distance > radius) return;

  const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
  const color = hsvToHex(hue, 1, 1);
  setCurrentColor(color);
  updateSelectorPosition(event.clientX, event.clientY);
  pushColorToHistory(color);
}

function initializeColorTools() {
  renderColorWheel();
  renderPalette(primaryColorPalette, primaryColors, CONFIG.brushColor);
  setCurrentColor(CONFIG.brushColor);
  pushColorToHistory(CONFIG.brushColor);
  colorSelector.style.left = '50%';
  colorSelector.style.top = '50%';

  primaryColors.forEach((color) => {
    const swatch = Array.from(primaryColorPalette.children).find((node) => node.style.background === color);
    if (swatch) {
      swatch.addEventListener('click', () => {
        setCurrentColor(color);
        pushColorToHistory(color);
      });
    }
  });

  colorWheel.addEventListener('pointerdown', (event) => {
    pickColorFromWheel(event);
    colorWheel.setPointerCapture(event.pointerId);
  });

  colorWheel.addEventListener('pointermove', (event) => {
    if (event.buttons === 1) {
      pickColorFromWheel(event);
    }
  });
}

// ============================================================================
// 6. CANVAS SIZING
// ============================================================================
// Both canvases are sized to the webcam's actual resolution once we know it,
// and stretched to fill the mirrored container via CSS (width/height: 100%).
// Because MediaPipe's landmark x/y are normalized (0..1), multiplying them
// by canvas.width/canvas.height (below, in onResults) always lands in the
// right place regardless of the container's on-screen size.
function sizeCanvasesToVideo() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;

  skeletonCanvas.width = w;
  skeletonCanvas.height = h;
  drawCanvas.width = w;
  drawCanvas.height = h;

  wrap.style.aspectRatio = `${w} / ${h}`;
}

video.addEventListener('loadedmetadata', sizeCanvasesToVideo);

// ============================================================================
// 7. MEDIAPIPE HANDS SETUP + MAIN LOOP
// ============================================================================
function drawSkeleton(landmarks) {
  const { pointColor, lineColor, pointRadius, lineWidth } = CONFIG.skeleton;

  if (window.drawConnectors && window.drawLandmarks && window.HAND_CONNECTIONS) {
    window.drawConnectors(skeletonCtx, landmarks, window.HAND_CONNECTIONS, {
      color: lineColor,
      lineWidth,
    });
    window.drawLandmarks(skeletonCtx, landmarks, {
      color: pointColor,
      fillColor: pointColor,
      radius: pointRadius,
    });
  } else {
    // Fallback if the drawing_utils CDN script failed to load.
    skeletonCtx.fillStyle = pointColor;
    for (const p of landmarks) {
      skeletonCtx.beginPath();
      skeletonCtx.arc(p.x * skeletonCanvas.width, p.y * skeletonCanvas.height, pointRadius, 0, Math.PI * 2);
      skeletonCtx.fill();
    }
  }
}

function onResults(results) {
  skeletonCtx.clearRect(0, 0, skeletonCanvas.width, skeletonCanvas.height);

  const hasHand = Boolean(results.multiHandLandmarks && results.multiHandLandmarks.length > 0);

  if (!hasHand) {
    resetGestureState();
    statusEl.textContent = 'Show your hand to the camera to begin';
    return;
  }

  const landmarks = results.multiHandLandmarks[0];
  drawSkeleton(landmarks);

  const rawGesture = recognizeGesture(landmarks);
  const { gesture, changed } = stabilizeGesture(rawGesture);
  statusEl.textContent = STATUS_TEXT[gesture];

  const w = drawCanvas.width;
  const h = drawCanvas.height;
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];

  switch (gesture) {
    case GESTURES.DRAW: {
      const x = (1 - indexTip.x) * w;
      const y = indexTip.y * h;
      if (lastPoint) drawTo(x, y);
      else beginStroke(x, y);
      break;
    }

    case GESTURES.ERASE: {
      const x = (1 - ((indexTip.x + middleTip.x) / 2)) * w;
      const y = ((indexTip.y + middleTip.y) / 2) * h;
      eraseAt(x, y);
      lastPoint = null;
      break;
    }

    case GESTURES.CLEAR: {
      if (changed) clearCanvas(); // edge-triggered: once per fist, not per frame
      lastPoint = null;
      break;
    }

    case GESTURES.STOP:
    case GESTURES.NONE:
    default:
      lastPoint = null;
      break;
  }
}

async function startCamera() {
  if (!window.Hands || !window.Camera) {
    statusEl.textContent = 'MediaPipe failed to load — check your internet connection.';
    return;
  }

  const hands = new window.Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: CONFIG.maxNumHands,
    modelComplexity: CONFIG.modelComplexity,
    minDetectionConfidence: CONFIG.minDetectionConfidence,
    minTrackingConfidence: CONFIG.minTrackingConfidence,
  });

  hands.onResults(onResults);

  const camera = new window.Camera(video, {
    onFrame: async () => {
      await hands.send({ image: video });
    },
    width: 1280,
    height: 720,
  });

  try {
    await camera.start(); // <-- this is what triggers the browser's camera-permission prompt
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Camera error: ${err.message || err}`;
  }
}

initializeColorTools();
startCamera();
