import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
export default function MiniGame({
  actions,
  onReset,
}: {
  actions: Set<string>;
  onReset: () => void;
}) {
  const [state, setState] = useState({
    x: 50,
    y: 0,
    score: 0,
    obstacle: 100,
    over: false,
  });
  const s = useRef(state),
    last = useRef(0),
    velocity = useRef(0),
    jumping = useRef(false),
    actionsRef = useRef(actions);
  actionsRef.current = actions;
  const reset = () => {
    s.current = { x: 50, y: 0, score: 0, obstacle: 100, over: false };
    velocity.current = 0;
    setState(s.current);
    onReset();
  };
  useEffect(() => {
    let raf: number;
    const tick = (now: number) => {
      const dt = Math.min(0.04, (now - (last.current || now)) / 1000);
      last.current = now;
      const a = actionsRef.current;
      if (a.has("reset")) {
        s.current = { x: 50, y: 0, score: 0, obstacle: 100, over: false };
        velocity.current = 0;
      }
      if (!s.current.over) {
        let { x, y, score, obstacle } = s.current;
        x = Math.max(
          8,
          Math.min(
            92,
            x + (a.has("left") ? -65 : a.has("right") ? 65 : 0) * dt,
          ),
        );
        if (a.has("jump") && !jumping.current && y === 0)
          velocity.current = 130;
        jumping.current = a.has("jump");
        y = Math.max(0, y + velocity.current * dt);
        velocity.current -= 300 * dt;
        if (y === 0) velocity.current = 0;
        obstacle -= 28 * dt;
        if (obstacle < -8) {
          obstacle = 108;
          score++;
        }
        const over = Math.abs(x - obstacle) < 7 && y < 9;
        s.current = { x, y, score, obstacle, over };
        setState(s.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="mini-game">
      <div className="game-heading">
        <span>
          <span className="live-dot" /> PAPER RUNNER
        </span>
        <span>
          {String(state.score).padStart(3, "0")} <small>cleared</small>
        </span>
      </div>
      <div className="game-field">
        <div className="game-grid" />
        <div
          className="game-player"
          style={{ left: `${state.x}%`, bottom: `${22 + state.y}%` }}
        />
        <div className="game-obstacle" style={{ left: `${state.obstacle}%` }} />
        {state.over && (
          <div className="game-over">
            <strong>A little more lift.</strong>
            <button className="button primary" onClick={reset}>
              <RotateCcw size={15} />
              Try again
            </button>
          </div>
        )}
      </div>
      <div className="game-instructions">
        <span>A · move left</span>
        <span>S · jump</span>
        <span>D · move right</span>
        <span>F · reset</span>
      </div>
    </div>
  );
}
