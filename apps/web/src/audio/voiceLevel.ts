/** Readings the noise floor is the quietest of (about 2.5 s at 60 readings a second). */
const FLOOR_READINGS = 150;
/** Sound must be this far above the floor (dB) to count as voice... */
const MARGIN_DB = 9;
/** ...and is shown in full this far above the margin. */
const RANGE_DB = 24;
/** Smoothing per reading: rises quickly, falls gently. */
const ATTACK = 0.35;
const RELEASE = 0.08;

/**
 * Turns loudness readings (dBFS, one per animation frame) into a 0–1 voice level for display.
 * Relative to the room, not absolute: automatic gain raises background noise to near speech
 * level, so the noise floor is the quietest recent reading (the gaps between words keep pulling
 * it down) and only sound well above it counts.
 */
export function createVoiceLevel(): (db: number) => number {
  const recent: number[] = [];
  let level = 0;
  return (db) => {
    recent.push(db);
    if (recent.length > FLOOR_READINGS) recent.shift();
    const floor = Math.min(...recent);
    const target = Math.min(1, Math.max(0, (db - floor - MARGIN_DB) / RANGE_DB));
    level += (target - level) * (target > level ? ATTACK : RELEASE);
    return level;
  };
}
