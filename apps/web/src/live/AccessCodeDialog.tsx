import { KeyRound, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useEscapeKey } from '../ui/useEscapeKey';

type Props = {
  rejected: boolean;
  onSubmit: (code: string) => void;
  onClose: () => void;
};

/** Asks for the server's access code before voice tracking starts. */
export function AccessCodeDialog({ rejected, onSubmit, onClose }: Props) {
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => inputRef.current?.focus(), []);
  useEscapeKey(onClose);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (code.trim()) onSubmit(code.trim());
  }

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onSubmit={submit}
      >
        <div className="dialog-head">
          <h2 id={`${id}-title`}>
            <KeyRound size={18} aria-hidden /> Access code
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} aria-hidden />
          </button>
        </div>
        <p className="muted small">
          Voice tracking on this server is protected. Enter the access code you were given; it is
          remembered on this device.
        </p>
        {rejected && (
          <p className="error small" role="alert">
            That code was not accepted. Check it and try again.
          </p>
        )}
        <label htmlFor={`${id}-code`} className="sr-only">
          Access code
        </label>
        <input
          ref={inputRef}
          id={`${id}-code`}
          className="text-input"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Access code"
        />
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!code.trim()}>
            Start microphone
          </button>
        </div>
      </form>
    </div>
  );
}
