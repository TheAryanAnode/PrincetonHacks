import { NOTE_NAMES, noteName, type Instrument, type PaperControl, type Point } from "../types";
import { pointInPolygon } from "./geometry";
import type { AiShape } from "../../server/identify";

export const DRUMS = ["kick", "snare", "hat", "clap"];
export const FX = ["chime", "orbit", "pulse", "bloom"];
export const SOUNDS = [...DRUMS, ...FX];
const WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11];

/** What each drawn shape becomes by default. Change it per shape in the app. */
export type Voice = Instrument | "drums" | "fx";
export const SHAPE_VOICE: Record<AiShape["shape"], Voice> = {
  rectangle: "piano",
  circle: "drums",
  triangle: "marimba",
  diamond: "bass",
  star: "fx",
  other: "guitar",
};
/** Octave a pitched instrument starts at (C of that octave), and where bare letters land. */
export const BASE_OCTAVE: Record<Instrument, number> = { piano: 4, marimba: 5, guitar: 3, bass: 2, organ: 4, synth: 4 };

/** nth white key starting at C of `octave` (0 -> C4, 7 -> C5 with the default). */
export function whiteKey(n: number, octave = 4) {
  return 12 * (octave + 1) + Math.floor(n / 7) * 12 + WHITE_STEPS[n % 7];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const centroid = (p: Point[]): Point => [
  p.reduce((s, q) => s + q[0], 0) / p.length,
  p.reduce((s, q) => s + q[1], 0) / p.length,
];
const area = (p: Point[]) =>
  Math.abs(p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2;

/** "F#4", "Bb", "c", "E♭5" -> midi; a bare letter lands in `octave`. Anything else -> null. */
export function parseNote(label: string, octave = 4): number | null {
  const m = label.trim().match(/^([A-Ga-g])\s*([#♯b♭]?)\s*(\d)?$/);
  if (!m) return null;
  const base = NOTE_NAMES.indexOf(m[1].toUpperCase());
  const shift = m[2] === "#" || m[2] === "♯" ? 1 : m[2] ? -1 : 0;
  return 12 * (Number(m[3] ?? octave) + 1) + base + shift;
}

export const voiceOf = (c: PaperControl): Voice =>
  c.action.type === "sound" ? (DRUMS.includes(c.action.sound) ? "drums" : "fx") : c.action.type === "note" ? (c.action.instrument ?? "piano") : "piano";

export const controlName = (a: PaperControl["action"]) =>
  a.type === "note" ? noteName(a.midi) : a.type === "sound" ? a.sound[0].toUpperCase() + a.sound.slice(1) : a.action;

/**
 * Untrusted AI shapes -> playable controls, left to right.
 * Each shape type picks an instrument (SHAPE_VOICE). Pitched shapes count up white keys per instrument
 * (C, D, E…); drums and FX cycle through their sounds.
 * With `useLetters`, a note written inside a pitched shape ("F#", "Bb4") sets that exact note.
 * A sound name written inside any shape ("kick", "chime") always picks that sound.
 */
export function aiToControls(shapes: AiShape[], { useLetters = true } = {}): PaperControl[] {
  const valid = (Array.isArray(shapes) ? shapes : [])
    .filter(
      (s) =>
        Array.isArray(s?.points) &&
        s.points.length >= 3 &&
        s.points.length <= 64 &&
        s.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)),
    )
    .map((s) => {
      const polygon = s.points.map(([x, y]) => [clamp01(x), clamp01(y)] as Point);
      return { ...s, polygon, c: centroid(polygon) };
    })
    .filter((s) => area(s.polygon) >= 0.0004) // ignore specks
    .sort((a, b) => a.c[0] - b.c[0]);

  const out: PaperControl[] = [];
  const counts = new Map<Voice, number>();
  for (const s of valid) {
    if (out.length >= 32) break;
    // Only a shape whose centre sits inside another is a duplicate; touching neighbours are fine.
    if (out.some((o) => pointInPolygon(s.c, o.polygon) || pointInPolygon(centroid(o.polygon), s.polygon))) continue;
    const voice = SHAPE_VOICE[s.shape] ?? "guitar";
    const label = typeof s.label === "string" ? s.label.trim().toLowerCase() : "";
    const n = counts.get(voice) ?? 0;
    counts.set(voice, n + 1);
    let action: PaperControl["action"];
    if (SOUNDS.includes(label)) action = { type: "sound", sound: label };
    else if (voice === "drums") action = { type: "sound", sound: DRUMS[n % DRUMS.length] };
    else if (voice === "fx") action = { type: "sound", sound: FX[n % FX.length] };
    else {
      const written = useLetters ? parseNote(label, BASE_OCTAVE[voice]) : null;
      action = { type: "note", midi: written ?? whiteKey(n, BASE_OCTAVE[voice]), instrument: voice };
    }
    out.push({
      id: `ai-${out.length}`,
      kind: action.type === "sound" ? "pad" : "key",
      name: controlName(action),
      polygon: s.polygon,
      action,
      shape: s.shape,
      electrode: null,
    });
  }
  return out;
}
