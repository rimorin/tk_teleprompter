import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useEscapeKey } from './useEscapeKey';

type Props = {
  label: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Modal panel: a bottom sheet on phones (within thumb reach), a floating panel above the dock on
 * larger screens. Closes on backdrop tap, the close button, or Escape.
 */
export function Sheet({ label, onClose, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEscapeKey(onClose);
  // Focus the panel while open, then give focus back to whatever opened it.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div
      className="sheet-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-head">
          <h2>{label}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} aria-hidden />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
