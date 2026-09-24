import type { TrackingStatus } from '@teleprompter/shared';

export type Source = 'none' | 'simulation' | 'microphone';

const LABELS: Record<TrackingStatus, string> = {
  idle: 'Manual',
  tracking: 'Following',
  paused: 'Paused',
  uncertain: 'Lost place',
  disconnected: 'Disconnected',
};

const HINTS: Partial<Record<TrackingStatus, string>> = {
  uncertain: 'Keep reading, or tap where you are.',
  paused: 'Tracking paused — navigate manually or resume.',
  disconnected: 'Connection lost — manual control still works.',
};

export function StatusPill({
  status,
  source,
  connecting = false,
  reconnecting = false,
}: {
  status: TrackingStatus;
  source: Source;
  /** Microphone/session is starting up. */
  connecting?: boolean;
  /** The connection dropped and a new session is being attempted. */
  reconnecting?: boolean;
}) {
  let label = LABELS[status];
  if (reconnecting) label = 'Reconnecting…';
  else if (connecting) label = 'Connecting…';
  else if (status === 'tracking' && source === 'simulation') label = 'Following (simulated)';
  else if (status === 'tracking' && source === 'microphone') label = 'Listening';
  const hint = reconnecting
    ? 'Keep going — manual control still works.'
    : connecting
      ? undefined
      : HINTS[status];
  return (
    <span
      className="status"
      data-status={connecting || reconnecting ? 'connecting' : status}
      role="status"
      aria-live="polite"
    >
      <span className="status-dot" aria-hidden="true" />
      {label}
      {hint && <span className="status-hint">{hint}</span>}
    </span>
  );
}
