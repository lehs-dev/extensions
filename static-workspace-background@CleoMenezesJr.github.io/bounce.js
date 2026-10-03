// Quick transitions overshoot; slow ones go straight.

export const BOUNCE_MAX_MS = 300;
export const OVER_OVERSHOOT_PX = 14;
export const SLIDE_FACTOR = 0.75;
export const RETURN_MS = 130;

export function computeBounceParams({duration, target, current = 0}) {
  if (!Number.isFinite(duration) || !Number.isFinite(target) ||
      !Number.isFinite(current) || duration <= 0 || duration > BOUNCE_MAX_MS)
    return null;

  const delta = target - current;
  if (Math.abs(delta) < Number.EPSILON)
    return null;

  // Overshoot in pixels; progress outside [0,1] becomes NaN.
  return {
    target,
    overshootPx: Math.sign(delta) * OVER_OVERSHOOT_PX,
    slideDuration: Math.round(duration * SLIDE_FACTOR),
    returnDuration: RETURN_MS,
  };
}
