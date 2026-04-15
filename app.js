import { HopfieldNetwork } from "./network.js";
import { HopfieldAudio } from "./audio.js";
import { createHopfieldViz } from "./viz.js";

const app = document.getElementById("app");
const startButton = document.getElementById("startButton");
const settingsToggle = document.getElementById("settingsToggle");
const learnToggle = document.getElementById("learnToggle");
const closeSettings = document.getElementById("closeSettings");
const closeLearn = document.getElementById("closeLearn");
const settingsPanel = document.getElementById("settingsPanel");
const learnPanel = document.getElementById("learnPanel");
const stepButton = document.getElementById("stepButton");
const gesturePad = document.getElementById("gesturePad");
const gestureReadout = document.getElementById("gestureReadout");
const pitchStrip = document.getElementById("pitchStrip");

const controls = {
  mode: document.getElementById("modeSelect"),
  updateRate: document.getElementById("updateRate"),
  consonance: document.getElementById("consonance"),
  temperature: document.getElementById("temperature"),
  reverb: document.getElementById("reverb"),
  delay: document.getElementById("delay"),
  autoPerturb: document.getElementById("autoPerturb"),
  volume: document.getElementById("volume"),
};

const readouts = {
  x: document.getElementById("readoutX"),
  y: document.getElementById("readoutY"),
  velocity: document.getElementById("readoutVelocity"),
  energy: document.getElementById("readoutEnergy"),
  updateRate: document.getElementById("updateRateValue"),
  consonance: document.getElementById("consonanceValue"),
  temperature: document.getElementById("temperatureValue"),
  reverb: document.getElementById("reverbValue"),
  delay: document.getElementById("delayValue"),
  autoPerturb: document.getElementById("autoPerturbValue"),
  volume: document.getElementById("volumeValue"),
  energyValue: document.getElementById("energyValue"),
  energyMeter: document.getElementById("energyMeter"),
  stability: document.getElementById("stabilityValue"),
};

const settings = {
  mode: "12tet",
  updateRate: 5,
  consonanceStrength: 1,
  temperature: 0.03,
  reverb: 0.38,
  delay: 0.18,
  autoPerturb: 0,
  volume: 0.72,
  arpMode: "arpeggio",
};

const network = new HopfieldNetwork(settings);
const audio = new HopfieldAudio(settings);

const state = {
  started: false,
  learnMode: false,
  settingsOpen: false,
  currentIndex: null,
  flipFlashes: {},
  energyHistory: [],
  activeCount: 0,
  lastUpdateAt: 0,
  lastAutoPerturbAt: 0,
  lastReadoutAt: 0,
  energyMin: -20,
  energyMax: 20,
};

const drag = {
  pointerId: null,
  dragging: false,
  homeX: 0,
  homeY: 0,
  targetX: 0,
  targetY: 0,
  x: 0,
  y: 0,
  previousX: 0,
  previousY: 0,
  previousTime: performance.now(),
  velocity: 0,
};

window.hopfield = network;

createHopfieldViz({
  containerId: "viz",
  network,
  getState: () => state,
});

initialize();

function initialize() {
  network.randomize();
  syncScale();
  syncPitchStrip();
  syncReadouts();
  syncStatus();
  resetGestureHome();
  bindEvents();
  requestAnimationFrame(tick);
}

function bindEvents() {
  startButton.addEventListener("click", startExperience);
  settingsToggle.addEventListener("click", () => setSettingsOpen(!state.settingsOpen));
  learnToggle.addEventListener("click", () => setLearnMode(!state.learnMode));
  closeSettings.addEventListener("click", () => setSettingsOpen(false));
  closeLearn.addEventListener("click", () => setLearnMode(false));
  stepButton.addEventListener("click", () => runStep(true));

  controls.mode.addEventListener("change", () => {
    settings.mode = controls.mode.value;
    network.configure({ mode: settings.mode });
    network.randomize();
    syncScale();
    syncPitchStrip();
    applyNetworkState([]);
    pushEnergy();
    syncStatus();
  });

  controls.updateRate.addEventListener("input", () => {
    settings.updateRate = Number(controls.updateRate.value);
    audio.setArpRate(settings.updateRate);
    syncReadouts();
  });

  controls.consonance.addEventListener("input", () => {
    settings.consonanceStrength = Number(controls.consonance.value);
    network.setConsonanceStrength(settings.consonanceStrength);
    pushEnergy();
    syncReadouts();
    syncStatus();
  });

  controls.temperature.addEventListener("input", () => {
    settings.temperature = Number(controls.temperature.value);
    network.setTemperature(settings.temperature);
    syncReadouts();
  });

  controls.reverb.addEventListener("input", () => {
    settings.reverb = Number(controls.reverb.value);
    audio.setEffects(settings);
    syncReadouts();
  });

  controls.delay.addEventListener("input", () => {
    settings.delay = Number(controls.delay.value);
    audio.setEffects(settings);
    syncReadouts();
  });

  controls.autoPerturb.addEventListener("input", () => {
    settings.autoPerturb = Number(controls.autoPerturb.value);
    state.lastAutoPerturbAt = performance.now();
    syncReadouts();
  });

  controls.volume.addEventListener("input", () => {
    settings.volume = Number(controls.volume.value);
    audio.setEffects(settings);
    syncReadouts();
  });

  document.querySelectorAll('input[name="arpMode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        settings.arpMode = radio.value;
        audio.setArpMode(settings.arpMode);
        applyNetworkState([]);
      }
    });
  });

  gesturePad.addEventListener("pointerdown", beginDrag);
  gesturePad.addEventListener("pointermove", moveDrag);
  gesturePad.addEventListener("pointerup", endDrag);
  gesturePad.addEventListener("pointercancel", endDrag);
  gesturePad.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      injectPerturbation({ x: Math.random(), y: Math.random(), velocity: 0.42, spread: 0.18 });
    }
  });

  window.addEventListener("resize", resetGestureHome);
}

async function startExperience() {
  startButton.disabled = true;
  startButton.textContent = "Starting...";

  try {
    await audio.start({
      mode: settings.mode,
      pitchNames: network.pitchNames,
      semitones: network.semitones,
    });
    audio.setArpRate(settings.updateRate);
    audio.setArpMode(settings.arpMode);
    network.randomize();
    applyNetworkState(network.state.map((_, index) => index));
    pushEnergy();
    state.started = true;
    app.dataset.started = "true";
    readouts.stability.textContent = network.isStable() ? "attractor" : "settling";
  } catch (error) {
    console.error(error);
    startButton.disabled = false;
    startButton.textContent = "Try again";
  }
}

function tick(now) {
  updateGesturePhysics(now);

  if (state.started) {
    const updateEvery = 1000 / settings.updateRate;
    if (now - state.lastUpdateAt >= updateEvery) {
      runStep(false);
      state.lastUpdateAt = now;
    }

    if (
      settings.autoPerturb > 0 &&
      now - state.lastAutoPerturbAt >= settings.autoPerturb * 1000
    ) {
      injectPerturbation({
        x: 0.35 + Math.random() * 0.3,
        y: 0.35 + Math.random() * 0.3,
        velocity: 0.24 + Math.random() * 0.18,
        spread: 0.12,
      });
      state.lastAutoPerturbAt = now;
    }
  }

  if (!drag.dragging && now - state.lastReadoutAt > 1600) {
    gestureReadout.classList.remove("is-visible");
  }

  requestAnimationFrame(tick);
}

function runStep(manual) {
  if (!state.started && !manual) return;

  const result = network.updateAsync();
  state.currentIndex = result.index;

  if (result.flipped) {
    state.flipFlashes[result.index] = performance.now();
  }

  applyNetworkState(result.flipped ? [result.index] : []);
  pushEnergy();
  syncStatus();
}

function applyNetworkState(flipped) {
  audio.updateFromState(network.state, { flipped });
  state.activeCount = network.state.filter((value) => value > 0).length;
  syncPitchStrip();
}

function syncScale() {
  audio.setScale({
    mode: settings.mode,
    pitchNames: network.pitchNames,
    semitones: network.semitones,
  });
}

function syncPitchStrip() {
  const fragment = document.createDocumentFragment();
  const size = network.pitchNames.length;

  network.pitchNames.forEach((pitch, index) => {
    const pill = document.createElement("span");
    const hue = (index * (360 / size) + 18) % 360;
    pill.className = `pitch-pill${network.state[index] > 0 ? " is-active" : ""}`;
    pill.textContent = pitch;
    pill.style.setProperty("--pill-color", `hsl(${hue} 82% 66%)`);
    fragment.appendChild(pill);
  });

  pitchStrip.replaceChildren(fragment);
}

function pushEnergy() {
  const energy = network.energy();
  state.energyHistory.push(energy);
  state.energyHistory = state.energyHistory.slice(-90);
  state.energyMin = Math.min(state.energyMin, energy);
  state.energyMax = Math.max(state.energyMax, energy);
}

function syncStatus() {
  const energy = network.energy();
  const range = Math.max(1, state.energyMax - state.energyMin);
  const normalized = 1 - (energy - state.energyMin) / range;
  readouts.energyValue.textContent = energy.toFixed(2);
  readouts.energyMeter.style.width = `${Math.max(4, Math.min(100, normalized * 100))}%`;
  readouts.stability.textContent = network.isStable() ? "attractor" : "settling";
}

function syncReadouts() {
  readouts.updateRate.textContent = `${settings.updateRate.toFixed(settings.updateRate % 1 ? 1 : 0)} Hz`;
  readouts.consonance.textContent = settings.consonanceStrength.toFixed(2);
  readouts.temperature.textContent = settings.temperature.toFixed(2);
  readouts.reverb.textContent = settings.reverb.toFixed(2);
  readouts.delay.textContent = settings.delay.toFixed(2);
  readouts.autoPerturb.textContent = settings.autoPerturb === 0 ? "off" : `${settings.autoPerturb}s`;
  readouts.volume.textContent = settings.volume.toFixed(2);
}

function setSettingsOpen(open) {
  state.settingsOpen = open;
  settingsPanel.setAttribute("aria-hidden", open ? "false" : "true");
  settingsToggle.setAttribute("aria-pressed", String(open));
}

function setLearnMode(open) {
  state.learnMode = open;
  learnPanel.setAttribute("aria-hidden", open ? "false" : "true");
  learnToggle.setAttribute("aria-pressed", String(open));
}

function beginDrag(event) {
  if (!state.started) return;

  gesturePad.setPointerCapture(event.pointerId);
  drag.pointerId = event.pointerId;
  drag.dragging = true;
  drag.previousTime = performance.now();
  drag.previousX = drag.x;
  drag.previousY = drag.y;
  gesturePad.classList.add("is-dragging");
  moveDrag(event);
}

function moveDrag(event) {
  if (!drag.dragging || event.pointerId !== drag.pointerId) return;

  drag.targetX = event.clientX;
  drag.targetY = event.clientY;
  showGestureReadout();
}

function endDrag(event) {
  if (!drag.dragging || event.pointerId !== drag.pointerId) return;

  drag.dragging = false;
  drag.pointerId = null;
  gesturePad.classList.remove("is-dragging");
  gesturePad.releasePointerCapture?.(event.pointerId);

  const normalized = normalizedGesture();
  injectPerturbation({
    x: normalized.x,
    y: normalized.y,
    velocity: normalized.velocity,
    spread: 0.1,
  });
  audio.updateGestureNoise({ active: false });
}

function resetGestureHome() {
  drag.homeX = Math.min(window.innerWidth - 86, Math.max(86, window.innerWidth * 0.78));
  drag.homeY = Math.min(window.innerHeight - 150, Math.max(120, window.innerHeight * 0.58));

  if (!drag.dragging) {
    drag.x = drag.homeX;
    drag.y = drag.homeY;
    drag.targetX = drag.homeX;
    drag.targetY = drag.homeY;
    drag.previousX = drag.homeX;
    drag.previousY = drag.homeY;
    placeGesturePad();
  }
}

function updateGesturePhysics(now) {
  const dt = Math.max(0.016, Math.min(0.05, (now - drag.previousTime) / 1000));
  const anchorX = drag.dragging ? drag.targetX : drag.homeX;
  const anchorY = drag.dragging ? drag.targetY : drag.homeY;
  const stiffness = drag.dragging ? 0.24 : 0.12;

  drag.x += (anchorX - drag.x) * stiffness;
  drag.y += (anchorY - drag.y) * stiffness;

  const dx = drag.x - drag.previousX;
  const dy = drag.y - drag.previousY;
  drag.velocity = Math.hypot(dx, dy) / dt;
  drag.previousX = drag.x;
  drag.previousY = drag.y;
  drag.previousTime = now;

  const stretch = Math.min(1, Math.hypot(drag.x - drag.homeX, drag.y - drag.homeY) / 230);
  const scaleX = 1 + stretch * 0.16;
  const scaleY = 1 - stretch * 0.08;
  gesturePad.style.transform = `translate(-50%, -50%) scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`;
  placeGesturePad();

  if (drag.dragging) {
    const normalized = normalizedGesture();
    updateReadout(normalized, 0);
    audio.updateGestureNoise({ active: true, ...normalized });
  }
}

function placeGesturePad() {
  gesturePad.style.left = `${drag.x}px`;
  gesturePad.style.top = `${drag.y}px`;
}

function normalizedGesture() {
  return {
    x: clamp(drag.x / window.innerWidth, 0, 1),
    y: clamp(drag.y / window.innerHeight, 0, 1),
    velocity: clamp(drag.velocity / 1700, 0, 1),
  };
}

function injectPerturbation({ x, y, velocity, spread }) {
  if (!state.started) return;

  const result = network.perturb({ x, y, velocity, spread });
  const now = performance.now();

  result.changed.forEach((index) => {
    state.flipFlashes[index] = now;
  });

  updateReadout({ x, y, velocity }, result.energyInjected);
  showGestureReadout();
  applyNetworkState(result.changed);
  pushEnergy();
  syncStatus();
}

function updateReadout({ x, y, velocity }, energyInjected) {
  readouts.x.textContent = x.toFixed(2);
  readouts.y.textContent = y.toFixed(2);
  readouts.velocity.textContent = velocity.toFixed(2);
  readouts.energy.textContent = energyInjected.toFixed(2);
}

function showGestureReadout() {
  state.lastReadoutAt = performance.now();
  gestureReadout.classList.add("is-visible");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
