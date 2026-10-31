/**
 * The campaign clock's daily boundaries, shared by every consumer that must
 * agree on when dawn and dusk happen: the item reset executor (per-day economy
 * resets at dawn/dusk, itemResetExecutor.ts) and the engine-computed
 * `next-dawn` ending of an item creature grant (activeEffects.ts,
 * eshyra-7gkh.1). One definition, so a grant that ends "at the next dawn" and
 * an economy that "regains its uses at dawn" can never disagree.
 *
 * `clock.elapsed_minutes` counts minutes from the campaign start; a day is
 * 1,440 minutes and dawn is minute 360 of it (06:00), dusk minute 1,080 (18:00).
 */
export const MINUTES_PER_DAY = 1_440;
export const DAWN_MINUTE_OF_DAY = 360;
export const DUSK_MINUTE_OF_DAY = 1_080;

/**
 * Every daily boundary at `minuteOfDay` in the half-open interval
 * `(previousElapsedMinutes, elapsedMinutes]`, in order.
 */
export function crossedBoundaries(
  previousElapsedMinutes: number,
  elapsedMinutes: number,
  minuteOfDay: number,
): number[] {
  const firstDay = Math.floor(previousElapsedMinutes / MINUTES_PER_DAY);
  const first = firstDay * MINUTES_PER_DAY + minuteOfDay;
  const result: number[] = [];
  for (
    let boundary = first;
    boundary <= elapsedMinutes;
    boundary += MINUTES_PER_DAY
  )
    if (boundary > previousElapsedMinutes) result.push(boundary);
  return result;
}

/**
 * The first dawn boundary STRICTLY after `elapsedMinutes`: a clock sitting
 * exactly on a dawn has already crossed it, so the next one is a day later.
 * Any window of one day after a minute holds exactly one dawn.
 */
export function nextDawnAfter(elapsedMinutes: number): number {
  const [dawn] = crossedBoundaries(
    elapsedMinutes,
    elapsedMinutes + MINUTES_PER_DAY,
    DAWN_MINUTE_OF_DAY,
  );
  if (dawn === undefined)
    throw new Error('no dawn boundary within one day of the clock');
  return dawn;
}
