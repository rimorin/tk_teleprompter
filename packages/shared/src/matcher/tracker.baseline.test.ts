/**
 * Baseline for full-script tracking. Records how the parser splits the fixture scripts and every
 * change in tracking state while the simulator reads them, so changes elsewhere (such as outline
 * tracking) can be checked not to alter full-script behaviour. An intended change to full-script
 * tracking updates the snapshot with `vitest run -u`; review that diff like code.
 */
import { describe, expect, it } from 'vitest';
import { parseScript } from '../tokenizer';
import { simulateReading, type SimAction, type SimOptions } from '../sim/simulator';
import { LIST_SCRIPT, TALK_SCRIPT } from '../fixtures/scripts';
import type { ParsedScript } from '../types';
import { createMatchContext } from './context';
import { initialTrackingState, startTracking, update, type TrackingState } from './tracker';

const SCRIPTS = { talk: TALK_SCRIPT, list: LIST_SCRIPT };

/** Token id of the first token starting the phrase. */
function find(script: ParsedScript, phrase: string): number {
  const words = phrase.toLowerCase().split(' ');
  for (let i = 0; i < script.tokens.length; i++) {
    if (words.every((w, k) => script.tokens[i + k]?.normalized === w)) return i;
  }
  throw new Error(`phrase not found: ${phrase}`);
}

function parseSummary(script: ParsedScript) {
  return {
    paragraphs: script.paragraphs.map(
      (p) => `${p.firstTokenId}-${p.lastTokenId} @${p.startOffset}-${p.endOffset}`,
    ),
    tokens: script.tokens.map(
      (t) =>
        `${t.paragraphId}:${t.normalized || '∅'}${t.spokenForms ? `[${t.spokenForms.join('|')}]` : ''}`,
    ),
  };
}

const stateKey = (s: TrackingState) =>
  `c=${s.confirmedTokenId ?? '-'} t=${s.tentativeTokenId ?? '-'} ${s.status}` +
  ` ${s.lastDecision?.kind ?? '-'} j=${s.jumpSuggestion ?? '-'}`;

/** One line per event that changed the tracking state: "index kind truth -> state". */
function trace(script: ParsedScript, options: SimOptions): string[] {
  const ctx = createMatchContext(script);
  let state = startTracking(initialTrackingState());
  let last = stateKey(state);
  const lines: string[] = [];
  simulateReading(script, options).forEach((sim, i) => {
    state = update(ctx, state, sim.event);
    const key = stateKey(state);
    if (key !== last) lines.push(`${i} ${sim.event.kind[0]} truth=${sim.truthTokenId ?? '-'} ${key}`);
    last = key;
  });
  return lines;
}

const noisy: SimOptions = { substitutionRate: 0.08, fillerRate: 0.08, interimRevisionRate: 0.3 };

function scenarios(script: ParsedScript): Record<string, SimOptions> {
  const at = (phrase: string) => find(script, phrase);
  const actions = (a: SimAction[]): SimOptions => ({ actions: a });
  const common: Record<string, SimOptions> = {
    'exact read': {},
    'noisy read, seed 1': { ...noisy, seed: 1 },
    'noisy read, seed 2': { ...noisy, seed: 2 },
    'noisy read, seed 3': { ...noisy, seed: 3 },
  };
  if (script.source === TALK_SCRIPT) {
    return {
      ...common,
      'skips a paragraph': actions([
        { type: 'skip', atTokenId: at('the new importer'), toTokenId: at('we also removed') },
      ]),
      'ad-lib then resumes': actions([
        {
          type: 'adlib',
          atTokenId: at('last spring we'),
          text: 'you know honestly when we started none of us really believed we would get here',
        },
      ]),
      're-reads a sentence': actions([
        { type: 'repeat', atTokenId: at('we also removed'), fromTokenId: at('the new importer') },
      ]),
      'long pause': actions([{ type: 'pause', atTokenId: at('there are risks'), ms: 8000 }]),
    };
  }
  return {
    ...common,
    'skips a list item': actions([
      { type: 'skip', atTokenId: at('second the importer'), toTokenId: at('third we removed') },
    ]),
    'ad-lib between list items': actions([
      {
        type: 'adlib',
        atTokenId: at('2 measure whether'),
        text: 'and I should say this part is still a bit of an open question for us',
      },
    ]),
  };
}

describe.each(Object.entries(SCRIPTS))('full-script baseline: %s', (_, source) => {
  const script = parseScript(source);

  it('parses into the same paragraphs and tokens', () => {
    expect(parseSummary(script)).toMatchSnapshot();
  });

  it.each(Object.entries(scenarios(script)))('tracks "%s" the same way', (_, options) => {
    expect(trace(script, options)).toMatchSnapshot();
  });
});
