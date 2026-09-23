import type { SimulatedEvent, TranscriptEvent } from '@teleprompter/shared';

export type SimPlayer = { stop: () => void };

/** Replays simulated ASR events in real time, like a live provider would. */
export function playSimulation(
  events: SimulatedEvent[],
  onEvent: (event: TranscriptEvent) => void,
  onDone: () => void,
): SimPlayer {
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const start = Date.now();
  const next = () => {
    timer = null;
    const now = Date.now() - start;
    while (index < events.length && events[index]!.atMs <= now) onEvent(events[index++]!.event);
    if (index >= events.length) {
      onDone();
      return;
    }
    timer = setTimeout(next, Math.max(0, events[index]!.atMs - now));
  };
  timer = setTimeout(next, 0);
  return {
    stop: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
