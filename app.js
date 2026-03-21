import { FIXTURES, DIFFUSION, getDistributionAtZoom, getPeakCandelaAtZoom,
         applyDiffusion, distributionToTextureData, cctToRGB } from './photometrics.js';
import { Renderer } from './renderer.js';

// ============================================================
//  ON-SCREEN ERROR LOG (for mobile debugging)
// ============================================================

const errorLog = document.createElement('div');
errorLog.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(0,0,0,0.85);color:#f66;font-size:11px;padding:6px 10px;z-index:9999;max-height:30vh;overflow-y:auto;font-family:monospace;display:none;';
document.body.appendChild(errorLog);

function showError(msg) {
  errorLog.style.display = 'block';
  errorLog.textContent += msg + '\n';
}

window.addEventListener('error', (e) => showError(`ERR: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => showError(`REJECT: ${e.reason}`));

// ============================================================
//  STATE
// ============================================================

const state = {
  fixtureKey: 'arri_650w_fresnel',
  lightPos: [0, 0],
  lightDir: Math.PI,     // radians — pointing down (south) in screen coords
  intensity: 1.0,
  zoom: 0.0,             // [0,1] spot to flood
  diffusionType: 'none',
  diffusionAmount: 0,
  sourceSize: 0.12,
  colorTemp: 5600,
  gridScale: 1.0,
  showGrid: true,
  showLux: true,
  bounceEnabled: false,
  bouncePasses: 1,
  wallReflectance: 0.3,
  walls: [],             // [[x1,y1,x2,y2], ...]
  wallEditMode: false,
  wallDrawStart: null,
};

// ============================================================
//  INIT
// ============================================================

const canvas = document.getElementById('canvas');
const overlayCanvas = document.createElement('canvas');
overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
canvas.parentElement.appendChild(overlayCanvas);
const overlayCtx = overlayCanvas.getContext('2d');

let renderer;
try {
  renderer = new Renderer(canvas);
  showError(`WebGL2 OK | Float FBO: ${renderer.hasFloatFBO}`);
} catch (e) {
  showError(`FATAL: ${e.message}`);
  document.body.innerHTML = `<div style="padding:40px;color:#f66;font-size:16px;">
    WebGL2 is required but not available in this browser.<br>${e.message}</div>`;
  throw e;
}

// ============================================================
//  POPULATE FIXTURE DROPDOWN
// ============================================================

const lightTypeSelect = document.getElementById('light-type');
for (const [key, fixture] of Object.entries(FIXTURES)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = fixture.name;
  lightTypeSelect.appendChild(opt);
}
lightTypeSelect.value = state.fixtureKey;

// ============================================================
//  UI BINDINGS
// ============================================================

function bindSlider(id, stateProp, transform, displayFn) {
  const el = document.getElementById(id);
  const valEl = document.getElementById(id + '-val');
  if (!el) return;

  el.addEventListener('input', () => {
    const raw = parseFloat(el.value);
    state[stateProp] = transform ? transform(raw) : raw;
    if (valEl && displayFn) valEl.textContent = displayFn(raw);
  });

  // Set initial display
  if (valEl && displayFn) valEl.textContent = displayFn(parseFloat(el.value));
}

bindSlider('intensity', 'intensity', v => v / 100, v => `${v}%`);
bindSlider('beam-angle', 'beamAngleOverride', v => v, v => `${v}°`);
bindSlider('zoom', 'zoom', v => v / 100, v => `${v}%`);
bindSlider('direction', 'lightDir', v => v * Math.PI / 180, v => `${v}°`);
bindSlider('diffusion', 'diffusionAmount', v => v, v => `${v}%`);
bindSlider('source-size', 'sourceSize', v => v / 100, v => `${v}%`);
bindSlider('grid-scale', 'gridScale', v => v * 0.5, v => `${(v * 0.5).toFixed(1)}m`);
bindSlider('color-temp', 'colorTemp', v => v, v => `${v}K`);
bindSlider('bounce-passes', 'bouncePasses', v => v, v => `${v}`);
bindSlider('wall-reflectance', 'wallReflectance', v => v / 100, v => `${v}%`);

lightTypeSelect.addEventListener('change', () => {
  state.fixtureKey = lightTypeSelect.value;
  const fixture = FIXTURES[state.fixtureKey];
  state.sourceSize = fixture.sourceSize;
  state.colorTemp = fixture.colorTemp;
  // Update slider positions
  document.getElementById('source-size').value = fixture.sourceSize * 100;
  document.getElementById('source-size-val').textContent = `${Math.round(fixture.sourceSize * 100)}%`;
  document.getElementById('color-temp').value = fixture.colorTemp;
  document.getElementById('cct-val').textContent = `${fixture.colorTemp}K`;
});

document.getElementById('diffusion-type').addEventListener('change', (e) => {
  state.diffusionType = e.target.value;
  const diff = DIFFUSION[state.diffusionType];
  // Auto-set diffusion slider
  const autoVal = Math.round(diff.sourceSizeAdd * 100);
  document.getElementById('diffusion').value = autoVal;
  document.getElementById('diffusion-val').textContent = `${autoVal}%`;
  state.diffusionAmount = autoVal;
});

document.getElementById('show-grid').addEventListener('change', (e) => { state.showGrid = e.target.checked; });
document.getElementById('show-lux').addEventListener('change', (e) => { state.showLux = e.target.checked; });
document.getElementById('bounce-enabled').addEventListener('change', (e) => { state.bounceEnabled = e.target.checked; });
document.getElementById('wall-edit-mode').addEventListener('change', (e) => { state.wallEditMode = e.target.checked; });

document.getElementById('clear-walls').addEventListener('click', () => { state.walls = []; });
document.getElementById('add-wall').addEventListener('click', () => {
  // Add a default wall segment near center
  state.walls.push([-2, 2, 2, 2]);
});

// ============================================================
//  MOUSE INTERACTION
// ============================================================

let isDraggingLight = false;
let isPanning = false;
let lastMouse = [0, 0];

function screenToWorld(sx, sy) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const px = (sx - rect.left) * dpr;
  const py = (sy - rect.top) * dpr;
  const w = canvas.width;
  const h = canvas.height;
  const wx = (px - w / 2) / renderer.viewScale + renderer.viewOffset[0];
  const wy = (py - h / 2) / renderer.viewScale + renderer.viewOffset[1];
  return [wx, wy];
}

canvas.parentElement.addEventListener('mousedown', (e) => {
  const [wx, wy] = screenToWorld(e.clientX, e.clientY);

  if (state.wallEditMode && e.button === 0) {
    state.wallDrawStart = [wx, wy];
    return;
  }

  if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
    // Pan
    isPanning = true;
    lastMouse = [e.clientX, e.clientY];
    e.preventDefault();
    return;
  }

  // Check if clicking near light
  const dx = wx - state.lightPos[0];
  const dy = wy - state.lightPos[1];
  if (Math.sqrt(dx * dx + dy * dy) < 0.5) {
    isDraggingLight = true;
  }
});

canvas.parentElement.addEventListener('mousemove', (e) => {
  const [wx, wy] = screenToWorld(e.clientX, e.clientY);

  if (isDraggingLight) {
    state.lightPos = [wx, wy];
  }

  if (isPanning) {
    const dpr = window.devicePixelRatio || 1;
    const dx = (e.clientX - lastMouse[0]) * dpr / renderer.viewScale;
    const dy = (e.clientY - lastMouse[1]) * dpr / renderer.viewScale;
    renderer.viewOffset[0] -= dx;
    renderer.viewOffset[1] -= dy;
    lastMouse = [e.clientX, e.clientY];
  }
});

canvas.parentElement.addEventListener('mouseup', (e) => {
  if (state.wallEditMode && state.wallDrawStart) {
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    const [sx, sy] = state.wallDrawStart;
    const dist = Math.sqrt((wx - sx) ** 2 + (wy - sy) ** 2);
    if (dist > 0.1) {
      state.walls.push([sx, sy, wx, wy]);
    }
    state.wallDrawStart = null;
  }

  isDraggingLight = false;
  isPanning = false;
});

canvas.parentElement.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.parentElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
  renderer.viewScale *= zoomFactor;
  renderer.viewScale = Math.max(10, Math.min(500, renderer.viewScale));
}, { passive: false });

// ============================================================
//  TOUCH INTERACTION
// ============================================================

let touchDraggingLight = false;
let touchPanning = false;
let lastTouchCenter = null;
let lastPinchDist = null;

function getTouchCenter(touches) {
  const x = (touches[0].clientX + touches[1].clientX) / 2;
  const y = (touches[0].clientY + touches[1].clientY) / 2;
  return [x, y];
}

function getPinchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

canvas.parentElement.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    const [wx, wy] = screenToWorld(touch.clientX, touch.clientY);

    if (state.wallEditMode) {
      state.wallDrawStart = [wx, wy];
      e.preventDefault();
      return;
    }

    // Check if near light
    const dx = wx - state.lightPos[0];
    const dy = wy - state.lightPos[1];
    if (Math.sqrt(dx * dx + dy * dy) < 0.8) {
      touchDraggingLight = true;
      e.preventDefault();
    }
  } else if (e.touches.length === 2) {
    // Start pinch / pan
    touchDraggingLight = false;
    touchPanning = true;
    lastTouchCenter = getTouchCenter(e.touches);
    lastPinchDist = getPinchDist(e.touches);
    e.preventDefault();
  }
}, { passive: false });

canvas.parentElement.addEventListener('touchmove', (e) => {
  if (touchDraggingLight && e.touches.length === 1) {
    const touch = e.touches[0];
    const [wx, wy] = screenToWorld(touch.clientX, touch.clientY);
    state.lightPos = [wx, wy];
    e.preventDefault();
  }

  if (touchPanning && e.touches.length === 2) {
    const center = getTouchCenter(e.touches);
    const dist = getPinchDist(e.touches);

    // Pan
    if (lastTouchCenter) {
      const dpr = window.devicePixelRatio || 1;
      const dx = (center[0] - lastTouchCenter[0]) * dpr / renderer.viewScale;
      const dy = (center[1] - lastTouchCenter[1]) * dpr / renderer.viewScale;
      renderer.viewOffset[0] -= dx;
      renderer.viewOffset[1] -= dy;
    }

    // Pinch zoom
    if (lastPinchDist && lastPinchDist > 0) {
      const scale = dist / lastPinchDist;
      renderer.viewScale *= scale;
      renderer.viewScale = Math.max(10, Math.min(500, renderer.viewScale));
    }

    lastTouchCenter = center;
    lastPinchDist = dist;
    e.preventDefault();
  }
}, { passive: false });

canvas.parentElement.addEventListener('touchend', (e) => {
  if (state.wallEditMode && state.wallDrawStart && e.changedTouches.length === 1) {
    const touch = e.changedTouches[0];
    const [wx, wy] = screenToWorld(touch.clientX, touch.clientY);
    const [sx, sy] = state.wallDrawStart;
    const dist = Math.sqrt((wx - sx) ** 2 + (wy - sy) ** 2);
    if (dist > 0.1) {
      state.walls.push([sx, sy, wx, wy]);
    }
    state.wallDrawStart = null;
  }

  touchDraggingLight = false;
  if (e.touches.length < 2) {
    touchPanning = false;
    lastTouchCenter = null;
    lastPinchDist = null;
  }
});

// ============================================================
//  RENDER LOOP
// ============================================================

let lastFrameTime = performance.now();
let frameCount = 0;
let fpsDisplay = 0;

function update() {
  // FPS
  frameCount++;
  const now = performance.now();
  if (now - lastFrameTime > 500) {
    fpsDisplay = Math.round(frameCount / ((now - lastFrameTime) / 1000));
    frameCount = 0;
    lastFrameTime = now;
    document.getElementById('fps-display').textContent = `${fpsDisplay} fps`;
  }

  // Resize check
  renderer.resize();
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  overlayCanvas.width = Math.floor(rect.width * dpr);
  overlayCanvas.height = Math.floor(rect.height * dpr);

  // Compute distribution
  const fixture = FIXTURES[state.fixtureKey];
  let dist = getDistributionAtZoom(fixture, state.zoom);
  if (state.diffusionType !== 'none' || state.diffusionAmount > 0) {
    dist = applyDiffusion(dist, state.diffusionType, state.diffusionAmount);
  }
  const distData = distributionToTextureData(dist);
  renderer.uploadDistribution(distData);

  // Effective source size (modified by diffusion)
  const diff = DIFFUSION[state.diffusionType] || DIFFUSION.none;
  const effectiveSourceSize = Math.min(1, state.sourceSize + diff.sourceSizeAdd);

  // Update edge quality display
  const edgeQEl = document.getElementById('edge-quality-val');
  if (edgeQEl) {
    if (effectiveSourceSize < 0.1) edgeQEl.textContent = 'Hard';
    else if (effectiveSourceSize < 0.3) edgeQEl.textContent = 'Med-Hard';
    else if (effectiveSourceSize < 0.5) edgeQEl.textContent = 'Medium';
    else if (effectiveSourceSize < 0.7) edgeQEl.textContent = 'Med-Soft';
    else edgeQEl.textContent = 'Soft';
  }

  // Beam angle display
  const baEl = document.getElementById('beam-angle-val');
  if (baEl) {
    if (fixture.zoomRange) {
      const angle = fixture.zoomRange[0] + state.zoom * (fixture.zoomRange[1] - fixture.zoomRange[0]);
      baEl.textContent = `${Math.round(angle)}°`;
    } else {
      baEl.textContent = `${fixture.beamAngle}°`;
    }
  }

  const peakCd = getPeakCandelaAtZoom(fixture, state.zoom);
  const lightColor = cctToRGB(state.colorTemp);

  // Render
  renderer.render({
    lightPos: state.lightPos,
    lightDir: state.lightDir,
    intensity: state.intensity,
    peakCandela: peakCd,
    lightColor,
    sourceSize: effectiveSourceSize,
    walls: state.walls,
    gridScale: state.gridScale,
    showGrid: state.showGrid,
    showLux: state.showLux,
    bounceEnabled: state.bounceEnabled,
    bouncePasses: state.bouncePasses,
    reflectance: state.wallReflectance,
  });

  // Overlay
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  renderer.drawOverlay(overlayCtx, {
    lightPos: state.lightPos,
    lightDir: state.lightDir,
    walls: state.walls,
    sourceSize: effectiveSourceSize,
  });

  requestAnimationFrame(update);
}

requestAnimationFrame(update);
