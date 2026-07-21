# Magic-item reset and timer executor

Canonical pack-bound magic-item economies and state-machine timers are owned by
the item reset executor. `advance_time` supplies the only structured clock, and
rest completion supplies the two rest events. The executor writes only the
authoritative `item_state` JSON row; its applied transitions are returned as
tool/rest evidence.

## Clock boundaries

Elapsed minute zero is midnight. The minute of day is
`elapsed_minutes mod 1440`; dawn is minute 360 (06:00) and dusk is minute 1080
(18:00). A boundary fires for every value in the half-open interval
`(previousElapsedMinutes, elapsedMinutes]`. Thus a three-day advance crosses
three dawns, and a dice regain rolls once for each crossing. `lastReset` stores
the decimal elapsed-minute boundary and prevents a secondary path from applying
the same boundary twice.

Dawn and dusk are clock-derived rather than model/tool events because elapsed
time is already deterministic, testable, and owned by `advance_time`; narrative
labels are deliberately advisory (`narrativeLabelStale` records that fact).

## Event order

Every event an item owes is applied in chronological order across all three
streams — dawn/dusk boundaries, anchored economy deadlines, and machine
timers — not stream by stream. An item whose timer destroys it at minute 1
therefore cannot first regain charges at the dawn of minute 360, and
`lastReset` only ever moves forward. Events that land on the same minute run
timers first, then anchored resets (ordered by economy id), then dawn/dusk, so
a destruction always precedes a regain it would invalidate.

## Anchored resets

`hour` and `days` resets are anchored when an item economy is spent to zero.
The deadline is stored in `availableAt`; older rows without that field never
become due, which is the migration posture and requires no database migration.
Cooldown duration and its declared reset unit/day count must agree. `per-period`
resets use the same anchor, but every spend overwrites it. This is the executor's
definition of `onlyIfUnused`: the period restarts on use. A per-period economy
re-anchors for its next period only while it remains below maximum; once it is
full the schedule stops and only the next spend re-anchors it, so a long advance
cannot keep firing empty resets. Budget reset amounts are converted from their
`DurationSpec` into the budget's existing increment units, the same units used
for `remaining` at initialization.

`all` targets the initialized maximum, including a recorded random
initialization result. Every regain is clamped to that maximum. `inert` items
regain only when the resetting economy has a recorded depletion whose
`becomes` value is `inert`; that reset also clears the inert lifecycle. Consumed,
nonmagical, and pending-terminal items do not regain.

## Timers and fail-closed behavior

Due timers run oldest first. A fired transition schedules timers declared by the
entered state at the fired deadline, not at the current clock, and cascades
until no timer is due. Because a machine has exactly one current state, firing a
transition cancels every timer owned by the state being left, not only the timer
that fired. Timer effects and destruction attunement evidence are returned with
the resolution. A round-based timer, a timer that would expire no later than the
transition entering its state, a dice amount without seeded RNG, or any reset
shape outside the implemented pack contract throws with the pack reference and
leaves the transaction rolled back. A state-machine duration
with no timer transition is left unscheduled and unexecuted until its importer
finding is repaired. The executor never silently approximates unknown pack
semantics.
