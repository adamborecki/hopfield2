const BASE_FREQUENCY = 130.8128;

const JUST_RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];

export class HopfieldAudio {
  constructor(settings = {}) {
    this.started = false;
    this.mode = "12tet";
    this.pitchNames = [];
    this.semitones = [];
    this.frequencies = [];
    this.synths = [];
    this.active = [];
    this.activeState = [];
    this.arpIndex = 0;
    this.arpMode = settings.arpMode || "chord";
    this.arpRate = settings.updateRate ?? 5;
    this.effectSettings = {
      reverb: settings.reverb ?? 0.38,
      delay: settings.delay ?? 0.18,
      volume: settings.volume ?? 0.72,
    };
  }

  async start(scale) {
    if (this.started) return;
    await Tone.start();

    this.master = new Tone.Gain(this.effectSettings.volume).toDestination();
    this.voiceBus = new Tone.Gain(0.82);
    this.delay = new Tone.FeedbackDelay("8n", 0.24);
    this.delay.wet.value = this.effectSettings.delay;
    this.reverb = new Tone.Reverb({ decay: 7.5, preDelay: 0.04, wet: this.effectSettings.reverb });

    if (typeof this.reverb.generate === "function") {
      await this.reverb.generate();
    }

    this.voiceBus.chain(this.delay, this.reverb, this.master);

    this.noiseFilter = new Tone.Filter({ frequency: 900, type: "bandpass", Q: 0.8 });
    this.noiseGain = new Tone.Gain(0);
    this.noise = new Tone.Noise("pink").chain(this.noiseFilter, this.noiseGain, this.delay);
    this.noise.start();

    this.arpSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle8" },
      envelope: { attack: 0.02, decay: 0.14, sustain: 0.18, release: 0.62 },
      volume: -14,
    }).connect(this.voiceBus);

    this.arpLoop = new Tone.Loop((time) => this.playArpStep(time), this.getArpInterval());
    this.arpLoop.start(0);
    Tone.Transport.bpm.value = 72;
    Tone.Transport.start();

    this.started = true;
    this.setScale(scale);
    this.setEffects(this.effectSettings);
  }

  setScale(scale) {
    if (this.started) {
      this.allNotesOff();
    }

    this.mode = scale.mode || this.mode;
    this.pitchNames = [...scale.pitchNames];
    this.semitones = [...scale.semitones];
    this.frequencies = this.semitones.map((semitone, index) => this.frequencyFor(semitone, index));

    if (this.started) {
      this.ensureSynths(this.frequencies.length);
    }

    this.active = this.frequencies.map(() => false);
    this.activeState = this.frequencies.map(() => -1);
  }

  frequencyFor(semitone, index) {
    if (this.mode === "just") {
      return BASE_FREQUENCY * (JUST_RATIOS[index] || Math.pow(2, semitone / 12));
    }

    return BASE_FREQUENCY * Math.pow(2, semitone / 12);
  }

  ensureSynths(count) {
    while (this.synths.length < count) {
      const synth = new Tone.Synth({
        oscillator: { type: "triangle8" },
        envelope: { attack: 0.24, decay: 0.12, sustain: 0.42, release: 1.6 },
        volume: -18,
      }).connect(this.voiceBus);
      this.synths.push(synth);
    }

    for (let i = count; i < this.synths.length; i += 1) {
      this.synths[i].triggerRelease();
    }
  }

  updateFromState(state, options = {}) {
    this.activeState = [...state];
    const active = state.map((value) => value > 0);

    if (!this.started) {
      this.active = active;
      return;
    }

    if (this.arpMode === "arpeggio") {
      this.releaseChordVoices(active);
      this.active = active;
      return;
    }

    active.forEach((isActive, index) => {
      const wasActive = this.active[index];
      const synth = this.synths[index];
      const frequency = this.frequencies[index];

      if (!synth || !frequency) return;

      if (isActive && !wasActive) {
        const velocity = options.flipped?.includes(index) ? 0.58 : 0.38;
        synth.triggerAttack(frequency, undefined, velocity);
      } else if (!isActive && wasActive) {
        synth.triggerRelease();
      }
    });

    this.active = active;
  }

  releaseChordVoices(nextActive = []) {
    this.active.forEach((wasActive, index) => {
      if (wasActive && !nextActive[index]) {
        this.synths[index]?.triggerRelease();
      } else if (wasActive) {
        this.synths[index]?.triggerRelease("+0.04");
      }
    });
  }

  playArpStep(time) {
    if (!this.started || this.arpMode !== "arpeggio") return;

    const activeIndexes = this.activeState
      .map((value, index) => (value > 0 ? index : -1))
      .filter((index) => index >= 0);

    if (activeIndexes.length === 0) return;

    const index = activeIndexes[this.arpIndex % activeIndexes.length];
    this.arpIndex += 1;
    const frequency = this.frequencies[index];

    if (frequency) {
      this.arpSynth.triggerAttackRelease(frequency, this.getArpNoteLength(), time, 0.42);
    }
  }

  getArpInterval() {
    return Math.max(0.075, Math.min(2, 1 / this.arpRate));
  }

  getArpNoteLength() {
    return Math.max(0.05, Math.min(0.7, this.getArpInterval() * 0.72));
  }

  setArpRate(rate) {
    this.arpRate = Math.max(0.5, Math.min(16, Number(rate) || 5));

    if (this.arpLoop) {
      this.arpLoop.interval = this.getArpInterval();
    }
  }

  setArpMode(mode) {
    this.arpMode = mode === "arpeggio" ? "arpeggio" : "chord";

    if (this.arpMode === "arpeggio") {
      this.releaseChordVoices([]);
      this.active = this.active.map(() => false);
    } else {
      this.updateFromState(this.activeState);
    }
  }

  setEffects({ reverb, delay, volume }) {
    this.effectSettings = {
      reverb: reverb ?? this.effectSettings.reverb,
      delay: delay ?? this.effectSettings.delay,
      volume: volume ?? this.effectSettings.volume,
    };

    if (!this.started) return;

    this.reverb.wet.rampTo(this.effectSettings.reverb, 0.08);
    this.delay.wet.rampTo(this.effectSettings.delay, 0.08);
    this.master.gain.rampTo(this.effectSettings.volume, 0.08);
  }

  updateGestureNoise({ active, x = 0.5, y = 0.5, velocity = 0 } = {}) {
    if (!this.started) return;

    const gain = active ? Math.min(0.18, 0.02 + velocity * 0.15) : 0;
    const frequency = 180 + x * 3800 + velocity * 1800;
    const q = 0.45 + y * 5.5;

    this.noiseGain.gain.rampTo(gain, active ? 0.04 : 0.22);
    this.noiseFilter.frequency.rampTo(frequency, 0.04);
    this.noiseFilter.Q.rampTo(q, 0.04);
  }

  allNotesOff() {
    this.synths.forEach((synth) => synth.triggerRelease());
    this.arpSynth?.releaseAll();
    this.active = this.active.map(() => false);
  }
}
