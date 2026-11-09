import { NATURAL_NOTES, noteName, type Corners, type PaperLayout } from "../types";
import { validateControlPolygon } from "./geometry";
export const INITIAL_CORNERS: Corners = [
  [0.12, 0.12],
  [0.88, 0.12],
  [0.88, 0.88],
  [0.12, 0.88],
];

export function createDefaultLayout(): PaperLayout {
  return {
    version: 1,
    name: "Paper Piano",
    paperAspect: 1.414,
    skin: "obsidian-ivory",
    controls: NATURAL_NOTES.map((midi, i) => ({
      id: `key-${i}`,
      name: noteName(midi),
      kind: "key",
      polygon: [
        [0.075 + i * 0.1065, 0.25],
        [0.075 + i * 0.1065 + 0.1, 0.25],
        [0.075 + i * 0.1065 + 0.1, 0.84],
        [0.075 + i * 0.1065, 0.84],
      ],
      action: { type: "note", midi },
      electrode: null,
    })),
  };
}
export function isLayout(value: unknown): value is PaperLayout {
  if (!value || typeof value !== "object") return false;
  const v = value as PaperLayout;
  return (
    v.version === 1 &&
    typeof v.name === "string" &&
    v.name.length <= 120 &&
    Number.isFinite(v.paperAspect) &&
    v.paperAspect > 0 &&
    ["obsidian-ivory", "smoked-glass", "midnight-circuit"].includes(v.skin) &&
    Array.isArray(v.controls) &&
    v.controls.length > 0 &&
    v.controls.length <= 32 &&
    v.controls.every(
      (c) =>
        c &&
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        ["key", "pad"].includes(c.kind) &&
        Array.isArray(c.polygon) &&
        validateControlPolygon(c.polygon) &&
        c.action &&
        (c.action.type === "note"
          ? Number.isInteger(c.action.midi) &&
            c.action.midi >= 0 &&
            c.action.midi <= 127
          : c.action.type === "sound"
            ? typeof c.action.sound === "string"
            : c.action.type === "game" && typeof c.action.action === "string"),
    ) &&
    new Set(v.controls.map((c) => c.id)).size === v.controls.length
  );
}
export const STORAGE_KEY = "paperpilot.layout.v1";
export function readSavedLayout(): PaperLayout | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return isLayout(saved) ? saved : null;
  } catch {
    return null;
  }
}
export function saveLayout(layout: PaperLayout) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}
