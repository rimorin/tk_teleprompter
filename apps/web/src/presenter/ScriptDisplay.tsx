import { memo, type MouseEvent, type ReactNode } from 'react';
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
  onReposition: (tokenId: number) => void;
};

function clampTo(value: number, p: Paragraph): number {
  return Math.min(p.lastTokenId, Math.max(p.firstTokenId - 1, value));
}

export function ScriptDisplay({
  script,
  confirmedTokenId,
  tentativeTokenId,
  nextTokenId,
  onReposition,
}: ScriptDisplayProps) {
  const confirmed = confirmedTokenId ?? -1;
  const tentative = Math.max(confirmed, tentativeTokenId ?? -1);

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    if (window.getSelection()?.toString()) return;
    const target = e.target as HTMLElement;
    const tokenEl = target.closest<HTMLElement>('[data-tid]');
    if (tokenEl) return onReposition(Number(tokenEl.dataset.tid));
    const paraEl = target.closest<HTMLElement>('[data-pid]');
    if (paraEl) onReposition(script.paragraphs[Number(paraEl.dataset.pid)]!.firstTokenId);
  }

  return (
    <div className="script" onClick={handleClick}>
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
        />
      ))}
    </div>
  );
}
