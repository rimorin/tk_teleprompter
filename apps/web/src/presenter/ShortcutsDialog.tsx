import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Kbd } from '../ui/controls';
import { useEscapeKey } from '../ui/useEscapeKey';

const SHORTCUTS: Array<[keys: string[], action: string]> = [
  [['M'], 'Start / stop microphone'],
  [['Space'], 'Pause / resume following'],
  [['↑', '↓'], 'Previous / next paragraph'],
  [['PgUp', 'PgDn'], 'Previous / next paragraph'],
  [['Home'], 'Back to the start'],
  [['+', '−'], 'Larger / smaller text'],
  [['F'], 'Fullscreen'],
  [['D'], 'Diagnostics panel'],
  [['?'], 'Show this list'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  useEscapeKey(onClose);
  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="dialog-head">
          <h2>Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <p className="muted small">Tap any word or paragraph to jump there.</p>
        <dl className="shortcuts">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={action + keys.join()} className="shortcut">
              <dt>
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
