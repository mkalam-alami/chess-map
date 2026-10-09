const FAN_STEPS = 24;
const START = -Math.PI / 4;

/** Absolute difference between two angles, in [0, PI]. */
export const angDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
};

/**
 * Directions (radians, screen space) for `count` new markers around a board: each one is the candidate on a
 * 24-step fan (starting up-right) farthest from the `taken` directions and the ones picked before it.
 * `allowed` rejects candidates (e.g. off screen); if none is allowed the start direction is used.
 */
export function spawnAngles(taken: number[], count: number, allowed: (angle: number) => boolean = () => true): number[] {
  const used = [...taken];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let best = START;
    let bestD = -1;
    for (let k = 0; k < FAN_STEPS; k++) {
      const a = START + (k * 2 * Math.PI) / FAN_STEPS;
      if (!allowed(a)) continue;
      const d = used.length ? Math.min(...used.map((t) => angDist(a, t))) : Infinity;
      if (d > bestD + 1e-9) {
        bestD = d;
        best = a;
      }
    }
    used.push(best);
    out.push(best);
  }
  return out;
}
