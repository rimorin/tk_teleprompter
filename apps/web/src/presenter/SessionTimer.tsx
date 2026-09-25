import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';

/** m:ss, or h:mm:ss past the hour. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Talk time. Ticks on its own so the script doesn't re-render every second. */
export function SessionTimer({ running, stopped }: { running: boolean; stopped: boolean }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) return;
    let last = Date.now();
    const addSinceLast = () => {
      const t = Date.now();
      const delta = t - last;
      last = t;
      setElapsed((e) => e + delta);
    };
    const id = setInterval(addSinceLast, 250);
    return () => {
      clearInterval(id);
      addSinceLast();
    };
  }, [running]);

  if (!running && elapsed === 0) return null;
  const text = formatElapsed(elapsed);

  if (stopped) {
    return (
      <button
        type="button"
        className="timer"
        data-state="stopped"
        onClick={() => setElapsed(0)}
        aria-label={`Talk time ${text}. Reset timer`}
        title="Reset timer"
      >
        {text}
        <RotateCcw size={13} aria-hidden />
      </button>
    );
  }
  return (
    <span
      className="timer"
      data-state={running ? 'running' : 'paused'}
      role="timer"
      aria-label={`Talk time ${text}${running ? '' : ', paused'}`}
    >
      {text}
    </span>
  );
}
