import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Crosshair,
  Maximize2,
  ScanLine,
  Sparkles,
} from "lucide-react";
import type {
  Corners,
  Mode,
  PaperControl,
  PaperLayout,
  Point,
  Stage,
} from "../types";
import { KEY_BINDINGS, noteName } from "../types";
import {
  computeHomography,
  controlsOverlap,
  validateControlPolygon,
  transformPoint,
} from "../lib/geometry";

const DEMO_CORNERS: Corners = [
  [0.115, 0.215],
  [0.837, 0.135],
  [0.918, 0.807],
  [0.179, 0.897],
];
const UNIT: Corners = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
function controlLabel(
  c: PaperControl,
  mode: Mode,
  i: number,
  octave = 0,
) {
  if (mode === "chords") return ["C", "Am", "F", "G"][i % 4];
  if (mode === "drums") return ["Kick", "Snare", "Hi-hat", "Clap"][i % 4];
  if (mode === "soundboard") return ["Chime", "Orbit", "Pulse", "Bloom"][i % 4];
  if (mode === "game") return ["Left", "Jump", "Right", "Reset"][i % 4];
  return c.action.type === "note"
    ? noteName(c.action.midi + octave * 12)
    : c.name;
}
interface Props {
  layout: PaperLayout;
  mode: Mode;
  stage: Stage;
  stream: MediaStream | null;
  snapshot: string | null;
  corners: Corners;
  setCorners: (v: Corners) => void;
  active: Set<string>;
  augmented: boolean;
  intensity: number;
  selected: string | null;
  setSelected: (v: string | null) => void;
  editCorners: boolean;
  onChangeControl: (id: string, polygon: Point[], commit: boolean) => void;
  onPress: (id: string) => void;
  onRelease: (id: string) => void;
  onVideo: (video: HTMLVideoElement | null) => void;
  tip: Point | null;
  revealing: boolean;
  octave: number;
  fullscreen: () => void;
  cameraReady: boolean;
}
export default function PaperStage(p: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const drag = useRef<{
    kind: "corner" | "control" | "resize";
    index?: number;
    id?: string;
    start: Point;
    polygon?: Point[];
    pointer: number;
  } | null>(null);
  const [aspect, setAspect] = useState(16 / 10);
  const hasCamera = !!p.stream || !!p.snapshot;
  const height = hasCamera ? 1000 / aspect : 680;
  const corners = hasCamera ? p.corners : DEMO_CORNERS;
  const h = useMemo(() => {
    try {
      return computeHomography(UNIT, corners);
    } catch {
      return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    }
  }, [corners]);
  const inverse = useMemo(() => {
    try {
      return computeHomography(corners, UNIT);
    } catch {
      return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    }
  }, [corners]);
  const project = (point: Point) => {
    const q = transformPoint(h, point);
    return [q[0] * 1000, q[1] * height] as Point;
  };
  const points = (poly: Point[]) =>
    poly
      .map(project)
      .map((q) => q.join(","))
      .join(" ");
  const localPoint = (e: ReactPointerEvent): Point => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [q.x / 1000, q.y / height];
  };
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = p.stream;
    p.onVideo(video);
    if (p.stream) video.play().catch(() => {});
    return () => p.onVideo(null);
  }, [p.stream, p.onVideo]);
  const down = (e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (p.stage === "scan" && !p.editCorners) {
      p.setSelected(id);
      const c = p.layout.controls.find((c) => c.id === id)!;
      drag.current = {
        kind: "control",
        id,
        start: transformPoint(inverse, localPoint(e)),
        polygon: c.polygon.map((q) => [...q] as Point),
        pointer: e.pointerId,
      };
    } else if (p.stage === "studio") {
      p.onPress(id);
    }
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const q = localPoint(e);
    if (d.kind === "corner") {
      const next = [...p.corners] as Corners;
      next[d.index!] = [
        Math.min(0.99, Math.max(0.01, q[0])),
        Math.min(0.99, Math.max(0.01, q[1])),
      ];
      p.setCorners(next);
    } else {
      const paper = transformPoint(inverse, q);
      const dx = paper[0] - d.start[0],
        dy = paper[1] - d.start[1];
      const original = d.polygon!;
      if (d.kind === "resize") {
        const next = original.map((v) => [...v] as Point);
        next[d.index!] = [
          Math.max(0.01, Math.min(0.99, paper[0])),
          Math.max(0.01, Math.min(0.99, paper[1])),
        ];
        p.onChangeControl(d.id!, next, false);
      } else {
        const minx = Math.min(...original.map((q) => q[0])),
          maxx = Math.max(...original.map((q) => q[0])),
          miny = Math.min(...original.map((q) => q[1])),
          maxy = Math.max(...original.map((q) => q[1]));
        const x = Math.max(-minx, Math.min(1 - maxx, dx)),
          y = Math.max(-miny, Math.min(1 - maxy, dy));
        p.onChangeControl(
          d.id!,
          original.map((v) => [v[0] + x, v[1] + y]),
          false,
        );
      }
    }
  };
  const end = (e: ReactPointerEvent, id?: string) => {
    const d = drag.current;
    if (d?.id) {
      const c = p.layout.controls.find((c) => c.id === d.id);
      if (c) p.onChangeControl(c.id, c.polygon, true);
    }
    drag.current = null;
    if (id) p.onRelease(id);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const dark = p.layout.skin !== "obsidian-ivory";
  const conflicts = new Set(controlsOverlap(p.layout.controls));
  const overlay = p.augmented || p.stage === "scan";
  const base: Point[] = [
    [0.055, 0.22],
    [0.945, 0.22],
    [0.945, 0.865],
    [0.055, 0.865],
  ];
  return (
    <div
      className={`scene ${p.revealing ? "revealing" : ""} ${hasCamera ? "with-camera" : "demo-scene"}`}
    >
      <div className="scene-top">
        <div className="scene-badge">
          <span
            className={hasCamera && p.cameraReady ? "live-dot" : "preview-dot"}
          />
          {hasCamera
            ? p.snapshot && p.stage === "scan"
              ? "FROZEN FRAME"
              : "LIVE CAMERA"
            : p.stage === "setup"
              ? "LAYOUT PREVIEW"
              : "INTERACTIVE PREVIEW"}
        </div>
        <div className="scene-tools">
          <span>
            {hasCamera
              ? p.stage === "studio"
                ? "Outline skin · hands visible"
                : "Paper calibration"
              : "No camera connected"}
          </span>
          <button
            className="icon-button"
            aria-label="Fullscreen stage"
            onClick={p.fullscreen}
          >
            <Maximize2 size={16} />
          </button>
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 1000 ${height}`}
        className="paper-scene"
        role="group"
        aria-label="Paper controller canvas"
        onPointerMove={move}
        onPointerUp={(e) => end(e)}
        onPointerCancel={(e) => {
          end(e);
          p.layout.controls.forEach((c) => p.onRelease(c.id));
        }}
      >
        <defs>
          <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#ece9de" />
            <stop offset="1" stopColor="#c9c7bd" />
          </linearGradient>
          <linearGradient id="ivory" x1="0" y1="0" x2=".3" y2="1">
            <stop stopColor="#f2f1e9" />
            <stop offset=".82" stopColor="#ddded8" />
            <stop offset="1" stopColor="#acb6b6" />
          </linearGradient>
          <linearGradient id="graphite" x1="0" y1="0" x2=".7" y2="1">
            <stop stopColor="#3a4147" />
            <stop offset="1" stopColor="#11171b" />
          </linearGradient>
          <linearGradient id="active-key" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#e0f8ff" />
            <stop offset="1" stopColor="#80d5ea" />
          </linearGradient>
          <radialGradient id="desk-light">
            <stop stopColor="#30383e" stopOpacity=".5" />
            <stop offset="1" stopColor="#10151a" stopOpacity="0" />
          </radialGradient>
          <filter
            id="paper-shadow"
            x="-30%"
            y="-30%"
            width="170%"
            height="180%"
          >
            <feDropShadow
              dx="0"
              dy="24"
              stdDeviation="26"
              floodColor="#000"
              floodOpacity=".65"
            />
          </filter>
          <filter id="key-glow" x="-100%" y="-50%" width="300%" height="200%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="5"
              floodColor="#95e5ff"
              floodOpacity=".55"
            />
          </filter>
          <pattern
            id="grid"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".65" fill="#8e9ba8" opacity=".17" />
          </pattern>
        </defs>
        {!hasCamera && (
          <g>
            <rect width="1000" height={height} fill="url(#grid)" />
            <ellipse
              cx="510"
              cy="360"
              rx="570"
              ry="380"
              fill="url(#desk-light)"
            />
            <polygon
              points={points(UNIT)}
              fill="url(#paper)"
              filter="url(#paper-shadow)"
            />
            <polygon
              points={points(UNIT)}
              fill="none"
              stroke="#fff"
              strokeOpacity=".3"
              strokeWidth="1.2"
            />
            <g
              transform={`translate(${project([0.075, 0.105]).join(" ")}) rotate(-4.8)`}
            >
              <text className="paper-title">a little possibility.</text>
              <text y="21" className="paper-subtitle">
                PAPER PIANO / 001
              </text>
            </g>
            <g
              transform={`translate(${project([0.075, 0.94]).join(" ")}) rotate(-4.8)`}
            >
              <text className="paper-footnote">
                made by you. brought to life.
              </text>
            </g>
          </g>
        )}
        <foreignObject
          x="0"
          y="0"
          width="1000"
          height={height}
          style={{
            display:
              p.stream && !(p.snapshot && p.stage === "scan")
                ? "block"
                : "none",
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight)
                setAspect(v.videoWidth / v.videoHeight);
            }}
            style={{ width: "100%", height: "100%", objectFit: "fill" }}
          />
        </foreignObject>
        {p.snapshot && p.stage === "scan" && (
          <image
            href={p.snapshot}
            width="1000"
            height={height}
            preserveAspectRatio="none"
          />
        )}
        {overlay && !p.editCorners && (
          <polygon
            className="instrument-base"
            points={points(base)}
            fill="url(#graphite)"
            stroke="#707b82"
            strokeOpacity=".4"
            opacity={hasCamera ? 0.16 : 1}
          />
        )}
        {!p.editCorners &&
          p.layout.controls.map((c, i) => {
            const isActive = p.active.has(c.id),
              isSelected = p.selected === c.id && p.stage === "scan";
            const minx = Math.min(...c.polygon.map((q) => q[0])),
              maxx = Math.max(...c.polygon.map((q) => q[0])),
              miny = Math.min(...c.polygon.map((q) => q[1])),
              maxy = Math.max(...c.polygon.map((q) => q[1]));
            const label = project([
              (minx + maxx) / 2,
              Math.min(maxy - 0.045, miny + 0.09),
            ]);
            const shortcut = project([(minx + maxx) / 2, maxy - 0.065]);
            const angle =
              (Math.atan2(
                project([maxx, miny])[1] - project([minx, miny])[1],
                project([maxx, miny])[0] - project([minx, miny])[0],
              ) *
                180) /
              Math.PI;
            return (
              <g
                key={c.id}
                className={`paper-control ${isActive ? "is-active" : ""} ${isSelected ? "is-selected" : ""}`}
                onPointerDown={(e) => down(e, c.id)}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  end(e, c.id);
                }}
                onPointerCancel={(e) => end(e, c.id)}
                role="button"
                aria-label={`Play ${controlLabel(c, p.mode, i, p.octave)}`}
                tabIndex={p.stage === "studio" ? 0 : -1}
                onKeyDown={(e) => {
                  if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                    e.preventDefault();
                    p.onPress(c.id);
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === " " || e.key === "Enter") p.onRelease(c.id);
                }}
              >
                <polygon
                  points={points(c.polygon)}
                  fill={
                    overlay
                      ? isActive
                        ? "url(#active-key)"
                        : dark
                          ? "url(#graphite)"
                          : "url(#ivory)"
                      : "none"
                  }
                  fillOpacity={
                    hasCamera && p.stage === "studio"
                      ? (isActive ? 0.55 : 0.18) * p.intensity
                      : Math.max(0.2, p.intensity)
                  }
                  stroke={
                    conflicts.has(c.id) || !validateControlPolygon(c.polygon)
                      ? "#f28b91"
                      : isSelected || isActive
                        ? "#95e5ff"
                        : overlay
                          ? dark
                            ? "#7c909d"
                            : "#b7bfbe"
                          : "#464947"
                  }
                  strokeWidth={isSelected ? 3 : overlay ? 1.3 : 2.7}
                  strokeLinejoin="round"
                  filter={isActive ? "url(#key-glow)" : undefined}
                />
                {overlay && (
                  <>
                    <text
                      transform={`translate(${label.join(" ")}) rotate(${angle})`}
                      className={`key-note ${dark && !isActive ? "dark-note" : ""}`}
                      style={{ fill: hasCamera ? "#e3f8ff" : undefined }}
                      textAnchor="middle"
                    >
                      {controlLabel(c, p.mode, i, p.octave)}
                    </text>
                    <text
                      transform={`translate(${shortcut.join(" ")}) rotate(${angle})`}
                      textAnchor="middle"
                      className={`key-shortcut ${dark && !isActive ? "dark-note" : ""}`}
                      style={{ fill: hasCamera ? "#c0d4de" : undefined }}
                    >
                      {KEY_BINDINGS[i]?.toUpperCase() || "•"}
                    </text>
                  </>
                )}
                {!overlay && (
                  <text
                    x={shortcut[0]}
                    y={shortcut[1]}
                    textAnchor="middle"
                    className="sketch-note"
                    transform={`rotate(${angle} ${shortcut.join(" ")})`}
                  >
                    {controlLabel(c, "piano", i, p.octave)}
                  </text>
                )}
                {isSelected &&
                  c.polygon.map((q, j) => {
                    const v = project(q);
                    return (
                      <circle
                        key={j}
                        cx={v[0]}
                        cy={v[1]}
                        r="5.5"
                        fill="#b0ecff"
                        stroke="#10232b"
                        strokeWidth="2"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          drag.current = {
                            kind: "resize",
                            id: c.id,
                            index: j,
                            start: q,
                            polygon: c.polygon,
                            pointer: e.pointerId,
                          };
                        }}
                      />
                    );
                  })}
              </g>
            );
          })}
        {p.editCorners && (
          <g>
            <polygon
              points={corners
                .map((q) => `${q[0] * 1000},${q[1] * height}`)
                .join(" ")}
              fill="#95e5ff"
              fillOpacity=".07"
              stroke="#95e5ff"
              strokeDasharray="8 5"
              strokeWidth="2"
            />
            {corners.map((q, i) => (
              <g
                key={i}
                className="corner-handle"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = {
                    kind: "corner",
                    index: i,
                    start: localPoint(e),
                    pointer: e.pointerId,
                  };
                }}
              >
                <circle
                  cx={q[0] * 1000}
                  cy={q[1] * height}
                  r="13"
                  fill="#95e5ff"
                  stroke="#122e3e"
                  strokeWidth="3"
                />
                <text
                  x={q[0] * 1000}
                  y={q[1] * height + 4}
                  fill="#10212b"
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="700"
                >
                  {i + 1}
                </text>
              </g>
            ))}
          </g>
        )}
        {p.tip && p.stage === "studio" && (
          <circle
            cx={p.tip[0] * 1000}
            cy={p.tip[1] * height}
            r="8"
            stroke="#95e5ff"
            strokeWidth="2"
            fill="#95e5ff"
            fillOpacity=".22"
          />
        )}
        {!hasCamera && (
          <g
            className="registration-guides"
            fill="none"
            stroke="#7aadb9"
            strokeWidth="1.5"
            opacity=".5"
          >
            <path d="M85 166v-22h22 M854 75h22v22 M944 536v22h-22 M160 627h-22v-22" />
          </g>
        )}
      </svg>
      <div className="scene-bottom">
        <span>
          <Crosshair size={14} />
          {p.stage === "scan"
            ? p.editCorners
              ? "Drag the four corners onto your paper"
              : "Drag a control or adjust its corners"
            : p.stage === "studio"
              ? hasCamera
                ? "Paper transform locked"
                : "8 keys · one sheet · endless possibilities"
              : "A blank page is a good place to start."}
        </span>
        <span className="scene-mode">
          {p.augmented ? (
            <>
              <Sparkles size={13} /> {hasCamera ? "AR OUTLINE" : "AUGMENTED"}
            </>
          ) : (
            <>
              <ScanLine size={13} /> {hasCamera ? "CAMERA" : "PAPER"}
            </>
          )}
        </span>
      </div>
    </div>
  );
}
