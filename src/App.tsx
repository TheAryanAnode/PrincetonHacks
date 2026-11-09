import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Drum,
  FolderOpen,
  Gamepad2,
  Hand,
  Headphones,
  Keyboard,
  Layers3,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  Piano,
  Play,
  Plus,
  RotateCcw,
  Save,
  ScanLine,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareMousePointer,
  Trash2,
  Undo2,
  Volume2,
  Waves,
  X,
} from "lucide-react";
import { AudioEngine } from "./lib/audio";
import { CameraController } from "./lib/camera";
import { HandTracker, type HandFrame } from "./lib/tracking";
import { MidiController } from "./lib/midi";
import {
  computeHomography,
  controlsOverlap,
  pointInPolygon,
  transformPoint,
  validateControlPolygon,
  validateCorners,
} from "./lib/geometry";
import { recognizeControls, rectifyImage } from "./lib/recognition";
import {
  INITIAL_CORNERS,
  createDefaultLayout,
  isLayout,
  readSavedLayout,
  saveLayout,
} from "./lib/layout";
import {
  KEY_BINDINGS,
  noteName,
  type ControlEvent,
  type Corners,
  type Mode,
  type PaperControl,
  type PaperLayout,
  type Point,
  type Skin,
  type Stage,
} from "./types";
import PaperStage from "./components/PaperStage";
import MiniGame from "./components/MiniGame";
const MODES: {
  id: Mode;
  name: string;
  icon: typeof Piano;
  description: string;
}[] = [
  {
    id: "piano",
    name: "Piano",
    icon: Piano,
    description: "A little paper. A lot of possibility.",
  },
  {
    id: "chords",
    name: "Chords",
    icon: Layers3,
    description: "One touch. A room full of harmony.",
  },
  {
    id: "drums",
    name: "Drums",
    icon: Drum,
    description: "Find a rhythm in the everyday.",
  },
  {
    id: "soundboard",
    name: "Sounds",
    icon: AudioLines,
    description: "Small gestures. Unexpected sounds.",
  },
  {
    id: "game",
    name: "Play",
    icon: Gamepad2,
    description: "Your paper has a playful side.",
  },
];
const UNIT: Corners = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
function mappedControl(c: PaperControl, mode: Mode, i: number): PaperControl {
  if (mode === "chords")
    return { ...c, action: { type: "note", midi: [60, 57, 53, 55][i % 4] } };
  if (mode === "drums")
    return {
      ...c,
      action: { type: "sound", sound: ["kick", "snare", "hat", "clap"][i % 4] },
    };
  if (mode === "soundboard")
    return {
      ...c,
      action: {
        type: "sound",
        sound: ["chime", "orbit", "pulse", "bloom"][i % 4],
      },
    };
  if (mode === "game")
    return {
      ...c,
      action: {
        type: "game",
        action: ["left", "jump", "right", "reset"][i % 4],
      },
    };
  return c;
}
function IconButton({
  label,
  children,
  onClick,
  active = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      className={`toggle ${checked ? "on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
    >
      <span />
    </button>
  );
}
function Range({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  display: string;
}) {
  return (
    <label className="range-control">
      <span>
        {label}
        <output>{display}</output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={
          {
            "--range-fill": `${(100 * (value - min)) / (max - min)}%`,
          } as React.CSSProperties
        }
      />
    </label>
  );
}

export default function App() {
  const [stage, setStage] = useState<Stage>("setup"),
    [mode, setMode] = useState<Mode>("piano");
  const [layout, setLayout] = useState<PaperLayout>(createDefaultLayout),
    [saved, setSaved] = useState(readSavedLayout);
  const [selected, setSelected] = useState<string | null>(null),
    [history, setHistory] = useState<PaperLayout[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [deviceId, setDeviceId] = useState("");
  const [cameraBusy, setCameraBusy] = useState(false),
    [cameraError, setCameraError] = useState(""),
    [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null),
    [corners, setCorners] = useState<Corners>(INITIAL_CORNERS),
    [editCorners, setEditCorners] = useState(false),
    [calibrated, setCalibrated] = useState(false);
  const [trackingState, setTrackingState] = useState<
      "idle" | "loading" | "ready" | "error"
    >("idle"),
    [input, setInput] = useState<"keyboard" | "vision" | "midi">("keyboard"),
    [midiLabel, setMidiLabel] = useState("Not connected");
  const [soundReady, setSoundReady] = useState(false),
    [soundBusy, setSoundBusy] = useState(false),
    [audioState, setAudioState] = useState("suspended");
  const [active, setActive] = useState<Set<string>>(new Set()),
    [gameActions, setGameActions] = useState<Set<string>>(new Set()),
    [tip, setTip] = useState<Point | null>(null);
  const [augmented, setAugmented] = useState(true),
    [intensity, setIntensity] = useState(0.9),
    [inspector, setInspector] = useState(() => window.innerWidth > 800),
    [settings, setSettings] = useState(false),
    [help, setHelp] = useState(false);
  const [volume, setVolume] = useState(0.72),
    [octave, setOctave] = useState(0),
    [release, setRelease] = useState(0.45),
    [sustain, setSustain] = useState(false),
    [effect, setEffect] = useState(0.12),
    [preset, setPreset] = useState<"piano" | "felt" | "synth">("piano");
  const [bpm, setBpm] = useState(100),
    [metronome, setMetronome] = useState(false),
    [playing, setPlaying] = useState(false),
    [beat, setBeat] = useState(0),
    [level, setLevel] = useState(0);
  const [notice, setNotice] = useState(""),
    [revealing, setRevealing] = useState(false),
    [scanning, setScanning] = useState(false),
    [, setTick] = useState(0);
  const audio = useRef(new AudioEngine()),
    camera = useRef(new CameraController()),
    tracker = useRef(new HandTracker()),
    midi = useRef(new MidiController());
  const owners = useRef(new Map<string, Set<string>>()),
    visionActive = useRef<string | null>(null),
    visionArmed = useRef(false),
    lastTipAt = useRef(0);
  const stageContainer = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    loopTimers = useRef<ReturnType<typeof setTimeout>[]>([]),
    undoBase = useRef<PaperLayout | null>(null);
  const readyPromise = useRef<Promise<boolean> | null>(null),
    revealingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef({
    stage,
    mode,
    layout,
    octave,
    soundReady,
    input,
    calibrated,
    corners,
  });
  current.current = {
    stage,
    mode,
    layout,
    octave,
    soundReady,
    input,
    calibrated,
    corners,
  };
  const modeInfo = MODES.find((m) => m.id === mode)!;
  const overlaps = useMemo(
    () => controlsOverlap(layout.controls),
    [layout.controls],
  );
  const selectedControl = layout.controls.find((c) => c.id === selected);
  const diagnostics = tracker.current.diagnostics;
  const notify = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(t);
  }, [notice]);
  const stopAll = useCallback(() => {
    loopTimers.current.forEach(clearTimeout);
    loopTimers.current = [];
    setPlaying(false);
    setMetronome(false);
    audio.current.stopAll();
    audio.current.setSustain(false);
    setSustain(false);
    owners.current.clear();
    visionActive.current = null;
    visionArmed.current = false;
    setActive(new Set());
    setGameActions(new Set());
  }, []);
  const send = useCallback(
    (
      id: string,
      phase: "down" | "up",
      source: ControlEvent["source"] = "pointer",
      ownerSuffix = "",
    ) => {
      const state = current.current;
      if (state.stage !== "studio" || !state.soundReady) return;
      const index = state.layout.controls.findIndex((c) => c.id === id);
      if (index < 0) return;
      const owner = `${source}${ownerSuffix}`;
      const held = owners.current.get(id) || new Set<string>();
      if (phase === "down" && held.has(owner)) return;
      if (phase === "up" && !held.has(owner)) return;
      const control = mappedControl(
        state.layout.controls[index],
        state.mode,
        index,
      );
      // Audio dispatch happens before any React render or visual state update.
      audio.current.trigger(
        {
          controlId: ownerSuffix ? `${id}:${ownerSuffix}` : id,
          phase,
          value: 1,
          source,
          timestampMs: performance.now(),
        },
        control,
        state.mode,
        state.octave,
      );
      if (phase === "down") held.add(owner);
      else held.delete(owner);
      if (held.size) owners.current.set(id, held);
      else owners.current.delete(id);
      setActive(new Set(owners.current.keys()));
      if (state.mode === "game") {
        const actions = new Set<string>();
        for (const key of owners.current.keys()) {
          const i = state.layout.controls.findIndex((c) => c.id === key);
          actions.add(["left", "jump", "right", "reset"][i % 4]);
        }
        setGameActions(actions);
      }
    },
    [],
  );
  const prepareAudio = useCallback(async () => {
    if (readyPromise.current) return readyPromise.current;
    setSoundBusy(true);
    readyPromise.current = (async () => {
      try {
        await audio.current.ready();
        setSoundReady(true);
        setAudioState("running");
        const assets = audio.current.getDiagnostics();
        if (assets.assetError)
          notify(`${assets.preset}. ${assets.assetError}.`);
        return true;
      } catch (e) {
        notify(e instanceof Error ? e.message : "Click to enable sound.");
        return false;
      } finally {
        setSoundBusy(false);
        readyPromise.current = null;
      }
    })();
    return readyPromise.current;
  }, [notify]);
  useEffect(() => {
    audio.current.setVolume(volume);
  }, [volume]);
  useEffect(() => {
    audio.current.setRelease(release);
  }, [release]);
  useEffect(() => {
    audio.current.setSustain(sustain);
  }, [sustain]);
  useEffect(() => {
    audio.current.setEffect(effect);
  }, [effect]);
  useEffect(() => {
    audio.current.setPreset(preset);
  }, [preset]);
  useEffect(() => {
    camera.current
      .listDevices()
      .then(setDevices)
      .catch(() => {});
    const list = () =>
      camera.current
        .listDevices()
        .then(setDevices)
        .catch(() => {});
    navigator.mediaDevices?.addEventListener("devicechange", list);
    const onBlur = () => stopAll(),
      onHidden = () => {
        if (document.hidden) stopAll();
      };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHidden);
    const meter = setInterval(() => {
      const d = audio.current.getDiagnostics();
      setLevel(d.level);
      setAudioState(d.state);
      setTick((n) => n + 1);
    }, 100);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", list);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHidden);
      clearInterval(meter);
      stopAll();
      camera.current.stop();
      tracker.current.stop();
      midi.current.disconnect();
    };
  }, [stopAll]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (document.querySelector("[role=dialog]")) {
        if (e.key === "Escape") {
          stopAll();
          setSettings(false);
          setHelp(false);
        }
        return;
      }
      if (
        e.target instanceof HTMLElement &&
        (e.target.matches("input,textarea,select") ||
          e.target.isContentEditable)
      )
        return;
      if (e.key === "Escape") {
        stopAll();
        setSettings(false);
        setHelp(false);
        return;
      }
      const i = KEY_BINDINGS.indexOf(e.key.toLowerCase());
      if (i >= 0 && !e.repeat && current.current.stage === "studio") {
        e.preventDefault();
        const c = current.current.layout.controls[i];
        if (c) send(c.id, "down", "keyboard");
      }
    };
    const up = (e: KeyboardEvent) => {
      const i = KEY_BINDINGS.indexOf(e.key.toLowerCase());
      if (i >= 0) {
        const c = current.current.layout.controls[i];
        if (c) send(c.id, "up", "keyboard");
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [send, stopAll]);
  const onHand = useCallback(
    (frame: HandFrame) => {
      const s = current.current;
      if (performance.now() - lastTipAt.current > 65 || !frame.tip) {
        setTip(frame.tip);
        lastTipAt.current = performance.now();
      }
      if (
        s.stage !== "studio" ||
        s.input !== "vision" ||
        !s.calibrated ||
        !frame.tip
      ) {
        if (visionActive.current) send(visionActive.current, "up", "vision");
        audio.current.releaseSource("vision");
        visionActive.current = null;
        visionArmed.current = false;
        return;
      }
      if (frame.pinch > 0.5) {
        if (visionActive.current) send(visionActive.current, "up", "vision");
        visionActive.current = null;
        visionArmed.current = true;
        return;
      }
      if (frame.pinch < 0.35 && visionArmed.current && !visionActive.current) {
        visionArmed.current = false;
        try {
          const inverse = computeHomography(s.corners, UNIT);
          const paper = transformPoint(inverse, frame.tip);
          const c = s.layout.controls.find((c) =>
            pointInPolygon(paper, c.polygon),
          );
          if (c) {
            send(c.id, "down", "vision");
            visionActive.current = c.id;
          }
        } catch {}
      }
    },
    [send],
  );
  useEffect(() => {
    if (
      !video ||
      !stream ||
      trackingState !== "ready" ||
      stage !== "studio" ||
      input !== "vision"
    ) {
      tracker.current.stop();
      setTip(null);
      return;
    }
    try {
      tracker.current.start(video, onHand);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Tracking unavailable.");
    }
    return () => tracker.current.stop();
  }, [video, stream, trackingState, stage, input, onHand, notify]);
  useEffect(() => {
    if (!stream) return;
    const ended = () => {
      stopAll();
      setStream(null);
      setCameraError("Reconnect your camera, then recalibrate your paper.");
      setCalibrated(false);
      setInput("keyboard");
    };
    stream.getVideoTracks().forEach((t) => t.addEventListener("ended", ended));
    return () =>
      stream
        .getVideoTracks()
        .forEach((t) => t.removeEventListener("ended", ended));
  }, [stream, stopAll]);
  useEffect(() => {
    if (!metronome || !soundReady) return;
    let next = performance.now(),
      n = 0;
    const timer = setInterval(() => {
      if (performance.now() >= next) {
        audio.current.click(n % 4 === 0);
        setBeat(n % 4);
        n++;
        next += 60000 / bpm;
        if (next < performance.now() - 100)
          next = performance.now() + 60000 / bpm;
      }
    }, 12);
    return () => clearInterval(timer);
  }, [metronome, bpm, soundReady]);
  const startCamera = async (id = deviceId) => {
    stopAll();
    setCameraBusy(true);
    setCameraError("");
    setCalibrated(false);
    setSnapshot(null);
    void prepareAudio();
    try {
      const next = await camera.current.start(id || undefined);
      setStream(next);
      setDevices(await camera.current.listDevices());
      setDeviceId(next.getVideoTracks()[0].getSettings().deviceId || id);
      setTrackingState("loading");
      tracker.current
        .init()
        .then(() => setTrackingState("ready"))
        .catch((e) => {
          setTrackingState("error");
          notify(e.message);
        });
    } catch (e) {
      setStream(null);
      setCameraError(
        e instanceof Error ? e.message : "Camera could not start.",
      );
    } finally {
      setCameraBusy(false);
    }
  };
  const demo = async (savedLayout?: PaperLayout) => {
    if (!(await prepareAudio())) return;
    stopAll();
    camera.current.stop();
    setStream(null);
    setSnapshot(null);
    setCalibrated(false);
    setInput("keyboard");
    if (savedLayout) setLayout(savedLayout);
    setStage("studio");
    setAugmented(true);
    notify("Demo layout ready. Play with A–K or click a key.");
  };
  const capture = () => {
    stopAll();
    if (!video || video.readyState < 2) {
      notify("Wait for the camera frame, then try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    setSnapshot(canvas.toDataURL("image/jpeg", 0.93));
    setStage("scan");
    setEditCorners(true);
    setAugmented(true);
    setSelected(null);
  };
  const scan = async () => {
    if (!validateCorners(corners)) {
      notify("Place the four corners clockwise around a flat, visible sheet.");
      return;
    }
    if (!snapshot) {
      setEditCorners(false);
      return;
    }
    setScanning(true);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = snapshot;
      });
      const source = document.createElement("canvas");
      source.width = image.naturalWidth;
      source.height = image.naturalHeight;
      source.getContext("2d")!.drawImage(image, 0, 0);
      const rectified = rectifyImage(source, corners);
      const found = recognizeControls(
        rectified
          .getContext("2d")!
          .getImageData(0, 0, rectified.width, rectified.height),
      );
      setHistory((h) => [...h, layout]);
      if (found.length) {
        setLayout((l) => ({ ...l, controls: found }));
        setSelected(found[0].id);
        notify(
          `Found ${found.length} controls. Adjust the outlines before playing.`,
        );
      } else {
        setLayout((l) => ({ ...l, controls: [] }));
        notify(
          "No supported outlines found. Add controls or use the eight-key template.",
        );
      }
      setEditCorners(false);
      setCalibrated(true);
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message
          : "Could not scan this frame. Adjust corners and retry.",
      );
    } finally {
      setScanning(false);
    }
  };
  const bringToLife = async () => {
    if (stream && !calibrated) {
      capture();
      notify("Calibrate the paper before starting camera input.");
      return;
    }
    if (!layout.controls.length) {
      notify("Add at least one control to your paper.");
      return;
    }
    if (layout.controls.some((c) => !validateControlPolygon(c.polygon))) {
      notify("Fix crossed or collapsed control corners before playing.");
      return;
    }
    if (overlaps.length) {
      notify("Separate the highlighted controls before playing.");
      return;
    }
    if (stream && !validateCorners(corners)) {
      notify("Adjust the four paper corners before playing.");
      return;
    }
    if (!(await prepareAudio())) return;
    try {
      saveLayout(layout);
      setSaved(layout);
    } catch {
      notify("Browser storage is unavailable. Export your layout to keep it.");
    }
    stopAll();
    setCalibrated(!!stream);
    setInput(stream && trackingState === "ready" ? "vision" : "keyboard");
    setStage("studio");
    setSnapshot(null);
    setSelected(null);
    setAugmented(true);
    setRevealing(true);
    if (revealingTimer.current) clearTimeout(revealingTimer.current);
    revealingTimer.current = setTimeout(() => setRevealing(false), 1000);
  };
  const editLayout = () => {
    stopAll();
    setSelected(null);
    if (stream) {
      capture();
      setEditCorners(false);
    } else {
      setStage("scan");
      setEditCorners(false);
      setSnapshot(null);
    }
  };
  const changeMode = (m: Mode) => {
    stopAll();
    setMode(m);
  };
  const updateLayout = (next: PaperLayout) => {
    setHistory((h) => [...h.slice(-29), layout]);
    setLayout(next);
  };
  const changeControl = (id: string, polygon: Point[], commit: boolean) => {
    if (!undoBase.current) undoBase.current = layout;
    setLayout((l) => ({
      ...l,
      controls: l.controls.map((c) => (c.id === id ? { ...c, polygon } : c)),
    }));
    if (commit && undoBase.current) {
      const base = undoBase.current;
      setHistory((h) => [...h.slice(-29), base]);
      undoBase.current = null;
    }
  };
  const addControl = (kind: PaperControl["kind"]) => {
    if (layout.controls.length >= 32) {
      notify("This layout supports up to 32 controls.");
      return;
    }
    const id = `${kind}-${Date.now()}`;
    const x = 0.1 + Math.random() * 0.05,
      y = 0.07;
    updateLayout({
      ...layout,
      controls: [
        ...layout.controls,
        {
          id,
          kind,
          name: kind === "key" ? "C4" : kind === "pad" ? "New pad" : "Level",
          polygon: [
            [x, y],
            [x + 0.15, y],
            [x + 0.15, y + (kind === "key" ? 0.6 : 0.15)],
            [x, y + (kind === "key" ? 0.6 : 0.15)],
          ],
          action: { type: "note", midi: 60 },
        },
      ],
    });
    setSelected(id);
  };
  const updateSelected = (patch: Partial<PaperControl>) => {
    if (!selected) return;
    updateLayout({
      ...layout,
      controls: layout.controls.map((c) =>
        c.id === selected ? { ...c, ...patch } : c,
      ),
    });
  };
  const testSound = async () => {
    if (await prepareAudio()) {
      const c = createDefaultLayout().controls[0];
      audio.current.trigger(
        {
          controlId: "test",
          phase: "down",
          source: "pointer",
          value: 1,
          timestampMs: performance.now(),
        },
        c,
        "piano",
        octave,
      );
      setTimeout(
        () =>
          audio.current.trigger(
            {
              controlId: "test",
              phase: "up",
              source: "pointer",
              value: 0,
              timestampMs: performance.now(),
            },
            c,
            "piano",
            octave,
          ),
        550,
      );
    }
  };
  const testControl = async () => {
    if (!selectedControl || !(await prepareAudio())) return;
    const c = mappedControl(
      selectedControl,
      mode,
      layout.controls.indexOf(selectedControl),
    );
    audio.current.trigger(
      {
        controlId: "test",
        phase: "down",
        source: "pointer",
        value: 1,
        timestampMs: performance.now(),
      },
      c,
      mode,
      octave,
    );
    setTimeout(
      () =>
        audio.current.trigger(
          {
            controlId: "test",
            phase: "up",
            source: "pointer",
            value: 0,
            timestampMs: performance.now(),
          },
          c,
          mode,
          octave,
        ),
      400,
    );
  };
  const playExample = async () => {
    if (playing) {
      stopAll();
      return;
    }
    if (!(await prepareAudio())) return;
    stopAll();
    setPlaying(true);
    const sequence =
      mode === "piano"
        ? [0, 2, 4, 7, 6, 4, 2, 1, 0, 2, 4, 5, 4, 2, 1, 0]
        : [0, 1, 2, 3, 0, 2, 1, 3];
    const duration = 60000 / bpm / 2;
    sequence.forEach((key, i) => {
      const c = layout.controls[key % layout.controls.length];
      if (!c) return;
      loopTimers.current.push(
        setTimeout(() => send(c.id, "down", "loop"), i * duration),
      );
      loopTimers.current.push(
        setTimeout(
          () => send(c.id, "up", "loop"),
          i * duration + duration * 0.78,
        ),
      );
    });
    loopTimers.current.push(
      setTimeout(() => {
        setPlaying(false);
      }, sequence.length * duration),
    );
  };
  const exportLayout = () => {
    const blob = new Blob([JSON.stringify(layout, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${layout.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "paperpilot"}-layout.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importLayout = async (file: File) => {
    try {
      if (file.size > 200000) throw new Error("Layout file is too large.");
      const next = JSON.parse(await file.text());
      if (!isLayout(next))
        throw new Error("Choose a valid PaperPilot layout JSON file.");
      stopAll();
      updateLayout(next);
      setStage("scan");
      setEditCorners(false);
      setSelected(null);
      notify("Layout opened. Check the controls before playing.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not open layout.");
    }
  };
  const connectMidi = async () => {
    if (!(await prepareAudio())) return;
    try {
      await midi.current.connect(
        (note, phase, _velocity, owner) => {
          const s = current.current;
          const c = s.layout.controls.find(
            (c) => c.action.type === "note" && c.action.midi === note,
          );
          if (c) send(c.id, phase, "midi", owner);
        },
        (connected, label) => {
          setMidiLabel(label);
          if (!connected) {
            audio.current.releaseSource("midi");
            for (const [id, set] of owners.current) {
              for (const key of set) {
                if (key.startsWith("midi")) set.delete(key);
              }
              if (!set.size) owners.current.delete(id);
            }
            setActive(new Set(owners.current.keys()));
            setGameActions(new Set());
          }
        },
      );
      stopAll();
      setInput("midi");
      notify("MIDI input selected. Map controller notes to your paper keys.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "MIDI could not connect.");
    }
  };
  const fullscreen = () => {
    const el = stageContainer.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void el
        .requestFullscreen()
        .catch(() => notify("Fullscreen is unavailable in this browser."));
  };
  const resetSession = () => {
    stopAll();
    tracker.current.stop();
    midi.current.disconnect();
    camera.current.stop();
    setStream(null);
    setSnapshot(null);
    setCalibrated(false);
    setCameraError("");
    setStage("setup");
    setInput("keyboard");
    setSettings(false);
  };
  const cameraSettings = camera.current.getSettings();
  const status =
    stage === "setup"
      ? stream
        ? "Camera connected"
        : "Let’s make something"
      : stage === "scan"
        ? editCorners
          ? "Adjust paper corners"
          : overlaps.length
            ? "Separate overlapping controls"
            : "Review your controls"
        : audioState !== "running"
          ? "Click to enable sound"
          : input === "vision"
            ? diagnostics.handVisible
              ? "Pinch input ready"
              : "Show one hand to the camera"
            : input === "midi"
              ? midiLabel === "Not connected"
                ? "Connect MIDI controller"
                : midiLabel
              : "Keyboard ready";
  const goodStatus =
    stage === "studio" &&
    audioState === "running" &&
    (input === "keyboard" ||
      (input === "vision" && diagnostics.handVisible) ||
      (input === "midi" && midiLabel !== "Not connected"));
  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          aria-label="PaperPilot home"
          onClick={() => {
            stopAll();
            setStage("setup");
          }}
        >
          <span className="brand-mark">
            <svg viewBox="0 0 28 28">
              <path d="M6 4h11l6 6v14H6zM17 4v7h6M10 15h9M10 19h6" />
            </svg>
          </span>
          <span>
            Paper<span className="brand-light">Pilot</span>
          </span>
          <span className="beta">STUDIO</span>
        </button>
        <nav className="workflow" aria-label="Workflow">
          <button
            className={stage === "setup" ? "current" : ""}
            onClick={() => {
              stopAll();
              setStage("setup");
            }}
          >
            <span>{stage === "setup" ? "01" : <Check size={12} />}</span>Setup
          </button>
          <ChevronRight size={12} />
          <button
            className={stage === "scan" ? "current" : ""}
            onClick={editLayout}
          >
            <span>02</span>Scan & map
          </button>
          <ChevronRight size={12} />
          <button
            className={stage === "studio" ? "current" : ""}
            onClick={() => void bringToLife()}
          >
            <span>03</span>Studio
          </button>
        </nav>
        <div className="top-right">
          <span className="local-label">
            <span />
            All local. All yours.
          </span>
          <IconButton label="Help and shortcuts" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
          </IconButton>
          <IconButton
            label="Session settings"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={18} />
          </IconButton>
        </div>
      </header>
      <div className="app-body">
        <aside className="app-rail">
          <div className="rail-label">CREATE</div>
          {MODES.map((m) => (
            <button
              key={m.id}
              className={`rail-item ${mode === m.id ? "selected" : ""}`}
              aria-label={`${m.name} mode`}
              aria-pressed={mode === m.id}
              onClick={() => changeMode(m.id)}
            >
              <m.icon size={22} strokeWidth={1.5} />
              <span>{m.name}</span>
            </button>
          ))}
          <div className="rail-bottom">
            <IconButton
              label="Open layout file"
              onClick={() => fileInput.current?.click()}
            >
              <FolderOpen size={20} />
            </IconButton>
            <IconButton label="Diagnostics" onClick={() => setSettings(true)}>
              <Activity size={19} />
            </IconButton>
            <div className="rail-version">v0.1</div>
          </div>
        </aside>
        <main className="workspace" ref={stageContainer}>
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">
                {stage === "setup"
                  ? "FROM PAPER TO POSSIBILITY"
                  : stage === "scan"
                    ? "MAKE IT YOURS"
                    : "YOUR CREATIVE SPACE"}
                <span className="eyebrow-line" />
              </div>
              <h1>
                {stage === "setup"
                  ? "An instrument, in your own hands"
                  : stage === "scan"
                    ? "A sketch. A few adjustments. Magic"
                    : layout.name}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {stage === "setup"
                  ? "Draw it. Scan it. Bring it to life."
                  : stage === "scan"
                    ? "Every line is yours. Let’s make sure every note is, too."
                    : modeInfo.description}
              </p>
            </div>
            <div className="workspace-actions">
              {stage === "studio" && (
                <button className="button subtle" onClick={editLayout}>
                  <ScanLine size={15} />
                  Edit layout
                </button>
              )}
              <IconButton
                label={inspector ? "Hide inspector" : "Show inspector"}
                onClick={() => setInspector(!inspector)}
              >
                {inspector ? (
                  <PanelRightClose size={19} />
                ) : (
                  <PanelRightOpen size={19} />
                )}
              </IconButton>
            </div>
          </div>
          <div className="stage-toolbar">
            <button
              onClick={() => {
                if (stage === "studio" && audioState !== "running")
                  void prepareAudio();
              }}
              className={`status-label ${goodStatus ? "is-ready" : ""}`}
            >
              <span />
              {status}
            </button>
            <div className="segmented">
              <button
                className={!augmented ? "selected" : ""}
                onClick={() => setAugmented(false)}
              >
                <Camera size={14} />
                {stream ? "Camera" : "Paper"}
              </button>
              <button
                className={augmented ? "selected" : ""}
                onClick={() => setAugmented(true)}
              >
                <Sparkles size={14} />
                Augmented
              </button>
            </div>
          </div>
          {stage === "scan" && !editCorners && (
            <div className="editor-toolbar">
              <span>
                <SquareMousePointer size={15} />
                Select & drag
              </span>
              <div className="tool-separator" />
              <button onClick={() => addControl("key")}>
                <Plus size={14} />
                Key
              </button>
              <button onClick={() => addControl("pad")}>
                <Plus size={14} />
                Pad
              </button>
              <button
                disabled={!selected}
                onClick={() => {
                  updateLayout({
                    ...layout,
                    controls: layout.controls.filter((c) => c.id !== selected),
                  });
                  setSelected(null);
                }}
                aria-label="Delete selected control"
              >
                <Trash2 size={15} />
              </button>
              <button
                disabled={!history.length}
                onClick={() => {
                  setLayout(history[history.length - 1]);
                  setHistory((h) => h.slice(0, -1));
                }}
                aria-label="Undo layout change"
              >
                <Undo2 size={15} />
              </button>
              {stream && (
                <button
                  onClick={() => {
                    capture();
                  }}
                  aria-label="Rescan and recalibrate"
                >
                  <ScanLine size={14} />
                </button>
              )}
              <button
                className="template-button"
                onClick={() => {
                  updateLayout({
                    ...layout,
                    controls: createDefaultLayout().controls,
                  });
                  setSelected(null);
                }}
              >
                <Piano size={14} />
                8-key template
              </button>
            </div>
          )}
          <div className="stage-content">
            <PaperStage
              layout={layout}
              mode={stage === "scan" ? "piano" : mode}
              stage={stage}
              stream={stream}
              snapshot={snapshot}
              corners={corners}
              setCorners={setCorners}
              active={active}
              augmented={augmented}
              intensity={intensity}
              selected={selected}
              setSelected={setSelected}
              editCorners={editCorners}
              onChangeControl={changeControl}
              onPress={(id) => send(id, "down")}
              onRelease={(id) => send(id, "up")}
              onVideo={setVideo}
              tip={input === "vision" ? tip : null}
              revealing={revealing}
              octave={octave}
              fullscreen={fullscreen}
              cameraReady={!!stream}
            />
            {stage === "studio" && mode === "game" && (
              <MiniGame actions={gameActions} onReset={stopAll} />
            )}
          </div>
          {stage === "setup" ? (
            <div className="setup-callout">
              <div className="callout-icon">
                <Camera size={23} strokeWidth={1.5} />
              </div>
              <div className="callout-copy">
                <h3>
                  {stream
                    ? "Your camera is ready. So is your canvas."
                    : "Your next instrument starts with a sketch."}
                </h3>
                <p>
                  {stream
                    ? "Lay your paper flat and lift your hands for a clean scan."
                    : "Connect a camera and place your drawing in view. We’ll take it from there."}
                </p>
              </div>
              <button
                className="button primary"
                disabled={cameraBusy}
                onClick={() => (stream ? capture() : void startCamera())}
              >
                {cameraBusy ? (
                  <LoaderCircle className="spinning" size={16} />
                ) : stream ? (
                  <ScanLine size={16} />
                ) : (
                  <Camera size={16} />
                )}{" "}
                {cameraBusy
                  ? "Starting camera"
                  : stream
                    ? "Scan paper"
                    : "Start camera"}
                <ArrowRight size={16} />
              </button>
            </div>
          ) : stage === "scan" ? (
            <div className="setup-callout scan-callout">
              <div className="callout-icon">
                <ScanLine size={22} />
              </div>
              <div className="callout-copy">
                <h3>
                  {editCorners
                    ? "Give your page four corners."
                    : `${layout.controls.length} controls. Ready for their first notes.`}
                </h3>
                <p>
                  {editCorners
                    ? "Drag 1–4 clockwise: top left, top right, bottom right, bottom left."
                    : overlaps.length
                      ? "Controls overlap. Move or resize them to separate their playing areas."
                      : "Select a control to change its note. Drag its corners to fit your sketch."}
                </p>
              </div>
              {editCorners ? (
                <button
                  className="button primary"
                  onClick={() => void scan()}
                  disabled={scanning}
                >
                  {scanning ? (
                    <LoaderCircle className="spinning" size={16} />
                  ) : (
                    <ScanLine size={16} />
                  )}{" "}
                  {scanning ? "Reading outlines" : "Detect controls"}
                </button>
              ) : (
                <button
                  className="button primary"
                  onClick={() => void bringToLife()}
                  disabled={!layout.controls.length || !!overlaps.length}
                >
                  <Sparkles size={16} />
                  Bring it to life
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
          ) : (
            <div className="playing-hint">
              <div>
                <Keyboard size={17} />
                <span>Make a little music.</span>
                <div className="keycaps">
                  {KEY_BINDINGS.slice(
                    0,
                    Math.min(8, layout.controls.length),
                  ).map((k, i) => (
                    <kbd
                      key={k}
                      className={
                        active.has(layout.controls[i]?.id) ? "pressed" : ""
                      }
                    >
                      {k.toUpperCase()}
                    </kbd>
                  ))}
                </div>
                <span className="muted">or click a key</span>
              </div>
              {mode !== "game" && (
                <button onClick={() => void playExample()}>
                  <Play size={13} />
                  {playing ? "Stop example" : "Hear an example"}
                </button>
              )}
            </div>
          )}
          {soundReady && audio.current.getDiagnostics().assetError && (
            <div className="inline-error" role="alert">
              {audio.current.getDiagnostics().preset} ·{" "}
              {audio.current.getDiagnostics().assetError}
            </div>
          )}
          {cameraError && (
            <div className="inline-error" role="alert">
              <Camera size={15} />
              {cameraError}
              <button onClick={() => void startCamera()}>Retry</button>
            </div>
          )}
          {stage === "setup" && (
            <div className="under-stage">
              <button onClick={() => void demo()}>
                <Play size={12} />
                Just exploring? Try the demo layout
                <ArrowRight size={13} />
              </button>
              <span>
                <Headphones size={13} />
                Best with wired audio
              </span>
            </div>
          )}
        </main>
        {inspector && (
          <aside className="inspector">
            <div className="inspector-title">
              <span>
                {stage === "scan" && selectedControl
                  ? "CONTROL DETAILS"
                  : "THE FINER THINGS"}
              </span>
              <SlidersHorizontal size={15} />
            </div>
            {stage === "scan" && selectedControl ? (
              <>
                <div className="inspector-section">
                  <div className="section-heading">
                    <h2>{selectedControl.name}</h2>
                    <span className="small-tag">{selectedControl.kind}</span>
                  </div>
                  <label className="field-label">
                    Name
                    <input
                      value={selectedControl.name}
                      onChange={(e) => updateSelected({ name: e.target.value })}
                    />
                  </label>
                  <label className="field-label">
                    Assigned note
                    <select
                      value={
                        selectedControl.action.type === "note"
                          ? selectedControl.action.midi
                          : 60
                      }
                      onChange={(e) =>
                        updateSelected({
                          action: { type: "note", midi: +e.target.value },
                        })
                      }
                    >
                      {Array.from({ length: 37 }, (_, i) => i + 48).map((n) => (
                        <option value={n} key={n}>
                          {noteName(n)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Control type
                    <select
                      value={selectedControl.kind}
                      onChange={(e) =>
                        updateSelected({
                          kind: e.target.value as PaperControl["kind"],
                        })
                      }
                    >
                      <option value="key">Piano key</option>
                      <option value="pad">Pad</option>
                    </select>
                  </label>
                  <button
                    className="button full-width"
                    onClick={() => void testControl()}
                  >
                    <Volume2 size={15} />
                    Test control
                  </button>
                  <button
                    className="button subtle full-width"
                    onClick={() => {
                      const id = `copy-${Date.now()}`;
                      updateLayout({
                        ...layout,
                        controls: [
                          ...layout.controls,
                          {
                            ...selectedControl,
                            id,
                            polygon: selectedControl.polygon.map(
                              (q) =>
                                [
                                  Math.min(0.99, q[0] + 0.03),
                                  Math.min(0.99, q[1] + 0.03),
                                ] as Point,
                            ),
                          },
                        ],
                      });
                      setSelected(id);
                    }}
                  >
                    <Copy size={14} />
                    Duplicate
                  </button>
                </div>
                {overlaps.includes(selectedControl.id) && (
                  <p className="inspector-warning">
                    This control overlaps another. Move or resize it before
                    playing.
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="inspector-section instrument-section">
                  <div className="section-heading">
                    <h2>Instrument</h2>
                    <span className="small-tag">
                      {mode === "piano"
                        ? "01 / 05"
                        : `${String(MODES.findIndex((m) => m.id === mode) + 1).padStart(2, "0")} / 05`}
                    </span>
                  </div>
                  <div className={`preset-art ${mode}`}>
                    <div className="art-orbit" />
                    <div className="art-keys">
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                    <span>
                      {mode === "piano"
                        ? "THE ORIGINAL COLLECTION"
                        : mode.toUpperCase() + " COLLECTION"}
                    </span>
                    <span className="art-number">
                      {String(
                        MODES.findIndex((m) => m.id === mode) + 1,
                      ).padStart(2, "0")}
                    </span>
                  </div>
                  <label className="preset-select">
                    <select
                      aria-label="Sound preset"
                      value={preset}
                      onChange={(e) =>
                        setPreset(e.target.value as typeof preset)
                      }
                    >
                      <option value="piano">Studio Grand</option>
                      <option value="felt">Soft Felt</option>
                      <option value="synth">Analog Light</option>
                    </select>
                    <ChevronDown size={15} />
                  </label>
                  <p className="preset-description">
                    {mode === "piano"
                      ? preset === "piano"
                        ? "Warm, detailed, and beautifully familiar."
                        : preset === "felt"
                          ? "A softer touch for quiet discoveries."
                          : "A warm waveform, made for wandering."
                      : mode === "chords"
                        ? "C · Am · F · G. Four chords, endless songs."
                        : mode === "drums"
                          ? "Kick, snare, hi-hat, and a little clap."
                          : mode === "soundboard"
                            ? "Four original sounds. A world of textures."
                            : "Jump, dodge, and make the page your own."}
                  </p>
                </div>
                <div className="inspector-section sound-section">
                  <div className="section-heading">
                    <h2>Sound</h2>
                    <Waves size={15} />
                  </div>
                  <div className="control-row">
                    <label htmlFor="octave">Octave</label>
                    <div className="stepper">
                      <button
                        aria-label="Lower octave"
                        disabled={octave <= -2}
                        onClick={() => {
                          stopAll();
                          setOctave((o) => o - 1);
                        }}
                      >
                        −
                      </button>
                      <output id="octave">
                        {octave > 0 ? "+" : ""}
                        {octave}
                      </output>
                      <button
                        aria-label="Higher octave"
                        disabled={octave >= 2}
                        onClick={() => {
                          stopAll();
                          setOctave((o) => o + 1);
                        }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <Range
                    label="Release"
                    value={release}
                    min={0.1}
                    max={1.5}
                    step={0.05}
                    onChange={setRelease}
                    display={`${release.toFixed(2)} s`}
                  />
                  <Range
                    label="Space"
                    value={effect}
                    onChange={setEffect}
                    display={`${Math.round(effect * 100)}%`}
                  />
                  <div className="control-row">
                    <label>Sustain</label>
                    <Toggle
                      label="Sustain pedal"
                      checked={sustain}
                      onChange={() => setSustain(!sustain)}
                    />
                  </div>
                </div>
              </>
            )}
            <div className="inspector-section">
              <div className="section-heading">
                <h2>Appearance</h2>
                <Sparkles size={14} />
              </div>
              <div className="skin-options">
                {(
                  [
                    { id: "obsidian-ivory", name: "Ivory" },
                    { id: "smoked-glass", name: "Glass" },
                    { id: "midnight-circuit", name: "Midnight" },
                  ] as { id: Skin; name: string }[]
                ).map((s) => (
                  <button
                    aria-label={`${s.name} skin`}
                    aria-pressed={layout.skin === s.id}
                    className={`skin-option ${s.id} ${layout.skin === s.id ? "selected" : ""}`}
                    key={s.id}
                    onClick={() => setLayout((l) => ({ ...l, skin: s.id }))}
                  >
                    <span className="skin-swatch">
                      <i />
                      <i />
                      <i />
                      {layout.skin === s.id && <Check size={11} />}
                    </span>
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
              <Range
                label="AR intensity"
                value={intensity}
                min={0.2}
                max={1}
                onChange={setIntensity}
                display={`${Math.round(intensity * 100)}%`}
              />
            </div>
            <div className="inspector-section session-section">
              <div className="section-heading">
                <h2>
                  {stage === "setup" ? "Let’s get connected" : "Input & layout"}
                </h2>
                <button
                  className="text-icon"
                  aria-label="Input settings"
                  onClick={() => setSettings(true)}
                >
                  <Settings2 size={14} />
                </button>
              </div>
              {stage === "setup" ? (
                <>
                  <label className="camera-select">
                    <Camera size={15} />
                    <select
                      aria-label="Camera"
                      value={deviceId}
                      onChange={(e) => {
                        setDeviceId(e.target.value);
                        if (stream) void startCamera(e.target.value);
                      }}
                    >
                      <option value="">Default camera</option>
                      {devices.map((d, i) => (
                        <option key={d.deviceId || i} value={d.deviceId}>
                          {d.label || `Camera ${i + 1}`}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} />
                  </label>
                  <div className="readiness">
                    <span>
                      <i className={stream ? "ready" : ""} />
                      Camera
                    </span>
                    <span>
                      <i
                        className={
                          trackingState === "ready"
                            ? "ready"
                            : trackingState === "loading"
                              ? "loading"
                              : ""
                        }
                      />
                      Tracking
                    </span>
                    <span>
                      <i
                        className={
                          soundReady ? "ready" : soundBusy ? "loading" : ""
                        }
                      />
                      Sounds
                    </span>
                  </div>
                  <button
                    className="button subtle full-width"
                    onClick={() => void testSound()}
                    disabled={soundBusy}
                  >
                    {soundBusy ? (
                      <LoaderCircle size={14} className="spinning" />
                    ) : (
                      <Volume2 size={14} />
                    )}
                    Test sound
                  </button>
                </>
              ) : (
                <>
                  <label className="field-label">
                    Playing with
                    <select
                      aria-label="Input source"
                      value={input}
                      onChange={(e) => {
                        stopAll();
                        setInput(e.target.value as typeof input);
                      }}
                    >
                      <option value="keyboard">Keyboard & mouse</option>
                      <option
                        value="vision"
                        disabled={
                          !stream || trackingState !== "ready" || !calibrated
                        }
                      >
                        Camera · pinch gesture
                      </option>
                      <option
                        value="midi"
                        disabled={midiLabel === "Not connected"}
                      >
                        MIDI controller
                      </option>
                    </select>
                  </label>
                  {input === "vision" && (
                    <p className="input-note">
                      Point at a key. Pinch to play; open to release. One hand,
                      one note.
                    </p>
                  )}
                  <button
                    className="button subtle full-width"
                    onClick={() => {
                      try {
                        if (!isLayout(layout) || overlaps.length) {
                          notify("Fix the layout geometry before saving.");
                          return;
                        }
                        saveLayout(layout);
                        setSaved(layout);
                        notify("Layout saved on this browser.");
                      } catch {
                        notify(
                          "Storage unavailable. Export the layout instead.",
                        );
                      }
                    }}
                  >
                    <Save size={14} />
                    Save layout
                  </button>
                </>
              )}
              {saved && stage === "setup" && (
                <button
                  className="saved-layout"
                  onClick={() => void demo(saved)}
                >
                  <FolderOpen size={14} />
                  <span>
                    Open saved layout<small>{saved.name}</small>
                  </span>
                  <ChevronRight size={14} />
                </button>
              )}
            </div>
            <div className="inspector-footer">
              <span className="privacy-mark">
                <Hand size={15} />
              </span>
              <p>
                Your camera stays here.
                <br />
                <strong>Nothing leaves your device.</strong>
              </p>
            </div>
          </aside>
        )}
      </div>
      <footer className="transport">
        <div className="transport-brand">
          <span className="transport-light" />
          <span>
            {stage === "studio" ? "STUDIO SESSION" : "A NEW POSSIBILITY"}
            <small>{layout.name}</small>
          </span>
        </div>
        <div className="transport-main">
          <button
            className={`play-button ${playing ? "playing" : ""}`}
            aria-label={playing ? "Stop example" : "Play example melody"}
            disabled={stage !== "studio" || mode === "game"}
            onClick={() => void playExample()}
          >
            {playing ? (
              <Square size={16} fill="currentColor" />
            ) : (
              <Play size={17} fill="currentColor" />
            )}
          </button>
          <div className="transport-divider" />
          <label className="bpm-control">
            <input
              aria-label="Tempo"
              type="number"
              min={40}
              max={240}
              value={bpm}
              onChange={(e) =>
                setBpm(Math.max(40, Math.min(240, +e.target.value || 100)))
              }
            />
            <span>BPM</span>
          </label>
          <button
            className={`metronome-button ${metronome ? "active" : ""}`}
            aria-label="Toggle metronome"
            aria-pressed={metronome}
            disabled={!soundReady}
            onClick={() => setMetronome(!metronome)}
          >
            <svg width="20" height="23" viewBox="0 0 20 23">
              <path
                d="M7 3h6l5 18H2zM10 16l5-12M7 18h6"
                stroke="currentColor"
                fill="none"
                strokeWidth="1.5"
              />
            </svg>
          </button>
          <div className="beat-dots">
            {[0, 1, 2, 3].map((n) => (
              <i key={n} className={metronome && beat === n ? "on" : ""} />
            ))}
          </div>
          <div className="transport-divider" />
          <span className="transport-instrument">
            <Piano size={17} />
            {mode === "piano"
              ? preset === "piano"
                ? "Studio Grand"
                : preset === "felt"
                  ? "Soft Felt"
                  : "Analog Light"
              : modeInfo.name}
          </span>
        </div>
        <div className="transport-output">
          <Volume2 size={17} />
          <input
            aria-label="Master volume"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={volume}
            onChange={(e) => setVolume(+e.target.value)}
          />
          <div
            className="level-meter"
            aria-label={`Audio level ${Math.round(level * 100)} percent`}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <i key={i} className={level * 36 > i ? "lit" : ""} />
            ))}
          </div>
          <button className="stop-all" onClick={stopAll}>
            <Square size={12} />
            Stop all
          </button>
        </div>
      </footer>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importLayout(f);
          e.target.value = "";
        }}
      />
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {revealing && (
        <button className="skip-reveal" onClick={() => setRevealing(false)}>
          Skip reveal
          <ArrowRight size={13} />
        </button>
      )}
      {(settings || help) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setSettings(false);
            setHelp(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={help ? "A quick field guide" : "Session settings"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <div className="eyebrow">PAPERPILOT STUDIO</div>
                <h2>
                  {help ? "A quick field guide." : "Make yourself at home."}
                </h2>
              </div>
              <IconButton
                label="Close dialog"
                onClick={() => {
                  setSettings(false);
                  setHelp(false);
                }}
              >
                <X size={20} />
              </IconButton>
            </div>
            {help ? (
              <>
                <div className="guide-step">
                  <span>01</span>
                  <div>
                    <h3>A pen. A page. Your imagination.</h3>
                    <p>
                      Draw eight separate rectangles with a thick black marker.
                      Leave small gaps between keys. Tape the page flat under an
                      overhead camera.
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span>02</span>
                  <div>
                    <h3>Find the shape of your sound.</h3>
                    <p>
                      Start the camera, scan the paper, and drag the four
                      corners into place. Review detected controls, or add and
                      resize them by hand.
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span>03</span>
                  <div>
                    <h3>Bring a little possibility to life.</h3>
                    <p>
                      In camera mode, point your index finger at a key and pinch
                      your thumb to play. Open your hand to rearm. This is
                      gesture input, not physical touch detection.
                    </p>
                  </div>
                </div>
                <div className="shortcut-guide">
                  <Keyboard size={18} />
                  <div>
                    <strong>A S D F G H J K</strong>
                    <p>Play the first eight controls · Esc stops all sounds.</p>
                  </div>
                </div>
                <p className="modal-note">
                  For the clearest view, use bright diffuse light and an
                  overhead camera. Live AR uses a translucent outline so your
                  hands stay visible. Tape the page in place; recalibrate after
                  moving it.
                </p>
              </>
            ) : (
              <>
                <div className="settings-grid">
                  <label className="field-label">
                    Layout name
                    <input
                      value={layout.name}
                      maxLength={80}
                      onChange={(e) =>
                        setLayout((l) => ({ ...l, name: e.target.value }))
                      }
                    />
                  </label>
                  <label className="field-label">
                    Camera
                    <select
                      value={deviceId}
                      onChange={(e) => setDeviceId(e.target.value)}
                    >
                      <option value="">Default camera</option>
                      {devices.map((d, i) => (
                        <option key={d.deviceId || i} value={d.deviceId}>
                          {d.label || `Camera ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="modal-buttons">
                  <button
                    className="button"
                    onClick={() => void startCamera()}
                    disabled={cameraBusy}
                  >
                    <Camera size={15} />
                    {stream ? "Reconnect camera" : "Connect camera"}
                  </button>
                  <button className="button" onClick={() => void connectMidi()}>
                    <Piano size={15} />
                    Connect MIDI
                  </button>
                  <button className="button" onClick={exportLayout}>
                    <ArrowDownToLine size={15} />
                    Export layout
                  </button>
                  <button
                    className="button"
                    onClick={() => fileInput.current?.click()}
                  >
                    <FolderOpen size={15} />
                    Import layout
                  </button>
                </div>
                <details className="diagnostics">
                  <summary>
                    <Activity size={15} /> Under the hood{" "}
                    <ChevronDown size={14} />
                  </summary>
                  <dl>
                    <div>
                      <dt>Camera settings</dt>
                      <dd>
                        {stream
                          ? `${cameraSettings.width} × ${cameraSettings.height} · ${cameraSettings.frameRate?.toFixed(0) || "—"} fps`
                          : "Not connected"}
                      </dd>
                    </div>
                    <div>
                      <dt>Fresh camera / inference FPS</dt>
                      <dd>
                        {diagnostics.cameraFps.toFixed(1)} /{" "}
                        {diagnostics.fps.toFixed(1)}
                      </dd>
                    </div>
                    <div>
                      <dt>Latest inference</dt>
                      <dd>{diagnostics.inferenceMs.toFixed(1)} ms</dd>
                    </div>
                    <div>
                      <dt>Tracking / lost count</dt>
                      <dd>
                        {diagnostics.status} / {diagnostics.lostTrackingCount}
                      </dd>
                    </div>
                    <div>
                      <dt>Audio context / voices</dt>
                      <dd>
                        {audioState} / {audio.current.getDiagnostics().voices}
                      </dd>
                    </div>
                    <div>
                      <dt>Browser base / output latency</dt>
                      <dd>
                        {(
                          audio.current.getDiagnostics().baseLatency * 1000
                        ).toFixed(1)}{" "}
                        /{" "}
                        {(
                          audio.current.getDiagnostics().outputLatency * 1000
                        ).toFixed(1)}{" "}
                        ms
                      </dd>
                    </div>
                    <div>
                      <dt>Physical-to-sound latency</dt>
                      <dd>Not measured</dd>
                    </div>
                    <div>
                      <dt>MIDI</dt>
                      <dd>{midiLabel}</dd>
                    </div>
                  </dl>
                  <p>
                    Browser audio figures and inference duration are not total
                    latency. Benchmark the complete physical setup separately.
                  </p>
                </details>
                <p className="credit">
                  Piano samples: Alexander Holm ·{" "}
                  <a
                    href="https://creativecommons.org/licenses/by/3.0/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    CC BY 3.0
                  </a>
                  . Trimmed, normalized, and repitched. Felt is a filtered
                  preset. Samples have a finite decay; sustain does not loop
                  them.
                </p>
                <div className="settings-bottom">
                  <p>
                    Local models. Local samples. Your session stays on this Mac.
                  </p>
                  <button className="button subtle" onClick={resetSession}>
                    <RotateCcw size={14} />
                    Reset session
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
