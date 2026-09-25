import { memo, useLayoutEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import type { Paragraph, ParsedScript } from '@teleprompter/shared';

type ParagraphViewProps = {
  script: ParsedScript;
  paragraph: Paragraph;
  /** Last spoken token id within this paragraph, or firstTokenId - 1 if none. */
  spokenUpTo: number;
  /** Last tentatively spoken token id within this paragraph, or <= spokenUpTo if none. */
  tentativeUpTo: number;
  /** Next token to read if it is in this paragraph, else -1. */
  nextTokenId: number;
  /** Token range of a suggested jump within this paragraph, or null. */
  jumpFrom: number | null;
  jumpTo: number | null;
};

/**
 * One paragraph. Props are clamped per paragraph so that a cursor move only re-renders the
 * paragraphs it touches.
 */
const ParagraphView = memo(function ParagraphView({
  script,
  paragraph,
  spokenUpTo,
  tentativeUpTo,
  nextTokenId,
  jumpFrom,
  jumpTo,
}: ParagraphViewProps) {
  const children: ReactNode[] = [];
  let prevEnd = paragraph.startOffset;
  for (let id = paragraph.firstTokenId; id <= paragraph.lastTokenId; id++) {
    const token = script.tokens[id]!;
    if (token.startOffset > prevEnd) children.push(script.source.slice(prevEnd, token.startOffset));
    let className = 'tok';
    if (id <= spokenUpTo) className += ' spoken';
    else if (id <= tentativeUpTo) className += ' tentative';
    if (id === nextTokenId) className += ' next';
    if (jumpFrom !== null && jumpTo !== null && id >= jumpFrom && id <= jumpTo) {
      className += ' jump-target';
    }
    children.push(
      <span key={id} data-tid={id} className={className}>
        {token.displayText}
      </span>,
    );
    prevEnd = token.endOffset;
  }
  const active = nextTokenId !== -1;
  return (
    <p data-pid={paragraph.id} className={active ? 'para active' : 'para'}>
      {children}
    </p>
  );
});

type ScriptDisplayProps = {
  script: ParsedScript;
  confirmedTokenId: number | null;
  tentativeTokenId: number | null;
  nextTokenId: number | null;
  /** First and last token of the words a "Jump to …" suggestion quotes, or null. */
  jump: [from: number, to: number] | null;
  onReposition: (tokenId: number) => void;
};

/** Moves farther than this many lines snap instead of gliding (e.g. a tap far away). */
const GLIDE_MAX_LINES = 3;

/**
 * One marker behind the next word that glides from word to word, instead of the highlight
 * jumping. Positioned from the token's layout box; re-measured when the layout changes.
 */
function useFocusMarker(
  containerRef: React.RefObject<HTMLDivElement | null>,
  markerRef: React.RefObject<HTMLDivElement | null>,
  tokenId: number | null,
) {
  const lastTop = useRef<number | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const marker = markerRef.current;
    if (!container || !marker) return;
    const place = (glide: boolean) => {
      const token =
        tokenId === null ? null : container.querySelector<HTMLElement>(`[data-tid="${tokenId}"]`);
      if (!token) {
        marker.hidden = true;
        lastTop.current = null;
        return;
      }
      const lineHeight = parseFloat(getComputedStyle(token).lineHeight) || token.offsetHeight;
      const far =
        lastTop.current === null ||
        Math.abs(token.offsetTop - lastTop.current) > GLIDE_MAX_LINES * lineHeight;
      if (glide && !far) delete marker.dataset.instant;
      else marker.dataset.instant = '';
      marker.hidden = false;
      marker.style.transform = `translate(${token.offsetLeft}px, ${token.offsetTop}px)`;
      marker.style.width = `${token.offsetWidth}px`;
      marker.style.height = `${token.offsetHeight}px`;
      lastTop.current = token.offsetTop;
    };
    place(true);
    // Font size, column width, rotation…: follow the word without animating.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => place(false));
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, markerRef, tokenId]);
}

function clampTo(value: number, p: Paragraph): number {
  return Math.min(p.lastTokenId, Math.max(p.firstTokenId - 1, value));
}

/** The part of a jump suggestion inside one paragraph (nulls if none), keeping memo effective. */
function jumpRange(
  jump: [number, number] | null,
  p: Paragraph,
): { jumpFrom: number | null; jumpTo: number | null } {
  if (!jump || jump[1] < p.firstTokenId || jump[0] > p.lastTokenId) {
    return { jumpFrom: null, jumpTo: null };
  }
  return { jumpFrom: Math.max(jump[0], p.firstTokenId), jumpTo: Math.min(jump[1], p.lastTokenId) };
}

export function ScriptDisplay({
  script,
  confirmedTokenId,
  tentativeTokenId,
  nextTokenId,
  jump,
  onReposition,
}: ScriptDisplayProps) {
  const confirmed = confirmedTokenId ?? -1;
  const tentative = Math.max(confirmed, tentativeTokenId ?? -1);
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  useFocusMarker(containerRef, markerRef, nextTokenId);

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    if (window.getSelection()?.toString()) return;
    const target = e.target as HTMLElement;
    const tokenEl = target.closest<HTMLElement>('[data-tid]');
    if (tokenEl) return onReposition(Number(tokenEl.dataset.tid));
    const paraEl = target.closest<HTMLElement>('[data-pid]');
    if (paraEl) onReposition(script.paragraphs[Number(paraEl.dataset.pid)]!.firstTokenId);
  }

  return (
    <div ref={containerRef} className="script" onClick={handleClick}>
      <div ref={markerRef} className="focus-marker" aria-hidden hidden />
      {script.paragraphs.map((p) => (
        <ParagraphView
          key={p.id}
          script={script}
          paragraph={p}
          spokenUpTo={clampTo(confirmed, p)}
          tentativeUpTo={clampTo(tentative, p)}
          nextTokenId={
            nextTokenId !== null && nextTokenId >= p.firstTokenId && nextTokenId <= p.lastTokenId
              ? nextTokenId
              : -1
          }
          {...jumpRange(jump, p)}
        />
      ))}
    </div>
  );
}
