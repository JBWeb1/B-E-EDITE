/**
 * Finds the beat of a song: how fast it is (BPM) and when each beat lands, so cuts
 * can happen on the beat. Onset strength from rising loudness, tempo from
 * autocorrelation, then the beat grid that lines up best with the onsets.
 */

export interface BeatGrid {
  bpm: number;
  /** Seconds of each beat. */
  beats: number[];
  /** How clear the beat is, 0..1 (low for speech or ambient sound). */
  confidence: number;
}

const HOP = 0.005; // 5 ms frames

/** Onset strength: how much louder each 5 ms frame is than the one before (lightly smoothed). */
export function onsetStrength(samples: Float32Array, rate: number): number[] {
  const size = Math.max(1, Math.round(rate * HOP));
  const energy: number[] = [];
  for (let i = 0; i + size <= samples.length; i += size) {
    let s = 0;
    for (let j = i; j < i + size; j++) s += samples[j] * samples[j];
    energy.push(Math.log1p(1000 * Math.sqrt(s / size)));
  }
  const onset = energy.map((e, i) => (i === 0 ? 0 : Math.max(0, e - energy[i - 1])));
  // Remove the slow trend so loud passages don't dominate.
  const out: number[] = [];
  const w = 40;
  for (let i = 0; i < onset.length; i++) {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(onset.length - 1, i + w); k++) {
      s += onset[k];
      n++;
    }
    out.push(Math.max(0, onset[i] - s / n));
  }
  // Widen each onset a little so tempos that fall between frames still line up.
  const k = [1, 2, 3, 2, 1];
  return out.map((_, i) => k.reduce((sum, w, j) => sum + w * (out[i + j - 2] ?? 0), 0) / 9);
}

/** Tempo and beat times of a song. */
export function detectBeats(samples: Float32Array, rate: number, minBpm = 70, maxBpm = 180): BeatGrid {
  const onset = onsetStrength(samples, rate);
  const n = onset.length;
  if (n < 400) return { bpm: 120, beats: [], confidence: 0 };
  const minLag = Math.round(60 / maxBpm / HOP);
  const maxLag = Math.round(60 / minBpm / HOP);
  const mean = onset.reduce((a, b) => a + b, 0) / n;
  const centred = onset.map((v) => v - mean);
  let zero = 0;
  for (const v of centred) zero += v * v;
  // Autocorrelation up to four periods, so each tempo is judged on its multiples too
  // (a true beat repeats at 2×, 3× and 4× its period; a 1.5-beat match does not).
  const ac = new Float32Array(4 * maxLag + 1);
  for (let lag = Math.floor(minLag / 2); lag <= Math.min(4 * maxLag, n - 1); lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += centred[i] * centred[i - lag];
    ac[lag] = s / (n - lag);
  }
  let bestLag = minLag;
  let best = -Infinity;
  const score: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    // Music mostly splits beats in two, so a half-period match counts in favour too.
    const s = ac[lag] + (ac[2 * lag] ?? 0) / 2 + (ac[3 * lag] ?? 0) / 3 + (ac[4 * lag] ?? 0) / 4 + 0.5 * Math.max(0, ac[Math.round(lag / 2)]);
    // Gentle preference for tempos near 120 BPM (what most music feels like).
    const bpm = 60 / (lag * HOP);
    const weight = Math.exp(-0.5 * (Math.log2(bpm / 120) / 1) ** 2);
    score.push(s * weight);
    if (s * weight > best) {
      best = s * weight;
      bestLag = lag;
    }
  }
  const confidence = zero > 0 ? Math.max(0, Math.min(1, (ac[bestLag] * n) / zero)) : 0;
  // Refine the period with neighbours (sub-frame precision).
  const k = bestLag - minLag;
  const a = score[k - 1] ?? score[k];
  const c = score[k + 1] ?? score[k];
  const denom = a - 2 * score[k] + c;
  const period = (bestLag + (denom ? (0.5 * (a - c)) / denom : 0)) * HOP;
  // Phase: the offset whose grid collects the most onset energy.
  const steps = Math.max(1, Math.round(period / HOP));
  let bestPhase = 0;
  let bestSum = -Infinity;
  for (let p = 0; p < steps; p++) {
    let s = 0;
    for (let t = p * HOP; t < n * HOP; t += period) s += onset[Math.round(t / HOP)] ?? 0;
    if (s > bestSum) {
      bestSum = s;
      bestPhase = p * HOP;
    }
  }
  const beats: number[] = [];
  for (let t = bestPhase; t < n * HOP; t += period) beats.push(Math.round(t * 1000) / 1000);
  return { bpm: Math.round((60 / period) * 10) / 10, beats, confidence };
}

/** The beat nearest to `t` (or `t` itself when there are no beats). */
export function snapToBeat(t: number, beats: number[]): number {
  let best = t;
  let dist = Infinity;
  for (const b of beats) {
    const d = Math.abs(b - t);
    if (d < dist) {
      dist = d;
      best = b;
    }
  }
  return best;
}
