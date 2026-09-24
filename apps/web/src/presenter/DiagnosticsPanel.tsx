import { useEffect, useState } from 'react';
import type { TrackingState } from '@teleprompter/shared';
import type { AsrMetrics } from '../net/asrClient';

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Development aid: current matcher inputs and decision. Hidden unless toggled (D). */
export function DiagnosticsPanel({
  state,
  getMetrics,
}: {
  state: TrackingState;
  /** Live voice timing; polled only while the panel is open. */
  getMetrics: () => AsrMetrics | null;
}) {
  const [metrics, setMetrics] = useState<AsrMetrics | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setMetrics(getMetrics()), 500);
    return () => clearInterval(timer);
  }, [getMetrics]);
  const d = state.lastDecision;
  return (
    <aside className="diagnostics" aria-label="Diagnostics">
      <dl>
        <dt>Recognition delay</dt>
        <dd>
          {metrics?.delayMs != null ? seconds(metrics.delayMs) : '–'}
          {metrics && ` · upload queue ${seconds(metrics.backlogMs)}`}
        </dd>
        <dt>Status</dt>
        <dd>{state.status}</dd>
        <dt>Confirmed / tentative</dt>
        <dd>
          {state.confirmedTokenId ?? '–'} / {state.tentativeTokenId ?? '–'}
        </dd>
        <dt>Decision</dt>
        <dd>
          {d
            ? `${d.kind} → ${d.tokenId ?? '–'} (score ${d.score?.toFixed(2) ?? '–'}, idf ${d.distinctiveness?.toFixed(1) ?? '–'})`
            : '–'}
        </dd>
        <dt>Phrase</dt>
        <dd>{d?.phrase.join(' ') || '–'}</dd>
        <dt>Misses / pending jump</dt>
        <dd>
          {state.misses} /{' '}
          {state.pendingJump
            ? `pos ${state.pendingJump.position} · ${state.pendingJump.words} words`
            : '–'}
        </dd>
        <dt>Recent final</dt>
        <dd>{state.transcript.finalWords.slice(-16).join(' ') || '–'}</dd>
        <dt>Interim</dt>
        <dd>{state.transcript.interim?.words.join(' ') || '–'}</dd>
      </dl>
    </aside>
  );
}
