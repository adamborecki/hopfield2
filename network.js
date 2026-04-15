const CONSONANCE_TABLE = {
  0: 0,
  1: -1.0,
  2: -0.3,
  3: 0.6,
  4: 0.8,
  5: 0.9,
  6: -0.8,
  7: 1.0,
  8: 0.6,
  9: 0.7,
  10: -0.2,
  11: -0.7,
};

const SCALES = {
  "12tet": {
    label: "12-tone equal temperament",
    pitchNames: ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"],
    semitones: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
  just: {
    label: "just intonation",
    pitchNames: ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"],
    semitones: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
  diatonic: {
    label: "7-note diatonic",
    pitchNames: ["C", "D", "E", "F", "G", "A", "B"],
    semitones: [0, 2, 4, 5, 7, 9, 11],
  },
};

export class HopfieldNetwork {
  constructor(options = {}) {
    this.mode = options.mode || "12tet";
    this.consonanceStrength = options.consonanceStrength ?? 1;
    this.temperature = options.temperature ?? 0.03;
    this.configure({ mode: this.mode });
  }

  configure(options = {}) {
    this.mode = SCALES[options.mode] ? options.mode : this.mode || "12tet";
    this.consonanceStrength = options.consonanceStrength ?? this.consonanceStrength ?? 1;
    this.temperature = options.temperature ?? this.temperature ?? 0.03;

    const scale = SCALES[this.mode];
    this.pitchNames = [...scale.pitchNames];
    this.semitones = [...scale.semitones];
    this.size = this.pitchNames.length;
    this.state = this.state?.length === this.size ? this.state : new Array(this.size).fill(-1);
    this.weights = this.buildWeights();
    this.lastEnergy = this.energy();
    return this.snapshot();
  }

  buildWeights() {
    return Array.from({ length: this.size }, (_, i) =>
      Array.from({ length: this.size }, (_, j) => {
        if (i === j) return 0;
        const interval = Math.abs(this.semitones[i] - this.semitones[j]) % 12;
        const weight = CONSONANCE_TABLE[interval] ?? 0;
        return weight * this.consonanceStrength;
      }),
    );
  }

  setConsonanceStrength(value) {
    this.consonanceStrength = Number(value);
    this.weights = this.buildWeights();
    this.lastEnergy = this.energy();
  }

  setTemperature(value) {
    this.temperature = Number(value);
  }

  randomize(activeChance = 0.46) {
    this.state = this.state.map(() => (Math.random() < activeChance ? 1 : -1));

    if (!this.state.some((value) => value > 0)) {
      this.state[Math.floor(Math.random() * this.size)] = 1;
    }

    this.lastEnergy = this.energy();
    return this.snapshot();
  }

  localField(index) {
    return this.weights[index].reduce((sum, weight, j) => sum + weight * this.state[j], 0);
  }

  updateAsync(forceIndex = null) {
    const index = Number.isInteger(forceIndex) ? forceIndex : Math.floor(Math.random() * this.size);
    const previousEnergy = this.lastEnergy;
    const field = this.localField(index);
    const oldState = this.state[index];
    let newState = oldState;

    if (this.temperature <= 0.001) {
      if (Math.abs(field) > 0.0001) {
        newState = field >= 0 ? 1 : -1;
      }
    } else {
      const scaled = Math.max(-60, Math.min(60, (2 * field) / this.temperature));
      const probabilityOn = 1 / (1 + Math.exp(-scaled));
      newState = Math.random() < probabilityOn ? 1 : -1;
    }

    this.state[index] = newState;
    const nextEnergy = this.energy();
    this.lastEnergy = nextEnergy;

    return {
      index,
      field,
      oldState,
      newState,
      flipped: oldState !== newState,
      previousEnergy,
      energy: nextEnergy,
      deltaEnergy: nextEnergy - previousEnergy,
      stable: this.isStable(),
      state: [...this.state],
    };
  }

  energy() {
    let total = 0;

    for (let i = 0; i < this.size; i += 1) {
      for (let j = 0; j < this.size; j += 1) {
        total += this.weights[i][j] * this.state[i] * this.state[j];
      }
    }

    return -0.5 * total;
  }

  isStable() {
    for (let i = 0; i < this.size; i += 1) {
      const field = this.localField(i);

      if (Math.abs(field) > 0.0001) {
        const preferred = field >= 0 ? 1 : -1;
        if (preferred !== this.state[i]) return false;
      }
    }

    return true;
  }

  perturb({ x = 0.5, y = 0.5, velocity = 0.25, spread = 0.15 } = {}) {
    const oldEnergy = this.energy();
    const centerX = x - 0.5;
    const centerY = y - 0.5;
    const angle = Math.atan2(centerY, centerX);
    const normalizedVelocity = Math.max(0, Math.min(1, velocity));
    const changed = [];

    for (let i = 0; i < this.size; i += 1) {
      const nodeAngle = -Math.PI / 2 + (i / this.size) * Math.PI * 2;
      const directionBias = (Math.cos(angleDifference(angle, nodeAngle)) + 1) / 2;
      const distanceBias = Math.min(1, Math.hypot(centerX, centerY) * 1.8);
      const chance = Math.min(0.92, spread + normalizedVelocity * 0.52 + directionBias * distanceBias * 0.36);

      if (Math.random() < chance) {
        this.state[i] *= -1;
        changed.push(i);
      }
    }

    if (changed.length === 0) {
      const fallback = Math.floor((((angle + Math.PI * 2.5) % (Math.PI * 2)) / (Math.PI * 2)) * this.size);
      this.state[fallback % this.size] *= -1;
      changed.push(fallback % this.size);
    }

    const nextEnergy = this.energy();
    this.lastEnergy = nextEnergy;
    return {
      changed,
      energyInjected: Math.max(0, nextEnergy - oldEnergy),
      previousEnergy: oldEnergy,
      energy: nextEnergy,
      state: [...this.state],
    };
  }

  snapshot() {
    return {
      mode: this.mode,
      pitchNames: [...this.pitchNames],
      semitones: [...this.semitones],
      size: this.size,
      state: [...this.state],
      weights: this.weights.map((row) => [...row]),
      energy: this.energy(),
      stable: this.isStable(),
    };
  }
}

export function getScale(mode) {
  return SCALES[mode] || SCALES["12tet"];
}

export function getConsonanceTable() {
  return { ...CONSONANCE_TABLE };
}

function angleDifference(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}
