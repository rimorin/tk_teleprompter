import { memo, useLayoutEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import type { OutlineBullet, Paragraph, ParsedScript } from '@teleprompter/shared';

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
  /** Outline bullets: when the next token is in one, the whole bullet is highlighted. */
  bullets: readonly OutlineBullet[];
  onReposition: (tokenId: number) => void;
};

/** Moves farther than this many lines snap instead of gliding (e.g. a tap far away). */
const GLIDE_MAX_LINES = 3;

/**
 * One marker behind the next word (or the current outline bullet: tokens `from`..`to`) that
 * glides there, instead of the highlight jumping. Positioned from the tokens' layout boxes;
 * re-measured when the layout changes.
 */
function useFocusMarker(
  containerRef: React.RefObject<HTMLDivElement | null>,
  markerRef: React.RefObject<HTMLDivElement | null>,
  from: number | null,
  to: number | null,
) {
  const lastTop = useRef<number | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const marker = markerRef.current;
    if (!container || !marker) return;
    const place = (glide: boolean) => {
      const tokens: HTMLElement[] = [];
      for (let id = from ?? 0; from !== null && to !== null && id <= to; id++) {
        const el = container.querySelector<HTMLElement>(`[data-tid="${id}"]`);
        if (el) tokens.push(el);
      }
      const first = tokens[0];
      if (!first) {
        marker.hidden = true;
        lastTop.current = null;
        return;
      }
      const top = Math.min(...tokens.map((t) => t.offsetTop));
      const left = Math.min(...tokens.map((t) => t.offsetLeft));
      const right = Math.max(...tokens.map((t) => t.offsetLeft + t.offsetWidth));
      const bottom = Math.max(...tokens.map((t) => t.offsetTop + t.offsetHeight));
      const lineHeight = parseFloat(getComputedStyle(first).lineHeight) || first.offsetHeight;
      const far =
        lastTop.current === null || Math.abs(top - lastTop.current) > GLIDE_MAX_LINES * lineHeight;
      if (glide && !far) delete marker.dataset.instant;
      else marker.dataset.instant = '';
      marker.hidden = false;
      marker.style.transform = `translate(${left}px, ${top}px)`;
      marker.style.width = `${right - left}px`;
      marker.style.height = `${bottom - top}px`;
      lastTop.current = top;
    };
    place(true);
    // Font size, column width, rotation…: follow the word without animating.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => place(false));
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, markerRef, from, to]);
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
  bullets,
  onReposition,
}: ScriptDisplayProps) {
  const confirmed = confirmedTokenId ?? -1;
  const tentative = Math.max(confirmed, tentativeTokenId ?? -1);
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const bullet =
    nextTokenId === null
      ? undefined
      : bullets.find((b) => nextTokenId >= b.startTokenId && nextTokenId <= b.lastTokenId);
  useFocusMarker(
    containerRef,
    markerRef,
    bullet ? bullet.firstTokenId : nextTokenId,
    bullet ? bullet.lastTokenId : nextTokenId,
  );

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
      <div
        ref={markerRef}
        className="focus-marker"
        data-bullet={bullet ? '' : undefined}
        data-tentative={bullet && tentative > confirmed ? '' : undefined}
        aria-hidden
        hidden
      />
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
