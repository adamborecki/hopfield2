import { getConsonanceTable } from "./network.js";

const CONSONANCE = getConsonanceTable();

export function createHopfieldViz({ containerId, network, getState }) {
  const container = document.getElementById(containerId);
  let geometry = null;

  const sketch = (p) => {
    p.setup = () => {
      const canvas = p.createCanvas(container.clientWidth, container.clientHeight);
      canvas.parent(container);
      p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
      p.textFont("Inter, system-ui, sans-serif");
      p.noiseSeed(Math.floor(Math.random() * 10000));
    };

    p.windowResized = () => {
      p.resizeCanvas(container.clientWidth, container.clientHeight);
    };

    p.draw = () => {
      const appState = getState();
      const snapshot = network.snapshot();
      geometry = makeGeometry(p.width, p.height, snapshot.size);
      drawBackground(p, appState);
      drawConnections(p, snapshot, appState, geometry);
      drawEnergyTrace(p, appState);
      drawNodes(p, snapshot, appState, geometry);

      if (appState.learnMode) {
        drawConnectionTooltip(p, snapshot, geometry);
      }
    };
  };

  const instance = new p5(sketch);

  return {
    instance,
    nodePositions: () => geometry?.nodes || [],
  };
}

function makeGeometry(width, height, size) {
  const radius = Math.max(112, Math.min(width, height) * (width < 720 ? 0.3 : 0.34));
  const centerY = height * (width < 720 ? 0.42 : 0.48);
  const center = { x: width / 2, y: centerY };
  const nodes = Array.from({ length: size }, (_, index) => {
    const angle = -Math.PI / 2 + (index / size) * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      angle,
    };
  });

  return { center, radius, nodes };
}

function drawBackground(p, appState) {
  const ctx = p.drawingContext;
  const gradient = ctx.createLinearGradient(0, 0, 0, p.height);
  gradient.addColorStop(0, "#111112");
  gradient.addColorStop(1, "#070708");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, p.width, p.height);

  p.noFill();
  const pulse = 0.3 + Math.sin(p.frameCount * 0.012) * 0.1;
  const active = appState.activeCount || 0;

  for (let i = 0; i < 5; i += 1) {
    const alpha = 10 + i * 3 + active * 0.8;
    p.stroke(255, 255, 255, alpha * pulse);
    p.strokeWeight(1);
    p.beginShape();
    for (let x = -20; x <= p.width + 20; x += 18) {
      const y =
        p.height * (0.36 + i * 0.07) +
        Math.sin(x * 0.008 + p.frameCount * 0.015 + i) * (5 + active * 0.55);
      p.vertex(x, y);
    }
    p.endShape();
  }
}

function drawConnections(p, snapshot, appState, geometry) {
  const maxWeight = Math.max(0.01, ...snapshot.weights.flat().map((weight) => Math.abs(weight)));
  const hover = appState.learnMode ? findHoveredConnection(p, snapshot, geometry) : null;

  p.push();
  p.blendMode(p.ADD);
  for (let i = 0; i < snapshot.size; i += 1) {
    for (let j = i + 1; j < snapshot.size; j += 1) {
      const weight = snapshot.weights[i][j];
      const amount = Math.abs(weight) / maxWeight;
      const activeBoost = snapshot.state[i] > 0 && snapshot.state[j] > 0 ? 0.2 : 0;
      const isHover = hover && hover.i === i && hover.j === j;
      const alpha = (22 + amount * 86 + activeBoost * 90) * (isHover ? 1.9 : 1);
      const warm = weight >= 0;
      const a = geometry.nodes[i];
      const b = geometry.nodes[j];

      p.strokeWeight(isHover ? 2.6 : 0.5 + amount * 1.45);
      if (warm) {
        p.stroke(255, 184, 99, alpha);
      } else {
        p.stroke(111, 196, 255, alpha);
      }
      p.line(a.x, a.y, b.x, b.y);
    }
  }
  p.pop();
}

function drawNodes(p, snapshot, appState, geometry) {
  p.push();
  p.textAlign(p.CENTER, p.CENTER);

  snapshot.state.forEach((value, index) => {
    const node = geometry.nodes[index];
    const active = value > 0;
    const evaluated = appState.currentIndex === index;
    const flipAge = appState.flipFlashes[index] ? performance.now() - appState.flipFlashes[index] : Infinity;
    const flash = Math.max(0, 1 - flipAge / 520);
    const hue = (index * (360 / snapshot.size) + 18) % 360;
    const baseSize = p.width < 720 ? 24 : 30;
    const pulse = evaluated ? 1 + Math.sin(p.frameCount * 0.42) * 0.15 : 1;
    const size = (active ? baseSize * 1.34 : baseSize) * pulse + flash * 12;
    const color = hslToRgb(hue, active ? 82 : 12, active ? 62 : 32);

    p.push();
    p.drawingContext.shadowBlur = active ? 32 + flash * 26 : 8 + flash * 18;
    p.drawingContext.shadowColor = `rgba(${color.r}, ${color.g}, ${color.b}, ${active ? 0.65 : 0.24})`;
    p.noStroke();
    p.fill(color.r, color.g, color.b, active ? 230 : 96);
    p.circle(node.x, node.y, size);
    p.drawingContext.shadowBlur = 0;

    p.stroke(255, 255, 255, active ? 130 : 48);
    p.strokeWeight(1);
    p.noFill();
    p.circle(node.x, node.y, size + 4);

    if (appState.learnMode) {
      p.noStroke();
      p.fill(244, 244, 244, 230);
      p.textSize(12);
      p.text(snapshot.pitchNames[index], node.x, node.y + size * 0.88);
    }

    p.pop();
  });

  const stableText = snapshot.stable ? "attractor" : "settling";
  p.noStroke();
  p.fill(255, 255, 255, 150);
  p.textSize(12);
  p.text(stableText, geometry.center.x, geometry.center.y);
  p.pop();
}

function drawEnergyTrace(p, appState) {
  const history = appState.energyHistory || [];
  if (history.length < 2) return;

  const width = Math.min(280, p.width * 0.34);
  const height = 64;
  const x0 = p.width - width - 22;
  const y0 = p.height - height - (p.width < 720 ? 212 : 78);
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = Math.max(0.001, max - min);

  p.push();
  p.noFill();
  p.stroke(255, 255, 255, 46);
  p.strokeWeight(1);
  p.beginShape();
  history.forEach((energy, index) => {
    const x = x0 + (index / Math.max(1, history.length - 1)) * width;
    const y = y0 + height - ((energy - min) / range) * height;
    p.vertex(x, y);
  });
  p.endShape();
  p.noStroke();
  p.fill(255, 255, 255, 82);
  p.textAlign(p.RIGHT, p.TOP);
  p.textSize(11);
  p.text("energy", x0 + width, y0 + height + 6);
  p.pop();
}

function drawConnectionTooltip(p, snapshot, geometry) {
  const hover = findHoveredConnection(p, snapshot, geometry);
  if (!hover) return;

  const weight = snapshot.weights[hover.i][hover.j];
  const interval = Math.abs(snapshot.semitones[hover.i] - snapshot.semitones[hover.j]) % 12;
  const label = `${snapshot.pitchNames[hover.i]}-${snapshot.pitchNames[hover.j]}  interval ${interval}  weight ${weight.toFixed(2)}`;
  const x = Math.min(p.width - 18, Math.max(18, p.mouseX + 14));
  const y = Math.min(p.height - 18, Math.max(18, p.mouseY - 18));

  p.push();
  p.textSize(12);
  const w = p.textWidth(label) + 18;
  p.noStroke();
  p.fill(12, 12, 13, 235);
  p.rect(Math.min(x, p.width - w - 14), y - 16, w, 28, 8);
  p.fill(245, 245, 245, 230);
  p.textAlign(p.LEFT, p.CENTER);
  p.text(label, Math.min(x, p.width - w - 14) + 9, y - 2);
  p.pop();
}

function findHoveredConnection(p, snapshot, geometry) {
  if (!geometry || p.mouseX < 0 || p.mouseY < 0 || p.mouseX > p.width || p.mouseY > p.height) {
    return null;
  }

  let best = null;

  for (let i = 0; i < snapshot.size; i += 1) {
    for (let j = i + 1; j < snapshot.size; j += 1) {
      const a = geometry.nodes[i];
      const b = geometry.nodes[j];
      const distance = distanceToSegment(p.mouseX, p.mouseY, a.x, a.y, b.x, b.y);

      if (distance < 8 && (!best || distance < best.distance)) {
        best = { i, j, distance };
      }
    }
  }

  return best;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return Math.hypot(px - x1, py - y1);

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  return Math.hypot(px - x, py - y);
}

function hslToRgb(h, s, l) {
  const saturation = s / 100;
  const lightness = l / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}
