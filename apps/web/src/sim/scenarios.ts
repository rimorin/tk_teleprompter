import type { ParsedScript, SimOptions } from '@teleprompter/shared';

export type SimScenario = 'clean' | 'noisy' | 'detours';

export const SIM_SCENARIOS: Array<{ id: SimScenario; label: string }> = [
  { id: 'clean', label: 'Clean read' },
  { id: 'noisy', label: 'Noisy recognition' },
  { id: 'detours', label: 'Ad-lib, pause & skip' },
];

/** Simulation options for reading from `startTokenId` under a scenario. */
export function scenarioOptions(
  script: ParsedScript,
  scenario: SimScenario,
  startTokenId: number,
  seed: number,
): SimOptions {
  const base: SimOptions = { seed, startTokenId, sessionId: `sim-${seed}`, wordsPerMinute: 150 };
  if (scenario === 'clean') return base;
  if (scenario === 'noisy') {
    return { ...base, substitutionRate: 0.1, fillerRate: 0.08, interimRevisionRate: 0.3 };
  }
  const startPara = script.tokens[startTokenId]?.paragraphId ?? 0;
  const p1 = script.paragraphs[startPara + 1];
  const p2 = script.paragraphs[startPara + 2];
  const p4 = script.paragraphs[startPara + 4];
  const actions: SimOptions['actions'] = [];
  if (p1) {
    actions.push({
      type: 'adlib',
      atTokenId: p1.firstTokenId,
      text: 'and I should mention that this part surprised all of us when we first saw the numbers',
    });
    actions.push({ type: 'pause', atTokenId: p1.firstTokenId + 3, ms: 4000 });
  }
  // Two paragraphs: a shorter skip is followed without needing a jump.
  if (p2 && p4)
    actions.push({ type: 'skip', atTokenId: p2.firstTokenId, toTokenId: p4.firstTokenId });
  return { ...base, substitutionRate: 0.05, fillerRate: 0.05, actions };
}
