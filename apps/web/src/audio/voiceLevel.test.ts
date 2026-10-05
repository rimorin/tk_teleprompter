import { describe, expect, it } from 'vitest';
import { createVoiceLevel } from './voiceLevel';

/** Feed `count` readings, each `db` give or take `jitter` (deterministic), return the last level. */
function feed(level: (db: number) => number, count: number, db: number, jitter = 0) {
  let out = 0;
  for (let i = 0; i < count; i++) out = level(db + jitter * Math.sin(i * 1.7));
  return out;
}

describe('createVoiceLevel', () => {
  it('stays near zero for steady room noise, even loud, flickering noise', () => {
    const level = createVoiceLevel();
    expect(feed(level, 300, -38, 4)).toBeLessThan(0.05);
  });

  it('rises for speech well above the room noise, then falls back in silence', () => {
    const level = createVoiceLevel();
    feed(level, 200, -50, 2);
    // Speech: loud syllables with short dips between words.
    let peak = 0;
    for (let i = 0; i < 60; i++) peak = Math.max(peak, level(i % 10 < 7 ? -22 : -46));
    expect(peak).toBeGreaterThan(0.6);
    expect(feed(level, 90, -50, 2)).toBeLessThan(0.05);
  });

  it('is not fooled by silent frames as the microphone starts', () => {
    const level = createVoiceLevel();
    feed(level, 30, -120); // Digital silence before audio arrives.
    feed(level, 200, -40, 3); // Then room noise, once the silent frames have aged out.
    expect(feed(level, 30, -40, 3)).toBeLessThan(0.05);
  });

  it('moves smoothly: one loud reading does not fill the ring', () => {
    const level = createVoiceLevel();
    feed(level, 200, -50);
    expect(level(-15)).toBeLessThan(0.4);
  });
});
