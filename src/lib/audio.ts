import type { ControlEvent, Mode, PaperControl } from "../types";

type Source = ControlEvent["source"];
export type SoundPreset = "piano" | "felt" | "synth";
export const DRUM_SOUNDS = ["kick", "snare", "hat", "clap"] as const;
export const BOARD_SOUNDS = ["bloom", "chime", "orbit", "pulse"] as const;
const PIANO_NOTES = [
  "C3",
  "Ds3",
  "Fs3",
  "A3",
  "C4",
  "Ds4",
  "Fs4",
  "A4",
  "C5",
  "Ds5",
  "Fs5",
  "A5",
  "C6",
];
const MAX_VOICES = 48;
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
const ownerKey = (source: Source, controlId: string) =>
  `${source}:${controlId}`;

/** Production ownership bookkeeping, independent of the Web Audio clock.
 * Every source/control pair owns its own voices, even for identical pitches.
 */
export class VoiceOwnership {
  private held = new Map<string, Set<number>>();
  private sustained = new Map<string, Set<number>>();

  has(owner: string) {
    return this.held.has(owner);
  }
  hold(owner: string, voices: number[]) {
    if (this.held.has(owner)) return false;
    this.held.set(owner, new Set(voices));
    return true;
  }
  release(owner: string, sustain = false): number[] {
    const ids = this.held.get(owner);
    if (!ids) return [];
    this.held.delete(owner);
    if (sustain) {
      const pending = this.sustained.get(owner) ?? new Set<number>();
      ids.forEach((id) => pending.add(id));
      this.sustained.set(owner, pending);
    }
    return [...ids];
  }
  liftPedal(): number[] {
    const ids = [...this.sustained.values()].flatMap((group) => [...group]);
    this.sustained.clear();
    return ids;
  }
  releaseSource(source: Source): number[] {
    const ids: number[] = [];
    for (const collection of [this.held, this.sustained]) {
      for (const [owner, group] of collection) {
        if (owner.startsWith(`${source}:`)) {
          ids.push(...group);
          collection.delete(owner);
        }
      }
    }
    return ids;
  }
  forget(id: number) {
    for (const collection of [this.held, this.sustained]) {
      for (const [owner, group] of collection) {
        group.delete(id);
        // Preserve held controls until an actual up: long holds must not retrigger.
        if (collection === this.sustained && group.size === 0)
          collection.delete(owner);
      }
    }
  }
  clear() {
    this.held.clear();
    this.sustained.clear();
  }
}

interface Voice {
  id: number;
  source: AudioScheduledSourceNode;
  gain: GainNode;
  filter?: BiquadFilterNode;
  started: number;
  state: "held" | "sustained" | "released";
  oneShot: boolean;
}

/** One local audio graph. Call ready() directly inside a user gesture. */
export class AudioEngine {
  private context: AudioContext | null = null;
  private loading: Promise<void> | null = null;
  private loaded = false;
  private bank = new Map<number, AudioBuffer>();
  private sounds = new Map<string, AudioBuffer>();
  private mix!: GainNode;
  private master!: GainNode;
  private compressor!: DynamicsCompressorNode;
  private analyser!: AnalyserNode;
  private meter = new Float32Array(256);
  private reverb!: ConvolverNode;
  private room!: AudioBuffer;
  private wet!: GainNode;
  private ownership = new VoiceOwnership();
  private voices = new Map<number, Voice>();
  private nextId = 1;
  private volume = 0.72;
  private releaseSeconds = 0.22;
  private sustain = false;
  private effect = 0.12;
  private preset: SoundPreset = "piano";
  private assetError = "";

  async ready(): Promise<void> {
    if (!this.context) this.initialize();
    // Resume synchronously within the original user gesture, before any fetch.
    const resumed = this.context!.resume();
    if (!this.loading) this.loading = this.loadSamples();
    await Promise.all([resumed, this.loading]);
  }

  private initialize() {
    this.context = new AudioContext({ latencyHint: "interactive" });
    const context = this.context;
    this.mix = context.createGain();
    this.master = context.createGain();
    this.master.gain.value = this.volume;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.14;
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 256;
    this.wet = context.createGain();
    this.wet.gain.value = this.effect * 0.28;
    this.mix.connect(this.compressor);
    this.wet.connect(this.compressor);
    this.compressor.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(context.destination);
    this.room = context.createBuffer(
      2,
      Math.ceil(context.sampleRate * 0.48),
      context.sampleRate,
    );
    let seed = 909;
    for (let channel = 0; channel < 2; channel++) {
      const data = this.room.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 16807) % 2147483647;
        data[i] =
          ((seed / 2147483647) * 2 - 1) *
          Math.pow(1 - i / data.length, 3) *
          0.35;
      }
    }
    this.resetRoom();
    // Prime the graph without producing an audible test note.
    const warmup = context.createBufferSource();
    warmup.buffer = context.createBuffer(1, 32, context.sampleRate);
    warmup.connect(this.mix);
    warmup.onended = () => warmup.disconnect();
    warmup.start();
  }

  private resetRoom() {
    if (this.reverb) {
      this.mix.disconnect(this.reverb);
      this.reverb.disconnect();
    }
    this.reverb = this.context!.createConvolver();
    this.reverb.buffer = this.room;
    this.mix.connect(this.reverb);
    this.reverb.connect(this.wet);
  }

  private async loadSamples() {
    const decode = async (path: string) => {
      const response = await fetch(`/audio/${path}`);
      if (!response.ok) throw new Error(`Missing local audio: ${path}`);
      return this.context!.decodeAudioData(await response.arrayBuffer());
    };
    const jobs = [
      ...PIANO_NOTES.map(async (note, index) =>
        this.bank.set(48 + index * 3, await decode(`piano/${note}.wav`)),
      ),
      ...[...DRUM_SOUNDS, ...BOARD_SOUNDS].map(async (sound) =>
        this.sounds.set(sound, await decode(`oneshots/${sound}.wav`)),
      ),
    ];
    const results = await Promise.allSettled(jobs);
    const failures = results.filter(
      (result) => result.status === "rejected",
    ).length;
    if (failures) {
      this.assetError = `${failures} local audio files unavailable`;
      // Do not silently substitute a partly loaded instrument.
      if (this.bank.size !== PIANO_NOTES.length) this.bank.clear();
    }
    this.loaded = true;
  }

  trigger(
    event: ControlEvent,
    control: PaperControl,
    mode: Mode,
    octave = 0,
  ): void {
    const owner = ownerKey(event.source, event.controlId);
    if (event.phase === "up") {
      const pedal = this.sustain && (mode === "piano" || mode === "chords");
      for (const id of this.ownership.release(owner, pedal)) {
        const voice = this.voices.get(id);
        if (!voice || voice.oneShot) continue;
        if (pedal) voice.state = "sustained";
        else this.releaseVoice(voice, this.releaseSeconds);
      }
      return;
    }
    if (event.phase === "change") {
      if (control.kind === "slider") this.setVolume(event.value);
      return;
    }
    if (
      !this.loaded ||
      this.context?.state !== "running" ||
      mode === "game" ||
      this.ownership.has(owner)
    )
      return;
    const index = Number(control.id.match(/(\d+)$/)?.[1] ?? 0);
    const created: number[] = [];
    if (mode === "drums" || mode === "soundboard") {
      const fallback =
        mode === "drums" ? DRUM_SOUNDS[index % 4] : BOARD_SOUNDS[index % 4];
      const requested =
        control.action.type === "sound"
          ? control.action.sound.toLowerCase()
          : fallback;
      const alias: Record<string, string> = {
        "closed hat": "hat",
        "closed-hat": "hat",
        hihat: "hat",
        "hi-hat": "hat",
        ambient: "bloom",
        bell: "chime",
        space: "orbit",
        arpeggio: "pulse",
      };
      const sound =
        this.sounds.get(alias[requested] ?? requested) ??
        this.sounds.get(fallback);
      if (sound) created.push(this.playBuffer(sound, 1, 0.65, true));
    } else {
      const mapped = control.action.type === "note" ? control.action.midi : 60;
      const root = clamp(
        mapped + Math.round(clamp(octave, -3, 3)) * 12,
        12,
        108,
      );
      const offsets = mode === "chords" ? [0, root % 12 === 9 ? 3 : 4, 7] : [0];
      for (const offset of offsets)
        created.push(
          this.playNote(root + offset, offsets.length > 1 ? 0.26 : 0.45),
        );
    }
    if (created.length) this.ownership.hold(owner, created);
  }

  private playNote(midi: number, gain: number): number {
    if (this.preset !== "synth" && this.bank.size) {
      const pitch = [...this.bank.keys()].reduce((best, key) =>
        Math.abs(key - midi) < Math.abs(best - midi) ? key : best,
      );
      return this.playBuffer(
        this.bank.get(pitch)!,
        Math.pow(2, (midi - pitch) / 12),
        gain,
        false,
      );
    }
    const context = this.context!;
    const source = context.createOscillator();
    source.type = "triangle";
    source.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const id = this.addVoice(source, gain * 0.45, false);
    source.start(context.currentTime);
    // Explicit fallback synth safety cap, matching the finite piano samples.
    source.stop(context.currentTime + 8);
    return id;
  }

  private playBuffer(
    buffer: AudioBuffer,
    rate: number,
    gain: number,
    oneShot: boolean,
  ): number {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const id = this.addVoice(source, gain, oneShot);
    // Immediate live attack: never schedule on a later animation frame or beat.
    source.start(context.currentTime);
    return id;
  }

  private addVoice(
    source: AudioScheduledSourceNode,
    level: number,
    oneShot: boolean,
  ): number {
    if (this.voices.size >= MAX_VOICES) {
      const list = [...this.voices.values()];
      const oldest =
        list.find((voice) => voice.state === "released") ??
        list.find((voice) => voice.state === "sustained") ??
        list[0];
      // At the hard cap, stop and disconnect the stolen voice synchronously.
      oldest.source.stop();
      this.cleanup(oldest.id);
    }
    const context = this.context!;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(level, context.currentTime + 0.003);
    source.connect(gain);
    const id = this.nextId++;
    const voice: Voice = {
      id,
      source,
      gain,
      started: context.currentTime,
      state: "held",
      oneShot,
    };
    if (this.preset === "felt" && !oneShot) {
      voice.filter = context.createBiquadFilter();
      voice.filter.type = "lowpass";
      voice.filter.frequency.value = 2200;
      voice.filter.Q.value = 0.55;
      gain.connect(voice.filter);
      voice.filter.connect(this.mix);
    } else gain.connect(this.mix);
    this.voices.set(id, voice);
    source.onended = () => this.cleanup(id);
    return id;
  }

  private releaseVoice(voice: Voice, seconds: number) {
    if (voice.state === "released") return;
    voice.state = "released";
    const time = this.context!.currentTime;
    voice.gain.gain.cancelAndHoldAtTime(time);
    voice.gain.gain.linearRampToValueAtTime(0, time + seconds);
    voice.source.stop(time + seconds + 0.005);
  }

  private cleanup(id: number) {
    const voice = this.voices.get(id);
    if (!voice) return;
    voice.source.disconnect();
    voice.gain.disconnect();
    voice.filter?.disconnect();
    this.voices.delete(id);
    this.ownership.forget(id);
  }

  /** Input loss bypasses the sustain pedal without releasing other sources. */
  releaseSource(source: Source): void {
    for (const id of this.ownership.releaseSource(source)) {
      const voice = this.voices.get(id);
      if (voice) this.releaseVoice(voice, 0.035);
    }
  }

  stopAll(): void {
    this.sustain = false;
    this.ownership.clear();
    for (const voice of [...this.voices.values()]) {
      // Stop-all is immediate, including previously scheduled release tails.
      voice.source.stop();
      this.cleanup(voice.id);
    }
    if (this.context) this.resetRoom();
  }

  setVolume(value: number): void {
    this.volume = clamp(value, 0, 1);
    if (this.context)
      this.master.gain.setTargetAtTime(
        this.volume,
        this.context.currentTime,
        0.012,
      );
  }
  setRelease(seconds: number): void {
    this.releaseSeconds = clamp(seconds, 0.025, 2);
  }
  setSustain(value: boolean): void {
    this.sustain = value;
    if (!value)
      for (const id of this.ownership.liftPedal()) {
        const voice = this.voices.get(id);
        if (voice) this.releaseVoice(voice, this.releaseSeconds);
      }
  }
  setEffect(value: number): void {
    this.effect = clamp(value, 0, 1);
    if (this.context)
      this.wet.gain.setTargetAtTime(
        this.effect * 0.28,
        this.context.currentTime,
        0.02,
      );
  }
  setPreset(preset: SoundPreset): void {
    this.preset = preset;
  }

  click(accent: boolean): void {
    if (!this.loaded || this.context?.state !== "running") return;
    const source = this.context.createOscillator();
    source.type = "sine";
    source.frequency.value = accent ? 1400 : 1000;
    const id = this.addVoice(source, accent ? 0.1 : 0.06, true);
    source.start(this.context.currentTime);
    // Begin decay after the attack, without a JS timer in the audio path.
    const voice = this.voices.get(id)!;
    voice.gain.gain.linearRampToValueAtTime(
      0,
      this.context.currentTime + 0.035,
    );
    source.stop(this.context.currentTime + 0.04);
  }

  getDiagnostics() {
    let level = 0;
    if (this.analyser && this.context?.state === "running") {
      this.analyser.getFloatTimeDomainData(this.meter);
      level = Math.sqrt(
        this.meter.reduce((sum, x) => sum + x * x, 0) / this.meter.length,
      );
    }
    const fallback =
      this.loaded && this.bank.size === 0 && this.preset !== "synth";
    return {
      state: this.context
        ? this.loaded
          ? this.context.state
          : "loading"
        : "not started",
      voices: this.voices.size,
      baseLatency: this.context?.baseLatency ?? 0,
      outputLatency: this.context
        ? ((this.context as AudioContext & { outputLatency?: number })
            .outputLatency ?? 0)
        : 0,
      level: clamp(level * 3, 0, 1),
      preset: fallback
        ? "Synth fallback · piano samples unavailable"
        : this.preset === "felt"
          ? "Felt piano"
          : this.preset === "synth"
            ? "Local synth"
            : "Salamander grand",
      assetError: this.assetError,
    };
  }
}
