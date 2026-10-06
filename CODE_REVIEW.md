# Code Review — Ic2ExpReactorPlanner

Second-pass review of the whole codebase (24 files, ~8.3k lines, Java 8 Swing desktop app).
Every finding below was **empirically verified** by compiling the sources and running
throwaway harnesses against the real classes (values, exceptions, allocations and timings
are measured, not inferred). Scratch harnesses were removed after use; nothing in `src/`
was modified.

**Legend** — ✅ reproduced with a failing/explicit observation · 🔍 confirmed by static
analysis only · ⚠️ *corrected* (my first-pass claim was wrong or imprecise) ·
✔️ *checked and cleared* (looked like a bug, is not).

---

## 0. Summary

|                                              | Count |
|----------------------------------------------|-------|
| P0 — wrong simulation results                | 2 (both fixed) |
| P1 — crashes / data races                    | 4 (3 fixed) |
| P2 — performance                             | 3 (3 fixed) |
| P3 — dead code, correctness-adjacent cleanup | 19 (12 fixed, 1 retracted) |
| Retracted / corrected from the first pass    | 5     |
| **Covered by an automated regression test**  | **502** |

**Headline:** the simulation is *fast* (566 ns/tick; a full 5,000,000-tick run ≈ 2.8 s) and
the serialization layer is *sound* (base64 round-trip is byte-identical, plating accounting
is leak-free). The genuinely dangerous problems are two wrong-heat-transfer formulas in
`Exchanger`/`Condensator`, and unvalidated legacy-code parsing that can crash the GUI.

**A 490-test regression suite and a 304-design simulation corpus now exist** so that the fixes
above can be made safely; see [Testing](#testing) at the end. Building them also surfaced six
further findings, marked **🆕** below, and escalated P0-2 from a rounding error into a
silently-wrong safety verdict.

**Status:** P0-1 `Exchanger`, P0-2 `Condensator`/P3-18, P1-1 code parsing, P3-10, P1-2/P1-3
`AutomationSimulator`, P2-1 `ImageIcon` caching, P2-2 the tick-loop snapshot, P2-3 the minor
performance sweep, P3-3 the `getOldCode()` default, P3-1 the `needsCooldown` report, P3-5 the
`GGFuelRod` dead members, P3-4 the `doInBackground` catch, P3-15 the overfill refusal, P3-6 the
`CoolantCell` sign guard, P3-13 the `Vent` null `parent` guard and P3-9 the `getMaterials()` null recipe and P3-12 the setter bounds and P3-8 the `TextureFactory` fallback loop — **all fixed and verified**; P3-16 is **retracted** as deliberate game semantics. Both P0s are closed,
and no test in the suite is skipped.

---

## P0 — Simulation produces wrong results

### P0-1 ✅ FIXED — `Exchanger.transfer()` — reactor-side heat cascade used the wrong field

**File:** `src/Ic2ExpReactorPlanner/components/Exchanger.java:100-116`

```java
if (switchReactor > 0) {
    ...
    if (add > switchReactor) { add = switchReactor; }   // correct
    if (Reactormed + mymed / 2.0 < 1.0)  { add = switchSide / 2; }   // WRONG FIELD
    if (Reactormed + mymed / 2.0 < 0.75) { add = switchSide / 4; }   // WRONG FIELD
    if (Reactormed + mymed / 2.0 < 0.5)  { add = switchSide / 8; }   // WRONG FIELD
    if (Reactormed + mymed / 2.0 < 0.25) { add = 1; }                // literal, fine
```

The five `if`s cascade (each overwrites the previous), so the **last** matching tier wins.
For `0.25 <= Reactormed + mymed/2 < 1.0` the value is derived from `switchSide`, which for
the reactor block is by definition the *wrong* constant.

**⚠️ Correction:** the first pass claimed only `coreHeatExchanger` was affected. It is
**three of the four** exchangers, and it errs in *both* directions. Measured:

| component                | side/reactor | `sum < 1.0`                                        | `< 0.75`   | `< 0.5`   | `< 0.25` |
|--------------------------|--------------|----------------------------------------------------|------------|-----------|----------|
| `heatExchanger`          | 12/4         | code 6 / **should be 2**                           | 3 / **1**  | 1 / **0** | 1 / 1 ✔ |
| `advancedHeatExchanger`  | 24/8         | code 12 / **should be 4**                          | 6 / **2**  | 3 / **1** | 1 / 1 ✔ |
| `coreHeatExchanger`      | 0/72         | code 0 / **should be 36**                          | 0 / **18** | 0 / **9** | 1 / 1 ✔ |
| `componentHeatExchanger` | 36/0         | reactor block never entered (`switchReactor == 0`) |            |           |          |

So `coreHeatExchanger` **transfers no reactor heat at all** when the reactor/exchanger are
cold, while `heatExchanger` and `advancedHeatExchanger` **over-transfer**.

**Live reproduction** (`coreHeatExchanger`, `Reactormed + mymed/2 = 0.300`):

```
maxHeat(exchanger)=5000  mymed=0.60  Reactormed=0.00  sum=0.300
tier <0.5 fires -> code add = switchSide/8 = 0/8 = 0
code moved 0 heat into reactor; correct (switchReactor/8 = 9) would move 9
```

**Fix:** replace the `switchSide` references in the `switchReactor > 0` block with
`switchReactor`. The side block (`switchSide > 0`) is already correct and must be left alone.

#### ✅ Applied and verified

The three reactor-block tiers now read `switchReactor / 2`, `/ 4`, `/ 8`, with a comment
explaining why. Verified four ways:

1. **The tier table is exact.** `ExchangerTest.ReactorSideCascade.cascadeScalesBySwitchReactor`
   asserts all nine band/cap combinations, with integer division where it bites
   (`heatExchanger`'s cap of 4 gives 0 in the `/8` band).
2. **The invariant is restored.** `neverExceedsTheCapacity` sweeps `sum` from 0.05 to 1.00 in
   0.05 steps and asserts no transfer ever exceeds `switchReactor` — which the old code
   violated for `heatExchanger` and `advancedHeatExchanger`, which over-transferred.
3. **The hot path provably did not move.** For `sum >= 1.0` no tier fires, so neither field is
   read and the transfer is just the round-and-clamp value. That is why the blast radius is
   confined to cold exchangers; `hotPathIsUnchangedByTheFix` pins it.
4. **Corpus containment.** Exactly **12 of 304** designs moved, and *every one* is tagged
   `exchanger` — the prediction held. 292 designs are byte-identical.

**Two tests were added that the fix itself did not require**, because the mutation check found
the gaps:

* **Single-tier partial reverts are caught.** Reverting only the `/2`, only the `/4`, or only
  the `/8` line each fails the suite, so a half-applied fix cannot slip through.
* **Over-correction is caught.** Switching the *side* block to `switchReactor` — the obvious
  way to "fix" this by blanket-replacing the field — was **not** caught until
  `sideCascadeScalesBySwitchSide` was added, because the existing side-transfer tests only
  asserted {@code > 0}. The side block is correct and is now pinned with its own tier table so
  nobody "fixes" it by accident.

**Note on the end-to-end numbers:** the moved designs shift in both directions
(`named-core-exchanger`: `tBurn` 1482 → 1494 but `tEvap` 1859 → 1845). The exchanger is a discrete
oscillator, so changing the step values changes its phase. The justification for the fix is the
tier table and the invariant, **not** the aggregate numbers — do not "correct" the expectations
to make an aggregate tidier.

**Skipped test count: 4 → 3.** The remaining three are `CondensatorTest.IntendedBound`.

---

### P0-2 ✅ FIXED — `Condensator.adjustCurrentHeat()` — the absorption bound ignored `currentHeat`

**File:** `src/Ic2ExpReactorPlanner/components/Condensator.java:40`

```java
double acceptedHeat = Math.min(heat, getMaxHeat() - heat);   // should be getMaxHeat() - currentHeat
```

**⚠️ Correction:** the first pass described this as "under-absorption". The real consequence
is worse and more specific. `Math.min(heat, maxHeat - heat)` goes **negative** once a
single heat packet exceeds the condensator's own capacity, so `currentHeat` is driven
below zero.

**Measured** (`currentHeat == 0`, fresh condensator):

| packet       | `rshCondensator` (max 20 000)           | `lzhCondensator` (max 100 000)           |
|--------------|-----------------------------------------|------------------------------------------|
| 0.5 × max    | `currentHeat = 10 000` ✔               | `currentHeat = 50 000` ✔                |
| 1.0 × max    | `currentHeat = 0` ✘ (should be 20 000) | `currentHeat = 0` ✘ (should be 100 000) |
| 1.4784 × max | **`currentHeat = -9 568`** ✘           | **`currentHeat = -47 840`** ✘           |

**Reachability:** I exhaustively evaluated `generateHeat()` for every fuel rod across all
neighbor counts × fluid/mox × GT5.09 × GTNH modes. **Maximum single-packet heat = 29 568**
(`fuelRodTheCore`). Because `FuelRod.handleHeat()` divides by the number of heatable
neighbors, a condensator that is the *only* heatable neighbor receives the full packet
(`handleGTHeat` likewise round-trips to the full `heat`).

* `rshCondensator` (half-capacity 10 000): 29 568 > 10 000 → **reachable, heat goes negative.**
* `lzhCondensator` (half-capacity 50 000): 29 568 < 50 000 → **not reachable**; LZH is
  completely unaffected and needs no fix validation.

**Impact of negative heat:** `currentHeat` becomes negative, `isHeatAcceptor()` still
returns true, and `needsCoolantInjected()` (`currentHeat > 0.85 * maxHeat`) is skewed. A
corrupted condensator then skews every downstream temperature and vented-HU figure.

#### 🔴 Escalation: for an over-capacity packet the bug **deletes heat from the reactor**

Found by the Phase 0 corpus, not by reading. When a single packet exceeds the condensator's
capacity the bound `min(heat, maxHeat - heat)` goes *negative*, so the condensator absorbs a
negative amount — and since it never climbs, it never breaks. Meanwhile `FuelRod.handleHeat()`
**ignores `adjustCurrentHeat`'s return value**:

```java
currentComponentHeating = heat;
for (ReactorItem heatableNeighbor : heatableNeighbors) {
    heatableNeighbor.adjustCurrentHeat(heat / heatableNeighbors.size());   // return discarded
}
```

So the rod's entire heat output is silently destroyed. Measured on
`named-condensator-over-capacity` (The Core rod, 26 880 heat/tick, into an adjacent RSH):

| | today (buggy) | after the fix |
|---|---|---|
| `timeToXplode` | never | **2** |
| `totalEUoutput` | 9 063 808 000 | 0 |
| `maxTemp` | 0 | 26 880 |
| condensator breaks at | tick 938 | tick 1 |

A design that is reported today as *safe, producing nine billion EU* in fact destroys 26 880
heat per tick and cannot ever reach boiling. This is not a rounding error; it is a
**silently wrong safety verdict**, and it is the reason this is P0.

**Fix:** `double acceptedHeat = Math.min(heat, getMaxHeat() - currentHeat);`
⚠️ Two caveats. First, this is inherited verbatim from upstream
`MauveCloud/Ic2ExpReactorPlanner`, so codes may have been *tuned around* the wrong behavior.
Second, the fix is not a one-token change to a one-line bug: the same method also overfills in
the *opposite* direction when `currentHeat` is already high, and the fix should be landed
together with P3-18.

**Measured blast radius** (304-design corpus, see [Testing](#testing)): the fix moves
**exactly 1 design**. 303 designs are byte-identical. Concretely:

| packet regime | effect of the fix |
|---|---|
| small packets, under `maxHeat/2` | no end-to-end change |
| overshoot regime (packet accepted whole, `currentHeat` crosses `maxHeat`) | no end-to-end change — the overshoot amount does not matter |
| packet > `maxHeat` | **catastrophic**, as tabled above |

So the migration impact on published designs is far smaller than feared — but the one case it
does hit is a design class that is currently *misreported as safe*, which makes it worth a
release note rather than a silent patch.

#### ✅ Applied and verified

The bound is now `Math.min(heat, getMaxHeat() - currentHeat)`, and the absorbed-heat counter
(P3-18) accumulates the accepted amount rather than the offered one. Both in one commit, because
they are the same ten lines and fixing only the bound would leave the reporting wrong.

1. **The absorption table is exact.** `CondensatorTest.AbsorptionBound` asserts packet, accepted,
   refused and stored for 4 000 / 10 000 / 20 000 / 29 568 / 40 000 into a fresh RSH, plus a warm
   condensator, a full one, the LZH, and repeated over-capacity packets.
2. **The invariant is restored.** `neverGoesNegativeOrOverCapacity` hammers a condensator with five
   29 568 packets and asserts `0 <= currentHeat <= maxHeat` throughout; it ends exactly at 20 000.
   The corpus self-check asserts the same across all six condensator designs by live simulation.
3. **Corpus containment.** Exactly **1 of 304** designs moved, tagged `condensator`, and its
   `timeToXplode` went from "never" to **2** — the prediction held. 303 byte-identical.
4. **Reported cooling now matches reality.** `coolingNeverExceedsWhatWasStored` absorbs
   10 000 + 19 000 into a 20 000 RSH and asserts the counter reads 20 000, not the 29 000 offered.

**Two of the four contract tests I wrote were wrong** and had to be corrected before the fix could
land. I had conflated "accepts up to capacity" with "accepts in full", so two of them asserted
that a 29 568 packet should be stored whole in a 20 000 RSH, and that an over-capacity packet
should be rejected outright. Both are unachievable: a condensator should fill to capacity and
refuse only the excess. They had sat `@Disabled` since Phase 0, which is precisely the risk a
disabled test carries — it is an unverified claim. **Run a disabled spec against the current
code before you trust its numbers**, even knowing it is expected to fail.

**The corpus self-check was pinning the bug too.** `condensatorPacketsReachEveryRegime` asserted
that a condensator *overfilled* and *went negative* — accurate descriptions of the bug, wrong as
a specification. Both assertions were inverted to check the restored invariant. The packet-size
assertions were kept, since those are properties of the rods.

**Deliberately not changed:** the method returns the *positive* amount refused, the opposite sign
to `ReactorItem.adjustCurrentHeat`'s negative-for-refused convention. No caller reads it (the only
callers for a condensator are `FuelRod.handleHeat` and `Exchanger.transfer`, both of which
discard it), so changing it would be an unrelated behaviour change. The asymmetry is now
documented in the implementation.

**Skipped test count: 3 → 0.** No test in the suite is skipped.

---

## P1 — Crashes and data races

### P1-1 ✅ FIXED — code parsing was neither crash-safe nor all-or-nothing

`setCode()` only caught `NumberFormatException`, so several failure modes escaped as unchecked
exceptions, and a short suffix could leave the grid *applied* with half the mode flags set.

**Originally reproduced, in three ways:**

1. **More than 3 parameters per cell** → `paramNum` indexes `paramTypes[row][col][3]`
   with no check against `MAX_PARAM_TYPES`.
   `01(h1,a2,p3,h4)…|fes` → `ArrayIndexOutOfBoundsException`.
2. **Short `|xxx` suffix** → `extraCode.charAt(1)` / `charAt(2)` read unconditionally, and read
   *after* the grid had been applied. `00…00|f` → `StringIndexOutOfBoundsException` with the
   grid already loaded.
3. **Unclamped `currentHeat` above the 120 000 storage bound** → parsed without limit, so
   `buildCodeString()`'s `storage.store` threw on the *next* `getCode()`.
   `00…00|fes3W0E` → `currentHeat = 181 454` → `getCode()` throws.
   Reachable only by pasting a code — the heat-spinner ceiling is 101 799, measured.
4. **Unsupported code revision** → `readCodeString` threw `IllegalArgumentException` straight
   out of the public `setCode`.

#### ✅ Applied — strict parsing

All three readers (`readLegacyCode`, `readCodeString`, `handleTaloniusCode`) now **parse into
locals and apply only once parsing has fully succeeded**, so a rejected code is
all-or-nothing by construction rather than by careful ordering. Then:

* `setCode` wraps the whole thing in `catch (IllegalArgumentException | IndexOutOfBoundsException)`
  and warns. That covers `NumberFormatException`, bad Base64, too many parameters and a
  truncated suffix, while deliberately *not* swallowing `NullPointerException` and friends —
  those are real bugs, not bad input.
* A fourth parameter is now refused deliberately, with a message naming the cell, rather than
  being left to trip a bounds check.
* `requireEncodable` refuses a legacy value the current writer could not encode — `currentHeat`,
  `onPulse`, `offPulse`, `suspendTemp`, `resumeTemp` — which is what closes path 3. The
  spinner's ceiling makes this unreachable from the UI, so it is a paste-only guard.
* An unsupported revision warns and is refused instead of throwing.
* **The reason is now appended to the warning.** `"Invalid Reactor Code: <code>"` on a
  200-character paste tells the user nothing; appending `e.getMessage()` means the refusals
  say what was wrong. This also makes the deliberate refusals distinguishable from accidental
  ones in the tests.

**Verified:**
* **Corpus: 0 of 304 designs moved.** The restructure is behaviour-preserving for every
  well-formed code, which is the strongest available evidence that nothing else changed.
* Every malformed case now goes through `assertDoesNotThrow` **and** asserts the design is
  byte-identical afterwards, checked against a reactor deliberately loaded with a quad rod,
  plating, fluid/pulsed flags, heat and a custom tick limit.
* Mutation check, 12 cases all caught: removing the blanket catch; applying the legacy grid
  before the suffix is parsed (caught by 3 tests); each of the 5 range checks removed
  individually; the revision guard; the param-count refusal; dropping the reason; the base64
  grid not applied; `currentHeat` not assigned; the Talonius grid not applied; plus the P0-1
  and P0-2 regression guards.

#### A limitation worth stating plainly

Neither code format carries a checksum, so strict parsing can guarantee "never crashes, never
half-applies" but **cannot** distinguish garbage that happens to be well-formed. `"00AF"`
decodes as a Base64 revision-0 payload whose fields all read as zero and loads as a blank
reactor, with nothing to warn about. Recorded in
`ReactorCodeSerializationTest.meaninglessPayloadIsInterpretedNotRefused` so a future attempt
to add an integrity check knows this is the remaining hole.

### P1-2 ✅ FIXED — `AutomationSimulator.completed` is a non-volatile cross-thread flag

**File:** `src/Ic2ExpReactorPlanner/AutomationSimulator.java:92`

```
declared as: private
volatile = false
```

`completed` is written on the SwingWorker thread and read on the EDT via `getData()` from
arbitrary UI events (`ReactorPlannerFrame.java:1962, 2654-2656`). There is no
happens-before edge between those paths, so the comparison feature can permanently observe
`null`. On x86 this usually works, which is exactly why it would go unnoticed.

**Fix:** `private volatile boolean completed;`

#### ✅ Applied and verified

The field is now `private volatile boolean completed = false;` with a comment naming both
threads. **The suite does not catch this and cannot**: a missing `volatile` is a visibility bug,
not a behavioural one, and every test here runs the simulation from one thread's point of view —
removing `volatile` leaves all 490 tests green. The fix is justified by the Java memory model
and by the read/write pairing above, not by a test. Recorded in the mutation table as *not
caught* so nobody mistakes a green run for evidence.

### P1-3 ✅ FIXED — cancellation leaves the simulator in an inconsistent state

**File:** `src/Ic2ExpReactorPlanner/AutomationSimulator.java:318-321`

```java
if (isCancelled()) {
    publish(formatI18n("Simulation.CancelledAtTick", reactorTicks));
    return null;    // skips completed = true, firePropertyChange, elapsed-time publish
}
```

The early `return` skips `completed = true`, the `"completed"` property change that
`ReactorPlannerFrame.java:1990` waits on, and the elapsed-time report.

**⚠️ Correction, measured:** the property change is *not* something SwingWorker fires on our
behalf. A headless probe of JDK 8 `SwingWorker` shows a run emits exactly three events —
`state` (PENDING→RUNNING), our explicit `completed`, `state` (RUNNING→DONE) — and `publish()`
emits nothing per tick. So the missing `firePropertyChange` really is ours, and `getData()`
is the second half of the breakage: the GUI's listener does fire `updateComparison()`, which
then bails at `simulator.getData() == null` (`ReactorPlannerFrame.java:2654`).

**Second measured hazard:** cancelling a SwingWorker *before* its job has started skips
`doInBackground` entirely — `isDone` goes true, `state` goes DONE, and no report line is ever
written. `ReactorPlannerFrame` is safe today because both call sites (`:1967`, `:2110-2111`)
cancel a simulator it has already checked is still running, but it is why the new test waits for
the `RUNNING` event before cancelling rather than cancelling up front.

**Fix:** set `completed = true` and fire the property change before returning.

#### ✅ Applied and verified

The cancel branch now sets `completed = true` and fires `"completed"` before its `return null`.
The elapsed-time report is deliberately **not** added: a cancelled run has no meaningful
simulation duration to report, and the fix scoped itself to the two state updates.

1. **`AutomationSimulatorTest.Plumbing.cancelledRunStillCompletes`** starts a long run, waits for
   the `state` event so the job is genuinely running, cancels, then asserts three things: the
   `completed` event fires, the report contains the `Simulation.CancelledAtTick` line (this is
   what proves the cancel branch was taken rather than the race being lost), and `getData()` is
   non-null.
2. **Corpus containment: 0 of 304 designs moved.** No corpus design is cancelled, so the change is
   invisible to it — which is the point: this fix is about the exit path, not the arithmetic.
3. **Both halves are pinned separately.** Reverting only `completed = true` fails the `getData()`
   assertion; reverting only `firePropertyChange` fails the latch. A half-applied fix cannot slip
   through.

---

### P1-4 ✅🆕 Heat-output units are inconsistent between the total and the per-tick figures

**File:** `src/Ic2ExpReactorPlanner/AutomationSimulator.java`

```java
data.totalHUoutput = 40 * totalHeatOutput;
data.avgHUoutput   =  2 * totalHeatOutput / reactorTicks;
data.minHUoutput   =  2 * minHeatOutput;
data.maxHUoutput   =  2 * maxHeatOutput;
```

The total is scaled by 40 but the average and min/max by 2, so the per-tick figures come out
**20x smaller** than the total implies. Measured on a rod feeding a heat vent (4 heat/tick for
20 000 ticks):

* `totalHUoutput` = 3 200 000, and 3 200 000 / 20 001 = **160 HU/t** implied
* `maxHUoutput`   = **8**, and `avgHUoutput` ≈ 8 — which is what the report prints as
  "…, 8 HU/t max"

The EU path is self-consistent (`totalEUoutput` in EU/tick divided by 20 for EU/t), so the heat
path looks like a copy of it with the wrong divisor. Either the per-tick scale should be 40, or
the total should be 2. Pinned by `AutomationSimulatorTest.Output.fluidReportsHeat` so the
discrepancy cannot change unnoticed.

---

## P2 — Performance (measured)

### P2-1 ✅ FIXED — `ImageIcon` churn: up to 127 throwaway icons per resize event, 54 per keystroke

**File:** `src/Ic2ExpReactorPlanner/ReactorPlannerFrame.java` — 4 sites, **all** of which
call `getScaledInstance(..., Image.SCALE_FAST)` inside `new ImageIcon(...)`:

| site    | context                                    | icons per invocation |
|---------|--------------------------------------------|----------------------|
| `:283`  | button action listener (place a component) | 1                    |
| `:1904` | `plannerResized` — palette                 | **73**               |
| `:1919` | `plannerResized` — reactor grid            | **54**               |
| `:2551` | `updateReactorButtons`                     | **54**               |

`updateReactorButtons()` is invoked from the code-field `DocumentListener`
(`ReactorPlannerFrame.java:360-367`) on **every keystroke**, and `plannerResized` is a
`componentResized` listener that fires continuously while dragging the window — so a single
window drag produces thousands of scaled `BufferedImage`s and, because
`new ImageIcon(Image)` loads asynchronously, thousands of loader threads.

**Fix:** cache scaled images keyed by `(component id, pixel size)` and reuse one
`ImageIcon` instance per button; skip entirely when the computed size is unchanged.

**Applied and verified.** All four sites now go through one helper, `setComponentIcon(button, image,
buttonSize)`, which delegates to a `getCachedIcon(image, size)` lookup. Two deliberate departures
from the wording above:

* The cache is keyed by **image identity**, not component id. `ComponentFactory` prototypes and
  `copy()` share one `java.awt.Image` per component type, so two instances of the same type cost
  one entry — and two *different* types that happen to share a texture correctly share one icon.
* The cache is **bounded** (`ICON_CACHE_LIMIT = 512`, cleared wholesale when reached). A resize
  drag invents a new pixel size per event; unbounded, that retains every intermediate the drag
  produced, which is a slow leak rather than a win.

Measured with a throwaway harness over 54 buttons, JDK 8:

| case                                        | before         | after          |
|---------------------------------------------|----------------|----------------|
| size unchanged (layout passes, keystrokes)  | 1 034 µs/event | **7 µs/event** |
| size changing, textures shared              | 2 729 µs/event | **47 µs/event** |
| size changing, 54 distinct textures (worst) | 1 837 µs/event | 1 501 µs/event |

The third row is honest: when every button holds a different texture *and* the size changes, every
lookup misses and the helper buys ~18 % at best. The win is in the first row, which is the case the
finding describes — repeated events at an unchanged size.

### P2-2 ✅ FIXED — Flat component snapshot in the tick loop — measured **−54 % on a sparse grid**

**File:** `src/Ic2ExpReactorPlanner/AutomationSimulator.java`

Per tick there are **6 unconditional + 1 conditional** 6×9 grid iterations, each going
through the bounds-checked `Reactor.getComponentAt`:

| loop                                  | line | unconditional?            |
|---------------------------------------|------|---------------------------|
| `preReactorTick`                      | 195  | yes                       |
| `generateHeat`/`dissipate`/`transfer` | 207  | yes                       |
| `generateEnergy`                      | 227  | yes (under `if (active)`) |
| CSV row output                        | 283  | conditional               |
| `calculateHeatingCooling`             | 786  | yes (after tick 20)       |
| `handleAutomation`                    | 694  | yes (when automated)      |
| `handleBrokenComponents`              | 579  | yes                       |

**A/B benchmark** (16-component reactor, 2 M ticks each, headless):

```
current  (6 x 6x9 grid loops)     566.2 ns/tick
proposed (flat ReactorItem[])      340.7 ns/tick     -> -40%
```

`Reactor.getComponentAt` costs 3.9 ns/call including the bounds check.

**Fix:** snapshot non-null components into a flat `ReactorItem[]` once per simulation
(rebuilt whenever the grid changes) and iterate that in all seven loops.

**Honest framing:** absolute speed is fine — 566 ns/tick means the default 5 000 000-tick
run takes ~2.8 s. This is a *cheap* 40 % win, not a fix for a user-visible stall.

#### ✅ Applied and verified

Nine loops now walk a flat `ReactorItem[]` snapshot (`tickComponents`) built once per run,
alongside a parallel `int[] tickCell` holding `row * 9 + col` for the loops that report a
position. The seven loops named above were converted plus the two cooldown loops
(`dissipate`/`transfer` and the `needsCooldown` sweep); the four once-per-run loops (CSV
header, the 54-cell init publish, explosion power, post-run summary) were left on
`getComponentAt` because they are not on the hot path.

Two departures from the review's wording:

* The snapshot is taken **once**, not "rebuilt whenever the grid changes". Nothing in the
  simulation calls `setComponentAt`: `handleAutomation` clears heat and damage in place, and
  a broken component stays in its cell. A rebuild hook would have to be called from every
  component, which is more code for no observed benefit.
* The `component != null` guard survives in the two long loops as an explicit `if`, purely so
  the brace structure of those method bodies stayed intact. It is always true and the JIT
  hoists it.

**Measured (A/B, alternating processes, best of 3 per process, 2 M ticks, headless):**

| design | before | after | change |
|---|---|---|---|
| 5 components (quad rod + 4 coolant cells, automated) | 552–591 ns/tick | 244–273 ns/tick | **−54 %** |
| 54 components (same, plus 49 plating) | 1387–1673 ns/tick | 1347–1743 ns/tick | ~−7 %, noisy |

The review's 566 → 341 ns/tick reproduces on the sparse design. On a full grid the win is
single-digit, because the per-tick component work dominates the grid walk there.

**Mutation checks** (each reverted after running the suite):

| mutation | result |
|---|---|
| snapshot built column-major instead of row-major | 1 failed (`CorpusBaselineTest`) |
| `tickCell` dropped, `row`/`col` derived from the loop index in `handleBrokenComponents` | 2 failed (`CorpusBaselineTest`, rod-depletion position) |
| `snapshotGrid()` never called, loops walk an empty snapshot | 31 failed |

Corpus: **0 of 304 designs moved**, which is what was predicted — the snapshot preserves
row-major order, so it changes iteration cost, not arithmetic.

**🆕 Side finding — the cancel test was racing, and P2-2 exposed it.**
`AutomationSimulatorTest > a cancelled run still completes and exposes its data` cancelled
from the test thread immediately after `execute()`. `SwingWorker` skips `doInBackground`
outright when it is cancelled before the job's thread gets going, so that test reached the
cancel branch only by luck, and once the run got faster it stopped reaching it at all. It now
uses a design that genuinely runs long (an automated quad rod with four 10 k coolant cells,
which never boils, capped at 2 000 000 ticks) and sleeps 200 ms before cancelling. There is
no deterministic hook inside `doInBackground`: `SwingWorker.publish(V...)` is *protected* and
only accumulates, which is why a normal run emits three property events rather than one per
published line.

### P2-3 ✅ FIXED — Minor performance sweep — 3 of 5 sub-findings applied, 2 retracted

| # | Finding                                                                                                                                                                    | Evidence                                                      |
|---|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------|
| a | `AutomationSimulator.process()` calls `chunk.matches("R\\dC\\d:.*")` — `String.matches` recompiles the pattern on every call, on the **EDT**                               | `AutomationSimulator.java:597` (single occurrence confirmed)  |
| b | 4 `getI18n(...)` resource-bundle lookups **per CSV row**                                                                                                                   | `AutomationSimulator.java` CSV block, lines confirmed by scan |
| c | `calculateHeatingCooling()` runs every tick after tick 20 but its totals are consumed exactly once, inside `showHeatingCooling()`                                          | read of both methods                                          |
| d | `Exchanger.transfer()` recomputes loop-invariant `mymed`/`getCurrentHeat()/getMaxHeat()` inside the neighbour loop; `getCurrentHeat()` is not mutated until after the loop | `Exchanger.java:69, 96`                                       |
| e | `TextureFactory.getImage` never `break`s out of `ASSET_PATHS` after a hit → up to 8 redundant `ZipEntry` lookups; called 72× at class init                                 | `TextureFactory.java:37-52`                                   |

#### ✅ Applied and verified — (a), (b) and (d) applied; (c) and (e) retracted

**(a) precompile the cell-chunk test — applied, but not with a `Pattern`.**
The Javasharp dialect has no regex class in its class universe: `java.util.Pattern`,
`java.util.RegExp` and four other spellings all fail to resolve, and no source in the repo has
ever imported one. So the test is written out instead, which is both cheaper and class-free:

```
String.matches("R\\dC\\d:.*")   269.6 ns/call
isReactorCellChunk(chunk)         7.3 ns/call   -> 37x cheaper
```

**🆕 The engine's `.` is not the JDK's.** Probed over the seven line separators: this engine's
`.` stops at `\n`, `\r`, `\u0085`, `\u2028` and `\u2029`, but *matches* the vertical tab (`\u000B`)
and form feed (`\u000C`) that the JDK's engine also excludes. The predicate had to be written to
the engine's set, not the documented Java one. `AutomationSimulatorTest.reactorCellChunkTestAgreesWithTheRegex`
pins the two against each other over 21 samples, so the divergence is caught rather than assumed.

**(b) hoist the per-CSV-row bundle lookups — applied.** Six `getI18n(...)` calls per row are
resolved once before the tick loop into `csvTickFormat` … `csvComponentOutputFormat`. Measured
`getI18n` at **5.5 ns/call**, so this removes ~33 ns/tick from a CSV run and nothing elsewhere.

**(d) hoist `mymed` out of the `Exchanger.transfer()` neighbour loop — applied.** `transfer()`
adjusts this component's own heat only at `adjustCurrentHeat(myHeat)` after both blocks, so
`getCurrentHeat()` is loop-invariant. Two mutations were checked: reverting the hoist leaves all
495 green (the change is behaviour-preserving), seeding it from the wrong component fails 25 tests.

**(c) `calculateHeatingCooling` "consumed exactly once" — retracted, it is load-bearing.**
The totals are a running sum over ticks 21..N and `showHeatingCooling` divides by `reactorTicks - 20`,
which is exactly the number of accumulated iterations. Computing it once at the end is a different
number. Confirmed by mutation: changing the divisor to `1` fails `CorpusBaselineTest`.

**(e) `TextureFactory.getImage` missing a `break` — retracted, already guarded.** The inner loop
body is wrapped in `if (result == null)`, so a hit suppresses every later `getEntry` call; the
remaining cost is seven no-op iterations across 72 calls at class init.

**Measured (A/B, alternating processes, best of 3, 2 M ticks, headless):**

| design | before | after | change |
|---|---|---|---|
| quad rod + 4 cells + 8 heat exchangers | 1119–1160 ns/tick | 1072–1093 ns/tick | **−4 %** |
| quad rod + 4 cells, no exchangers | 249–260 ns/tick | 261–299 ns/tick | within noise |

The sweep is small by construction: (a) is off the tick loop, (b) only runs when a CSV file is
open, and (d) is one division and two multiplies per neighbour. The second row is reported as
noise, not as a win.

**Mutation checks:**

| mutation | result |
|---|---|
| digit-range check dropped from `isReactorCellChunk` | 1 failed (`reactorCellChunkTestAgreesWithTheRegex`) — and only after `"RaC2:0"`/`"R1Cb:0"` samples were added; the first sample set did **not** exercise it |
| `csvTickFormat` pointed at the wrong bundle key | 3 failed (all three CSV-shape tests) |
| `Exchanger` hoist reverted | 0 failed — expected, the hoist is behaviour-preserving |
| `Exchanger` hoist seeded from the wrong component | 25 failed (`ExchangerTest` + corpus) |
| `showHeatingCooling` divisor changed to `1` | 1 failed (`CorpusBaselineTest`) — proves (c) is load-bearing |

---

## P3 — Dead code and correctness-adjacent cleanup

### P3-1 ✅ FIXED — `needsCooldown` is never set to `true` — the feature is dead

```
'= true' assignments: 0 | other references: 2
```

`AutomationSimulator.java:33` declares the array; lines 438-440 are the only uses, and they
only *clear* it. The per-component `ComponentInfo.CooldownTime` report can therefore never
appear. Either populate it when a component still holds heat at the end of the main loop, or
delete the field.

#### ✅ Applied and verified

**Populated, not deleted.** The loop that already decides which components to colour orange
(`AutomationSimulator.java:411`) is the one that says "this component still held heat when the
run stopped" — the same condition that appends `ComponentInfo.RemainingHeat` — so the flag is
set there, one line, no extra pass. Deleting the field instead would have orphaned two bundle
strings (`ComponentInfo.CooldownTime` in `Bundle.properties:126` and `Bundle_zh_CN.properties`)
and removed a user-facing tooltip line, so the feature is kept.

The report is *not* unconditional: a component only gets the line when its heat actually reaches
`0.0` while the reactor is still venting. That is what makes the test worth having, and it took
experimentation to find a design that reaches it — a `heatVent` still holding 18 of its 1 000
heat with the reactor warm enough for it to drink:

| design (automated, cap 200 001) | cooldown loop | per-component line |
|---|---|---|
| quad U rod + 3 × `coolantCell10k` + `heatVent` | 3 ticks, exits on vented heat | vent: `Took 3 seconds to cool down.` |
| quad U rod + 4 × `coolantCell10k` | 1 tick (`vented = 0`) | none — cells never empty |
| single U rod + 4 × `coolantCell60k` (manual) | 1 tick (`vented = 0`) | none — 20 000 heat stays |

`AutomationSimulatorTest.Cooling.componentCooldownTimeIsReported` pins both halves: the vent's
info must contain `formatI18n("ComponentInfo.CooldownTime", 3)` **and** the `RemainingHeat` line,
while a coolant cell that keeps 3 024 heat must contain the `RemainingHeat` line and **not** the
cooldown line.

| mutation | result |
|---|---|
| revert the assignment (as shipped) | **1 failed** — exactly the new test |

Clean isolation, unlike P3-3: the flag is the only thing that test reads. Corpus baseline
unmoved — `CorpusRunner` records numeric metrics only, and this change touches no number.

### P3-2 ✅ Stale `lastEUoutput` folded into min/max in the cooldown loop

`AutomationSimulator.java:433-436` — `lastEUoutput` is updated in the *main* loop but not in
the cooldown loop, yet `minEUoutput`/`maxEUoutput` are updated from it there. Idempotent, so
harmless today, but it is copy-paste from the wrong loop.

### P3-3 ✅ FIXED — `getOldCode()` compares `resumeTemp` against `DEFAULT_SUSPEND_TEMP`

`Reactor.java` — `DEFAULT_RESUME_TEMP` and `DEFAULT_SUSPEND_TEMP` are both `120e3` today, so
there is no behavioral difference (verified: `resumeTemp=60000` does emit `|r1aao`). Pure
latent bug; fix while you are in the file.

#### ✅ Applied and verified

`Reactor.java:839` now reads `resumeTemp != DEFAULT_RESUME_TEMP`. One-line change, no behaviour
change today — which is exactly the point, and it is stated rather than hidden:

| mutation | result |
|---|---|
| fix reverted, constants left equal | **0 failed** — the two constants are the same number, so no value can tell the spellings apart |
| `DEFAULT_RESUME_TEMP` moved to `130e3`, fix **reverted** | 18 failed |
| `DEFAULT_RESUME_TEMP` moved to `130e3`, fix **applied** | 17 failed |

The `comm` of those two failure lists is a single line: `legacy hex codes (getOldCode) > the
resume temp is suppressed against its own default`. So the constant bump is not a clean isolation
— it breaks 17 tests that hardcode `120000` as the resume default — but exactly one of them is
discriminating, and it is the assertion written for this fix. The guard is therefore correct and
inert until someone changes one of the two constants.

**Related, not fixed here:** `Reactor.java:728-729` store the same pair through
`storage.store(resumeTemp, (int) 120e3)` with a **literal** rather than the constant, so the
binary code path carries the same latent coupling a third time. Worth a follow-up so the three
sites read one constant.

### P3-4 ✅ FIXED — `catch (Throwable e)` in `doInBackground`

`AutomationSimulator.java` — swallows `OutOfMemoryError`/`StackOverflowError` and dumps the
stack trace into the user-facing `JTextArea`. Narrow to `Exception` (or
`RuntimeException`) and let `Error` propagate; the default uncaught-exception handler already
installed in `main()` will surface it properly.

#### ✅ Applied and verified

`AutomationSimulator.java:562` now reads `catch (Exception e)`, with a comment saying *why*
— a JVM `Error` is not a simulation failure the user can act on, and its stack trace printed
in the report area read as a plausible result.

**The review's last sentence does not hold for this SwingWorker variant, and the fix is shipped
with that correction rather than on top of the claim.** `javax.swing.SwingWorker` here is an
`java.util.concurrent.RunnableFuture`, and `run()` delegates to `FutureTask.run()`, which captures
*any* `Throwable`. Verified with a throwaway `SwingWorker` whose `doInBackground` recursed until
`StackOverflowError`:

| observation | result |
|---|---|
| `get()` after the run | throws `java.util.concurrent.ExecutionException` (this variant has no `ExecutionError` class) |
| `ReactorPlannerFrame` | never calls `get()` — it uses `execute()` + a property listener, so a propagated `Error` is now **silent** in the GUI |

So the narrowing removes a misleading report; it does not add a visible one. That is the honest
net effect, and the residual is recorded under [Gaps worth closing](#gaps-worth-closing).

| mutation | result |
|---|---|
| revert to `catch (Throwable e)` | **0 failed** — not test-observable |

No test can reach the catch: nothing in the suite or the 304-design corpus throws inside
`doInBackground`, and there is no seam to inject an `Error` (the only `catch` inside the `try`
is the inner `IOException` one at `:140`, for the CSV header). Same "not test-observable" status
as the P1-2 `volatile` fixes, which the suite already documents as a gap.

### P3-5 ✅ FIXED — `GGFuelRod` carries three dead members that shadow live `FuelRod` state

```
GGFuelRod.energyMult   : 0 apparent reads outside declaration/copy
GGFuelRod.rodCount     : 0 apparent reads outside declaration/copy
GGFuelRod.GTNHbehavior : declared at :11, assigned at :14 — never read
```

`FuelRod` already declares its own `private final int energyMult` and `rodCount`, and its
`GTNHbehavior` *is* read (lines 177, 208, 217, 289). `GGFuelRod`'s copies are shadowed and
dead; `getRodCount()`/`getEnergy()` resolve to `FuelRod`'s. `GGFuelRod.setGTNHBehavior()`
being called from `gtVersionComboActionPerformed` is misleading — remove all three plus the
setter call.

#### ✅ Applied and verified

All three members deleted, along with the writes that kept them alive-looking:

| site | change |
|---|---|
| `GGFuelRod.java` fields | `rodCount`, `energyMult`, `GTNHbehavior` gone; `heatBonus` kept — it *is* live, via `getHeatBonus()` |
| `GGFuelRod(int id, …)` | the two shadowing assignments gone; the parameters stay, they feed `super(…)` |
| `GGFuelRod(GGFuelRod other)` | the two shadowing copies gone; `super(other)` already carries the live values through `FuelRod`'s own copy constructor |
| `setGTNHBehavior` | deleted — it wrote to a field nothing reads, and `FuelRod.setGTNHBehavior` is the live switch |
| `ReactorPlannerFrame.java` ×4 | the `GGFuelRod.setGTNHBehavior(…)` lines removed; each was paired on the next line with the live `FuelRod.setGTNHBehavior(…)` |
| `CorpusRunner.java` ×4 | same pairing, same removal — so no corpus design's GTNH behaviour changes |
| `TestSupport.java` | `GGFuelRodBridge` and its `resetGlobalConfig()` call removed |

The copy constructor is not a curiosity here: `ComponentFactory.copy(ReactorItem)` dispatches
`new GGFuelRod((GGFuelRod) source)` for every `createComponent(name)` lookup, so that
constructor runs on every component the app or a test creates — which is exactly why deleting
`this.heatBonus = other.heatBonus` would be a real bug.

| mutation | result |
|---|---|
| re-add all three dead members with their writes | **0 failed** — they were dead, so removal is behaviour-preserving |
| `this.heatBonus = other.heatBonus` → `= 0` in the copy ctor | **6 failed** — 5 `PassiveComponentsTest.GGFuelRods` cases *and* `CorpusBaselineTest` |

Corpus baseline unmoved: the removed writes targeted members no expression ever read.

### P3-6 ✅ FIXED 🔍 `CoolantCell` counts negative heat — cosmetic only

`CoolantCell.java:31` — `currentCellCooling += heat` with no sign guard, unlike
`Condensator` which early-returns on `heat < 0`. Measured: `+500, -900, -2000, +300` leaves
`currentCellCooling = -2 100`.

**⚠️ Correction:** the first pass implied reported values were wrong. They are not —
`bestCellCooling` is maintained with `Math.max` so it stays monotonic (`500` in the same
run), and `bestCellCooling` is what the UI actually reports. Only the per-tick
`currentCellCooling` goes negative, and nothing reads it. Downgraded to cosmetic; add the
sign guard for consistency with `Condensator`, or leave it.

#### ✅ Applied and verified

Guarded, rather than left alone — the asymmetry is one line and the guard makes the running
figure agree with the peak that is actually reported:

```java
if (heat > 0.0) {
    currentCellCooling += heat;
    bestCellCooling = Math.max(currentCellCooling, bestCellCooling);
}
return super.adjustCurrentHeat(heat);
```

The `super` call stays outside the guard: the heat adjustment itself must happen whatever its
sign, only the *credit* is conditional. (`CoolantCell.java:35` in the current tree, not `:31` —
the file shifted since the review was written.)

**The "cosmetic" downgrade is now measured, not argued.** The corpus moves **0 of 304 designs**:
no design's `bestCellCooling` — the figure behind `ComponentInfo.ReceivedHeat` and
`Simulation.TotalCellCooling` (`AutomationSimulator:496-499`) — depended on a dipped running
figure. So the review's correction was right, and the guard is a pure consistency fix.

| mutation | result |
|---|---|
| drop the guard (as shipped before) | **1 failed** — `PassiveComponentsTest.coolingCreditIgnoresDraining`, the test that pins the new behaviour |
| drop the `super` call too (`return heat;`) | **35 failed** and **12 of 304** corpus designs move — the delegation is load-bearing, the guard is not |

### P3-7 ⚠️ `plannerResized` calls `setSize()` from inside its own `componentResized` handler

`ReactorPlannerFrame.java:1889-1899` — resize-feedback / flicker risk, and it runs the
127-icon rebuild from P2-1 on every event. Guard on an actual size change.

### P3-8 ✅ FIXED 🔍 `TextureFactory` classpath fallback only tries `imageNames[0]`

`TextureFactory.java:61-69` — the zip branch iterates *all* fallback names, the classpath
branch only `imageNames[0]`. Asymmetric: a texture whose first name is absent from the jar
but whose second name is present will silently render blank. Make both branches iterate the
full list.

#### ✅ Applied and verified — no calculation touched

Made the classpath branch iterate every name, with the same loop nesting as the zip branch:

```java
for (String imageName : imageNames) {
    for (String asset_path : ASSET_PATHS) {
        if (result == null && TextureFactory.class.getResource("/" + asset_path + imageName) != null) {
            try (InputStream stream = TextureFactory.class.getResourceAsStream("/" + asset_path + imageName)) {
                result = ImageIO.read(stream);
            } catch (IOException ex) { /* unchanged */ }
        }
    }
}
```

**Nothing in the simulation reads an image**, so this is a display-only change. `image` is read
only by `ReactorPlannerFrame` (`:295`, `:1971`, `:1983`, `:2610`, every one guarded by `!= null`) and
shared by the copy constructor (`ReactorItem.java:237`); the corpus fingerprint is metrics only
(`completed`, `totalReactorTicks`, `timeToBurn`, …). The corpus is therefore unmoved *by construction*,
not by luck.

Latent for the components this repo actually builds: all **69 asset names are primary names**, so
`imageNames[0]` always resolves and the second name is never reached. The asymmetry bites a real
jar that carries the base IC2 item textures (`uranium.png`, `heat_storage.png`) rather than the
reactor-plating names — which is why the new tests drive it with a name pair.

| mutation | result |
|---|---|
| revert to the shipped `imageNames[0]` loop | **1 failed** — `missingPrimaryFallsBackToTheNextName` |
| iterate all names but nest path-outer (the other reading of "make both branches iterate") | **0 failed** — not observable here: all 69 assets are 16×16 and `java.awt.Image` exposes no pixel data, so no test can tell which of two present names won. The zip branch's name-outer nesting is the tie-break and is mirrored deliberately |
| corpus after the fix | **0 of 304 designs move** — images are not in the fingerprint |

Suite is now **502 passed / 0 failed** (three tests added in a new `TextureFactoryTest`).

### P3-9 ✅ FIXED 🔍 `MaterialsList.getMaterialsForComponent` can return `null` → `NullPointerException`

Verified all **72 components have entries (0 missing)**, so this is latent, not live. But
`Reactor.getMaterials()` does `result.add(getMaterialsForComponent(...))` with no null
check, and `add(Object...)` throws `NullPointerException` on a null element. Adding a
component without a recipe entry crashes the GUI; a null guard turns it into a missing
ingredient.

#### ✅ Applied and verified

Guarded **at the call site**, leaving both the producer and `add()` untouched:

```java
ReactorItem component = getComponentAt(row, col);
if (component != null) {
    MaterialsList recipe = MaterialsList.getMaterialsForComponent(component);
    if (recipe != null) {
        result.add(recipe);
    }
}
```

(The old code called `getComponentAt(row, col)` twice for the same cell; the local is what the
guard needs, so the double lookup disappears with it.)

**The guard location is pinned, not chosen by taste.** The obvious alternative — swallow the null
inside `add(Object...)` — breaks an existing test: `MaterialsListTest.aggregation`, "a null material
throws a NullPointerException naming the arguments". `add()`'s strictness is deliberate and already
asserted, so the only place the guard can go is the one caller that has no recipe. `getMaterialsForComponent`
keeps returning `null` as the honest "no entry" signal for callers that want to ask.

The new test has to build an unbuildable component by hand (`new Vent(99, "noSuchComponent", ...)`)
because every factory component has an entry — which is itself the pin on "0 missing".

| mutation | result |
|---|---|
| make the guard always true (the unguarded original) | **1 failed** — `ReactorTest.unknownComponentIsSkipped`, at the `getMaterials()` line |
| move the guard into `add()` instead (swallow nulls) | **1 failed** — `MaterialsListTest.aggregation`, i.e. the alternative fix is rejected by an existing assertion |
| corpus after the fix | **0 of 304 designs move** — `getMaterials()` is not in the corpus fingerprint, and no design has a missing recipe |

Suite is now **497 passed / 0 failed** (one test added).

### P3-10 ✅ FIXED 🔍 `handleTaloniusCode` threw `HeadlessException` out of `setCode`

`Reactor.handleTaloniusCode` declared `throws HeadlessException` (via `JOptionPane`) and
`setCode` neither declared nor caught it. Harmless in the GUI, but it made the class unusable
headless, which blocked headless regression testing.

**Fixed** by routing both of `setCode`'s warnings through a new `WarningDisplay` seam and dropping
the declaration. The Talonius test in `ReactorCodeSerializationTest` no longer needs reflection,
and `WarningDisplayTest` covers the sink itself — including that `setSink(null)` restores the
dialog, so a failing test cannot leave warnings silently discarded for the rest of the JVM.

### P3-11 🔍 Non-volatile global mutable config read across threads

`FuelRod.GT509behavior`, `FuelRod.GTNHbehavior`, `Reflector.mcVersion`,
`MaterialsList.gtVersion`, `MaterialsList.componentMaterialsMap` and the **public mutable**
`MaterialsList.basicCircuit` / `advancedCircuit` / `alloy` / `coolantCell` /
`iridiumPlate` are written on the EDT (version-combo handlers, which rebuild
`componentMaterialsMap`) and read from the simulation thread. Same visibility concern as
P1-2. Low impact in practice since the simulation runs on a separate `Reactor`, but the map
rebuild is a genuinely visible risk.

### P3-12 ✅ FIXED 🔍 `ReactorItem.setAutomationThreshold` / `setReactorPause` accept any value

`ReactorItem.java` — no clamping, despite spinners bounding them to
`[0, Reactor.MAX_COMPONENT_HEAT]` and `[0, 10e3]`. A code carrying a negative or
out-of-range threshold is honored, and `handleAutomation()` compares against it directly.
Consider clamping on read.

#### ✅ Applied — split in half, because the two halves are not the same problem

**The review's suggested bound is wrong for the threshold, and the pause is the real bug.**
Measured before changing anything:

| probe | result |
|---|---|
| `setAutomationThreshold(5e8)` → `getCode()` → `setCode()` | **exact** — 40 000, 1 000 000, 1 080 000, 2 000 000 and 5e8 all round-trip |
| `setReactorPause(500_000)` → `getCode()` | **throws** a bare `IllegalArgumentException` from `BigintStorage.store` (`Reactor.java:758`, bound `(int) 10e3`) |
| legacy code `(p100000)` | loads **pause = 60 466 176** and the simulation honours it (`pauseTimer = max(pauseTimer, pause)`) → the design runs to the tick cap and reads as safe |
| legacy code `(p7rk)` | pause = 10 064 — already past the spinner/format bound, loads fine |
| a negative from any reader | **unreachable**: the legacy regex is `[0-9A-Za-z(),|]+` (no `-`), `BigintStorage.extract` is non-negative by construction, and every spinner is bounded |

**`automationThreshold` is bounded only below.** It is compared against current heat on one
automation path (`AutomationSimulator:746-759`) and against current damage on another
(`AutomationSimulator:773`, guarded by `maxDamage > 1`), so the field serves two scales and has
**no single meaningful upper bound**. A rev-4 code legitimately carries a threshold up to 1e9 —
the writer stores it with that bound — so clamping to `Reactor.MAX_COMPONENT_HEAT` (1.08e6) would
silently rewrite legitimate values, and a threshold above a component's own capacity is coherent
intent ("never automate this part"). Only the lower bound is applied, and it is recorded as
**latent insurance**: no reader or spinner can produce a negative today.

**`reactorPause` is bounded to `[0, 10e3]`, and that bound is unambiguous** — the writer
(`store(pause, (int) 10e3)`), the reader (`extract((int) 10e3)`) and the GUI spinner
(`SpinnerNumberModel(0, 0, 10000, 1)`) all agree on it. The legacy reader applies its `p`
parameter with **no bound at all** (`Reactor.java:434-441`), which is what makes the hazard live.

```java
if ((maxHeat > 1 || maxDamage > 1) && value >= 0) {
    automationThreshold = value;
}
...
if ((maxHeat > 1 || maxDamage > 1) && value >= 0 && value <= (int) 10e3) {
    reactorPause = value;
}
```

**Refused rather than clamped**, mirroring `setInitialHeat` in the same file (`value >= 0 && value < maxHeat`
also refuses). Refusing keeps the getter/setter pair symmetric and keeps every stored value in range,
which is what kills both the `getCode()` throw and the 60-million-tick pause; clamping would invent a
value the user never asked for.

| mutation | result |
|---|---|
| drop the pause bound entirely (the shipped bug) | **1 failed** — `pauseBeyondTheCodeBoundIsRefused` |
| clamp instead of refusing (`Math.max(0, Math.min(value, (int) 10e3))`) | **1 failed** — the same test, at "not clamped down to it" / "not clamped up to zero", so the test pins *refuse*, not merely *bound* |
| drop the threshold lower bound | **1 failed** — `thresholdIsBoundedOnlyBelow` |
| corpus after the fix | **0 of 304 designs move** — every corpus threshold is `random.nextInt(60_000)` or `2000`, and no corpus design sets a pause |

Suite is now **499 passed / 0 failed** (two tests added).

### P3-13 ✅ FIXED 🆕 `Vent.getVentCoolingCapacity()` dereferences `parent` without a null check

**File:** `src/Ic2ExpReactorPlanner/components/Vent.java:92`

```java
public double getVentCoolingCapacity() {
    double result = selfVent;
    if (sideVent > 0) {
        ReactorItem component = parent.getComponentAt(row - 1, col);   // parent may be null
```

Only `componentHeatVent` has a non-zero `sideVent`, so an **unplaced** `componentHeatVent`
throws `NullPointerException` from either `getVentCoolingCapacity()` or `producesOutput()`.
The GUI only ever asks placed components, so this is latent rather than live — but it is exactly
the trap a refactor falls into if it starts querying `ComponentFactory` prototypes for tooltips
or for the palette. Vents with `sideVent == 0` return before touching `parent` and are safe.
Pinned by `VentTest.unplacedSideVentThrowsOnVentCoolingCapacity`.

#### ✅ Applied and verified

Guarded, and the value is the one the method already computes: an unplaced vent has no
neighbours to cool, so its side-vent contribution is 0 and the capacity is just `selfVent`.

```java
if (sideVent > 0 && parent != null) {
```

**This commit deliberately flips a test expectation.** `unplacedSideVentThrowsOnVentCoolingCapacity`
pinned the *throwing* behaviour, which was only a pin on the bug. It is replaced by
`unplacedSideVentIsQueryable` — DisplayName "an unplaced side-venting vent is queryable but not
runnable" — which pins the new answer (`getVentCoolingCapacity()` → 0, `producesOutput()` → false,
matching a *placed* vent with nothing coolable beside it) and keeps one `assertThrows` on the
boundary that must **not** be widened: `dissipate()` still needs a reactor, because it is an
action on the reactor rather than a query about it.

| mutation | result |
|---|---|
| revert to `if (sideVent > 0)` | **1 failed** — `unplacedSideVentIsQueryable` |
| also guard `dissipate()` (`if (parent == null) return 0.0;`) | **1 failed** — the same test, via its `assertThrows` line |
| corpus after the fix | **0 of 304 designs move** — the guard only changes what an *unplaced* vent reports, and the simulation never queries one |

### P3-14 ✅🆕 `Plating` is the only component type with no tooltip override

`ReactorItem.formatTooltip()` returns `null` by default and `Plating` does not override it, so
all three platings return `null`. `ReactorPlannerFrame.buildTooltipInfo` depends on catching the
resulting `NullPointerException` and falling back to a bare name — an exception-driven code path
that is easy to break. Pinned by `ComponentFactoryTest.onlyPlatingLacksATooltip`.

### P3-15 ✅ FIXED 🆕 Overfill refusal in `adjustCurrentHeat` is off by one

**File:** `src/Ic2ExpReactorPlanner/components/ReactorItem.java`

```java
if (tempHeat > getMaxHeat()) {
    result = getMaxHeat() - tempHeat + 1;
```

For an overflow of **N** heat this reports **−(N − 1)** rather than −N: filling a 60 000 cell
that is 1 000 over returns −999. Underflow is exact (`result = tempHeat`). Harmless today
because callers only test the sign, but it means the refusal value is not the amount refused.
Pinned by `ReactorItemTest.AdjustCurrentHeat.clampsToTheCapacityRange`.

#### ✅ Applied and verified

`result = getMaxHeat() - tempHeat;` — the refusal is now exactly the amount not accepted.

**The review's "callers only test the sign" is wrong in a way that matters.** No caller tests the
sign either. Every call site discards the return value (`FuelRod.handleHeat`/`handleGTHeat`,
`Exchanger.transfer`, `Vent:53/54/58`) **except** `Vent.handleSideVentCooling:78`, which does
`double rejectedCooling = coolableNeighbor.adjustCurrentHeat(-sideVent);`. That call only ever
passes a *negative* adjustment, which takes the exact underflow branch (`result = tempHeat`), so
the `+ 1` never reaches it. That is why the corpus is unmoved — the finding is a reporting bug in
a value nothing consumes, not a calculation bug.

| mutation | result |
|---|---|
| revert to `+ 1` | **2 failed** — `ReactorItemTest.clampsToTheCapacityRange` and `PassiveComponentsTest.overfillReportsNegativeRefusal`, both updated to −41 000 / −10 000 |
| corpus after the fix | **0 of 304 designs move** — as predicted above |

### P3-16 ✅ RETRACTED 🆕 A broken component's `adjustCurrentHeat` becomes an unclamped pass-through

`ReactorItem.adjustCurrentHeat` guards on `isHeatAcceptor()`, which is `maxHeat > 1 &&
!isBroken()`. Once a component reaches its capacity it is *broken*, so the guard fails and the
method returns `heat` **unchanged**, with no clamping at either end. So
`adjustCurrentHeat(-61 000)` on a full 60 000 cell returns −61 000 and leaves the stored heat at
60 000, rather than returning −1 000 and clamping to zero. Not reachable from the current GUI
(callers select neighbours before offering heat, and a broken cell is skipped by the caller's
`isBroken()` check), but it is a sharp edge: "clamped to [0, maxHeat]" is only true while the
component is unbroken. Pinned by `ReactorItemTest.brokenComponentPassesAdjustmentsThrough`.

#### ✅ Verified intentional — the guard stays

Two claims in the finding are wrong, and the second one decides the outcome:

* **"Not reachable from the current GUI" is false.** The self-adjustments skip the caller's
  `isBroken()` check entirely — `Vent:54 this.adjustCurrentHeat(deltaHeat)`, `Vent:58
  adjustCurrentHeat(-currentDissipation)`, `Exchanger:130 adjustCurrentHeat(myHeat)`. The corpus
  confirms it: relaxing the guard moves **4 of 304 designs**, every one of them tagged
  `cell, rod, vent`.
* **The pass-through is not a bug, it is the game's rule.** A component that reaches capacity is
  broken and stops working; a broken coolant cell cannot be revived by cooling it. "Broken ⇒
  accepts nothing, stores nothing, reports the whole adjustment as refused" is self-consistent —
  and the method's own `@return` comment already contemplates "breaking due to excessive heat".
* **The direction of the change is the wrong way round for a planner.** Relaxing the guard makes
  full cells drainable, so the reactor stops entering the failure state and designs that currently
  report as overheating start reporting as safe:

  | design | before | after relaxing the guard |
  |---|---|---|
  | `gen-078` | burns at 521 s, `maxTemp` 10 010 | runs the full 4 000-tick cap, `maxTemp` **24** (never heats at all) |
  | `gen-090` | explodes at 128 s, first component broken at 62 s | never breaks, `tXplode` INT_MAX |
  | `gen-021` | `tLava` 79 s, `maxTemp` 12 251 | `tLava` 84 s, `maxTemp` 11 459 |

  A planner that calls an overheating design safe is worse than one that reports it correctly —
  this is the same class of harm P0-2 turned into a *safety* verdict, in the opposite direction.

So the finding is closed by **documenting** the pass-through instead of removing it: the guard
site carries a comment saying broken means "accepts nothing" and citing the corpus cost, and
`ReactorItemTest.brokenComponentPassesAdjustmentsThrough` is strengthened to say the same. The
test already pinned the behaviour; it now also pins *why* it must not be "fixed".

| mutation | result |
|---|---|
| relax the guard to `maxHeat > 1` (the review's fix) | **3 failed** — `ReactorItemTest.brokenComponentPassesAdjustmentsThrough`, `VentTest.a broken neighbour refuses the vent even though isCoolable() is still true`, **and** `CorpusBaselineTest` (4 of 304) |

### P3-17 ✅🆕 `GGFuelRod.getHeatBonus()` shadows the global GT5.09/GTNH bonus entirely

`GGFuelRod` overrides `getHeatBonus()` to return a per-rod field, so it never consults the 1.5
that `FuelRod` returns in GT5.09 and GTNH mode. Consequence: flipping the GT version changes a
vanilla mox rod's output but **not** a compressed- or liquid-plutonium rod's, even though those
rods carry their own bonus (6 and 2 respectively). The per-rod value is only consulted for mox
rods; the six non-mox variants all carry 0. If the per-rod bonus is meant to be an *additional*
modifier, the override needs to compose with the global one instead of replacing it.
Pinned by `PassiveComponentsTest.GGFuelRods`.

### P3-18 ✅ FIXED (with P0-2) 🆕 `currentCondensatorCooling` counted heat *offered*, not accepted

A second, reporting-side consequence of P0-2: `Condensator.adjustCurrentHeat` adds the requested
heat to `currentCondensatorCooling` *before* working out how much it can take, so a nearly-full
condensator reports full credit for heat it then refuses. Measured: after 10 000 + 19 000 into an
RSH it reports 29 000 of "received heat" while only 11 000 was stored. Fixing P0-2 does **not**
fix this; the accumulation needs to move after the acceptance is computed.
Pinned by `CondensatorTest.coolingNeverExceedsWhatWasStored`.

### P3-19 ✅🆕 `SimulationData`'s output totals are only filled in for non-exploding runs

Not a crash, but a trap for anyone reading the data: in `AutomationSimulator` every output
field (`totalReactorTicks`, `totalEUoutput`, `avg/min/maxEUoutput`, `totalHUoutput` and the
matching HU fields) is written only inside the "did not explode" branch. For a design that
explodes they all stay at their zero defaults, while `timeToBurn` / `timeToXplode`, `maxTemp`
and the broken/depleted details *are* populated. The GUI's comparison view therefore shows
zeros for exploding designs rather than "not applicable". Pinned by
`AutomationSimulatorTest.Output.explodingRunsLeaveOutputTotalsAtZero`; decide whether to
populate them for exploding runs too.

---

## ✔️ Checked and cleared — *not* bugs

Recorded so these are not re-investigated.

| Check                                                 | Result                                                                                                                                                                                                                                                                                                                        |
|-------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `BigintStorage` code round-trip                       | Byte-identical for a mixed 7-component reactor; `heat=4321`, `maxTicks=123456`, `fluid`, `automated` all survive                                                                                                                                                                                                              |
| `120e3` storage boundary                              | **Not** a bug. `store()` is inclusive (`value > max` throws), so `currentHeat = 120000` is fine. ⚠️ First pass speculated it threw — retracted; the real trigger is the unclamped legacy-code heat in P1-1                                                                                                                    |
| `Plating.addToReactor`/`removeFromReactor` accounting | Correct. Same instance placed in two cells still counts once (+1 700, not +3 400); `clearGrid()` restores exactly 10 000 — no leak                                                                                                                                                                                            |
| UI-reachable `maxHeat` ceiling                        | 101 800 max, so the 120 000 code bound is unreachable from the heat spinner                                                                                                                                                                                                                                                   |
| `FuelRod.handleHeat` remainder distribution           | Correct integer div/mod distribution to neighbours                                                                                                                                                                                                                                                                            |
| `handleTaloniusCode` warnings                         | Correct behaviour; only the exception type is a problem (P3-10)                                                                                                                                                                                                                                                               |
| `ArrayList` allocation in the tick hot path           | ⚠️ **First pass over-emphasised this.** 32 B/call measured in isolation, but **0 B/tick** at steady state with full inlining — JIT escape analysis eliminates them. Real in source, immaterial in practice. Only `componentHeatVent` (`sideVent = 4`) allocates in `Vent.dissipate`; the other four vents have `sideVent = 0` |
| `getMaterialsForComponent` NPE                        | Latent only — all 72 components covered (P3-9)                                                                                                                                                                                                                                                                                |
| `minEUGenerated` / `minHeatGenerated` reset to `Double.MAX_VALUE` | Correct, and deliberate: re-arming the minimum to `Double.MAX_VALUE` means the next real value automatically becomes the new minimum. Resetting them to 0 would be the bug.                                                                                                                                                       |
| `getComponentList()` returns one line per component | It *aggregates* like `getMaterials()`, e.g. two rods render as a single `2 Fuel Rod (Uranium)`. Assumed otherwise at first; it is what the GUI shows.                                                                                                                                                                             |
| `Reflector.getMaxDamage()` dividing by 3 on 1.7.10  | Correct and intentional. `maxDamage == 1` components (iridium reflector) are excluded, so indestructible parts stay indestructible                                                                                                                                                                                   |
| `MaterialsList` rounding counts to 2 decimals      | By design: `UI.MaterialDecimalFormat` is `#,##0.##`. Only the rendered text rounds; the stored value keeps full precision                                                                                                                                                                                                       |
| `Plating` being the only type without a tooltip     | Verified consistent, but see P3-14 — the frame depends on catching the resulting `NullPointerException`                                                                                                                                                                                                                       |

---

## Phase 0 — the corpus (done)

The differential baseline described under [Testing](#testing) is in place: 304 designs,
`testResources/corpus-baseline.txt`, and a gate that reports the containment signal for any
change. It exists so steps 1 and 2 below can be made safely, and it has already paid for
itself — it is what turned P0-2 from "under-absorbs a little" into "misreports an exploding
design as safe".

## Recommended order of work

1. ~~**P0-1** `Exchanger`~~, ~~**P0-2** `Condensator`~~ and ~~**P1-1** code parsing~~ — **all done
   and verified**; see their sections above. No test in the suite is skipped any more.
2. ~~**P1-1** code parsing~~ — **done and verified**; see above. Nothing skipped remains.
3. ~~**P2-1** `ImageIcon` caching~~ — **done and verified**; see above. The cache is pinned by four
   new tests through a static seam; the memo itself is not observable and is recorded as such.
4. ~~**P2-2** flat component snapshot~~ — done, measured −54 % on a sparse grid (see P2-2).
5. ~~**P1-2 / P1-3** `volatile` + cancel path~~ — **done and verified**; see above. The `volatile`
   half is not test-observable, which is stated rather than hidden.
6. ~~**P1-4** decide the heat-unit divisor~~ — **skipped**; re-evaluated as a false positive on the
   arithmetic, leaving only the `HU/t` / `EU/t` bundle label to check against upstream.
7. ~~**P2-3** minor sweep~~ — **done and verified**; see above. (c) and (e) retracted as false positives.
8. **P3 sweep** — ~~`needsCooldown`~~ (P3-1), ~~the dead `GGFuelRod` members~~ (P3-5),
   ~~`catch (Throwable)`~~ (P3-4), ~~the overfill refusal~~ (P3-15), ~~the `CoolantCell` sign
   guard~~ (P3-6), ~~the `Vent` null `parent`~~ (P3-13) and ~~the `getMaterials()` null recipe~~
   (P3-9) are **done**; P3-16 is **retracted** (the pass-through is the game's rule, and relaxing
   it makes 4/304 designs look safe). ~~the setter bounds~~ (P3-12) are **done** — the pause is
   bounded to the range the code format can carry, the threshold only below, since it serves the
   heat and the damage scale at once. ~~the `TextureFactory` fallback loop~~ (P3-8) is **done** —
   display-only, no calculation touched, pinned by a new `TextureFactoryTest`.
   Remaining in this item: the stale `lastEUoutput` and `plannerResized`.
9. ~~**P3-3** `getOldCode()` default~~ — **done and verified**; see above. Latent today, pinned by
   an assertion that only bites once the two constants diverge.

## Testing

A 494-test JUnit 5 suite now lives in `test/Ic2ExpReactorPlanner/**`, plus a **304-design
simulation corpus** that acts as a differential baseline. Both exist so the work above can be
done without breaking things, and they are written to be kept rather than thrown away.

### The corpus: a differential baseline for calculation changes

Unit tests pin individual formulas, but they cannot answer the question you actually have when
changing one: *"which of my designs did this move, and is that the set I expected?"* The corpus
answers it.

`test/Ic2ExpReactorPlanner/corpus/` builds **304 reactor designs** — every component alone,
~30 hand-built cases aimed at the known bugs, and 200 seeded pseudo-random layouts — simulates
each, and records a 36-field fingerprint plus a SHA-256 of the whole run report. The committed
result lives in `testResources/corpus-baseline.txt`, one line per design, so reviewing a change
is `git diff` on text.

```bash
./gradlew test                                  # gate: any drift fails the build
./gradlew test -Derp.writeBaseline=true         # deliberate regeneration
```

**The gate is expected to fail whenever a calculation change is intentional.** It is an alarm,
not a verdict. When it fires, the failure message gives you the containment signal first:

```
Corpus baseline mismatch: 12 of 304 design(s) differ

EVERY changed design is tagged: [rod, exchanger]
SOME changed designs also carry: [cell, vent, plating, fluid]
  -> If your prediction was "only <tag> designs move" and that tag is not
     in the EVERY line, the change reached something you did not predict.
```

Validated against the two real fixes:

| fix | designs changed | every changed design is tagged |
|---|---|---|
| P0-1 exchanger | 12 / 304 | `rod, exchanger` ✓ |
| P0-2 condensator | 1 / 304 | `reflector, condensator, rod` ✓ |
| both | 13 / 304 | `rod` only — the two sets are disjoint ✓ |

**Rules for using it.** Never regenerate without reading the diff; the baseline is only a guard
if someone actually looks. One fix per commit, so a surprising diff is bisectable. And the
report lists *co-occurring* tags, not causation — a design appears under every tag it has, so
"condensator" appearing in a P0-1 diff means a condensator happened to share those designs, not
that condensator logic moved.

**Two corpus lessons worth knowing.** The exchanger designs are *representative*, not
cascade-band cases: an exchanger is fed by its neighbour and reaches equilibrium within a couple
of ticks, so an initial charge is a transient that washes out. Five designs differing only in
initial charge produced byte-identical results, so they were replaced with five structurally
distinct ones. The band table itself is pinned by `ExchangerTest`, which is where a per-tick
property belongs. Separately, the corpus is deliberately locale-pinned and locale-formatted, and
completion is detected via the `completed` property-change latch rather than by reading
`AutomationSimulator.getData()` — because `completed` is non-volatile (P1-2) and has no
happens-before edge with the worker thread.

### Running it

```bash
./gradlew test                       # the whole suite
./gradlew test --tests '*FuelRod*'   # one class or nested class
```

Two environment notes:

* **Gradle 7.6 cannot run on Java 21+.** The `JAVA_HOME` on this machine points at JDK 21, so
  the wrapper dies with `Unsupported class file major version 65`. Use a Java 8/11/17/19 JDK:

  ```bash
  JAVA_HOME="/c/Program Files/Java/jdk1.8.0_202" ./gradlew --offline test
  ```

* **Spotless is a no-op in a checkout without Blowdryer's shared config.** ⚠️ *An earlier draft of
  this note claimed the new test sources "will almost certainly be reflowed" by
  `./gradlew spotlessApply`. That was wrong, and is corrected here.* Measured:

  ```
  spotlessJava: target = []          # no Java files configured
  ```

  Deliberately appending misformatted Java to `src/Ic2ExpReactorPlanner/BigintStorage.java`
  still produced `spotlessCheck: BUILD SUCCESSFUL`. The `gtnhShared` directory that
  `Blowdryer.file('spotless.gradle')` points at is not present, so the plugin is applied with
  no Java target at all. `spotlessApply` runs, reports "9 actionable tasks: 9 up-to-date" and
  changes nothing.

  So formatting here is **unverified, not verified-good** — for the pre-existing code as much
  as for the new tests. Run `./gradlew spotlessApply` where network is available before
  pushing, and do not treat a local green `spotlessCheck` as evidence of anything. Note the CI
  workflow has a step that runs `spotlessApply` and pushes the result, so if the target *is*
  configured there, the diff will be produced by CI rather than rejected by it.

### Layout

| File | What it locks down |
|---|---|
| `TestSupport` | Shared fixtures: global-config reset, grid helpers, headless simulation driver, materials-list parser. |
| `SmokeTest` | Proves the test source set, the JUnit platform and the `processAssets` resource classpath are wired up. |
| `components/FuelRodTest` | Heat/EU formulas across 0–4 neutron neighbours for 7 representative rods; GT5.09 and GTNH modes; heat splitting; depletion; mox. |
| `components/ExchangerTest` | The cascade tier table for both the reactor block (scales by `switchReactor`) and the side block (scales by `switchSide`), the "never exceeds capacity" invariant, the unchanged hot path, and reported capacities. |
| `components/CondensatorTest` | The absorption bound, RCI thresholds, offered-vs-accepted reporting. Includes `@Disabled` contract specs. |
| `components/VentTest` | Self venting, hull draw, side spreading, refusal semantics, reported capacities. |
| `components/PassiveComponentsTest` | Coolant cells, reflectors (incl. 1.7.10 scaling), breeder cells, plating accounting, GoodGenerator rods. |
| `ReactorItemTest` | Base-class defaults, settings guards, heat clamping, classification, per-tick reset, no-op hooks. |
| `ReactorTest` | Grid bounds, heat accumulator, mode flags, materials aggregation. |
| `ReactorCodeSerializationTest` | Round-trips every one of the 72 components, a full 54-slot layout, all mode combinations, code revisions 0–4, the legacy hex format, Talonius codes, and every malformed-input case. |
| `AutomationSimulatorTest` | End-to-end: determinism, heating to explosion, output totals, cooling, pulsed/automated/fluid modes, coolant injectors, explosion power, depletion, CSV output. |
| `MaterialsListTest` | Recipe aggregation, every component has a recipe, GT-version and flag variants, comparison rendering. |
| `ComponentFactoryTest` | The id/name registries, copy-on-create, subclass preservation, tooltip coverage. |
| `BigintStorageTest` | Field packing order, bounds checking, Base64 round-trip. |
| `ReactorPlannerFrameMappingTest` | The register-name mapping, and that every tooltip label resolves to a real component. |
| `corpus/Corpus` | The 304-design corpus definition, plus a self-check that the design list is stable. |
| `corpus/CorpusRunner` | Runs one design headlessly and captures its 36-field fingerprint and report hash. |
| `corpus/BaselineStore` | Reads, writes and diffs `testResources/corpus-baseline.txt`. |
| `corpus/CorpusBaselineTest` | The differential gate, plus determinism, coverage and per-regime self-checks. |

### Design notes

**Expected values are derived independently, not snapshotted.** Where a formula is derivable
from the IC2 rules it is re-derived inside the test
(`pulses = neighbours + 1 + rodCount / 2`, `heat = heatMult * pulses * (pulses + 1)`), so the
test and the implementation cannot drift together. This caught several errors in *my own*
first-draft expectations — the dual and quad rod heat curves, `thorium`'s `heatMult` of 0.5,
coaxium's `heatMult` of 0, and the GTNH energy formula's integer `rodCount / 2` — in every case
the implementation was right and my arithmetic was not.

**Invariants plus a few golden values.** The simulation tests lean on relationships any correct
implementation must satisfy (determinism, "more cooling survives longer", "pulsing makes less
EU", "automation keeps cells from breaking", heat is conserved across a split) with only
hand-checkable golden values on top. A bare rod makes 4 heat/tick, the hull holds 10 000 and
rods have 20 000 durability, so tick counts like 2 500, 167, 417 and 522 are all derivable by
hand.

**Known-bug handling.** For P0-2 the suite pins *current* behaviour in clearly named
`Current…` tests and states the *intended* behaviour in `@Disabled` contract tests that
reference this document. Fixing the bug flips them over: the characterisation tests fail, the
contract tests pass, and the skipped count drops. **0 tests are currently skipped** — the
`CondensatorTest.IntendedBound` trio went live when P0-2 landed. P0-1 already went through this
cycle, which is why `ExchangerTest` now has no `Current…` or `@Disabled` remnants.

**Global static state.** `FuelRod.GT509behavior`, `Reflector.mcVersion`, the `MaterialsList`
version flags and friends are process-wide. `TestSupport.resetGlobalConfig()` runs in both
`@BeforeEach` and `@AfterEach` of every test class, so no test can depend on another's ordering.

**Headless simulation.** `AutomationSimulator` is a `SwingWorker` taking a `JTextArea` and a
`JPanel[][]`; both are `JComponent`s and construct with no display, so the whole simulator runs
headless. One wrinkle to keep in mind: `SwingWorker.get()` returns before the `publish` batches
have been rendered, so `TestSupport.awaitCompletion()` waits for the final report line before
reading the text. Any new test asserting on report text must do the same.

### Does it actually catch regressions?

The suite was validated by mutation testing: 13 bugs injected into `src/` one at a time, with
`src/` restored after each. **All 13 were caught.** Re-run after each fix, all were still caught; 14 further rows were
added as the fixes landed — single-tier partial reverts, the over-correction, four P0-2 variants,
the P1-1 parsing cases, and the P1-3 cancel-path cases. A full run takes about 20 seconds.

| Injected bug | Result |
|---|---|
| P0-2 `Condensator`: `maxHeat - heat` → `maxHeat - currentHeat` | 4 failed |
| P0-1 `Exchanger`: reactor cascade `switchSide` → `switchReactor` | 3 failed |
| `FuelRod`: `heatMult * pulses * (pulses + 1)` → `* pulses` | 26 failed |
| `FuelRod`: drop the mox energy bonus (vanilla path) | 1 failed |
| `FuelRod`: drop the mox energy bonus (GTNH path) | 1 failed |
| `Vent`: `selfVent` → `selfVent - 1` | 14 failed |
| `BreederCell`: halve the heat-bonus step | 2 failed |
| `Reactor`: base `maxHeat` 10 000 → 12 000 | 28 failed |
| Code writer: swap the `fluid` and `RCIs` fields | 5 failed |
| `ComponentFactory.createComponent`: return the prototype | 9 failed |
| `AutomationSimulator`: skip `handleAutomation` | 5 failed |
| `MaterialsList`: dual rod costs 3 rods instead of 2 | 1 failed |
| `BigintStorage.extract`: `max + 1` → `max` | 59 failed |
| P0-1 revert: any single cascade tier back to `switchSide` | 3 × failed |
| P0-1 over-correction: the *side* block switched too | failed |
| P0-2 reverted to the old bound | failed |
| P0-2 P3-18 reverted (counts offered heat) | failed |
| P0-2 clamp dropped entirely | failed |
| P0-2 no-op (absorbs nothing) | failed |
| P1-1: legacy grid applied before the suffix is parsed | 3 failed |
| P1-1: each of the 5 encodable-range checks removed | 5 x failed |
| P1-1: revision guard / param-count refusal / reason removed | 3 x failed |
| P1-1: base64 grid or currentHeat not applied, Talonius grid not applied | 3 x failed |
| P1-3 reverted: cancel path skips both state updates | 1 failed |
| P1-3 partial revert: only `completed = true` dropped | 1 failed (`getData()` assertion) |
| P1-3 partial revert: only `firePropertyChange` dropped | 1 failed (latch) |
| P1-2: `volatile` removed from `completed` | **not caught** — see P1-2, a green run is not evidence |
| P2-1: cache lookup removed (always re-scale) | 4 failed (`oneScaledIconPerTextureAndSize`, `differentSizesGetDifferentIcons`, `cacheIsBounded`, `unchangedSizeLeavesTheButtonAlone`) |
| P2-1: pixel size dropped from `getScaledInstance` | 4 failed |
| P2-1: bound removed, cache never cleared | 1 failed (`cacheIsBounded`) |
| P2-1: memo dropped, `setIcon` unconditional | **not caught** — the memo is behaviourally invisible; only the cache above it is pinned |

### Running the mutation checks

The sensitivity evidence above comes from injecting bugs into `src/` and confirming the suite
fails. Two practical warnings, both learned the hard way:

* **Never clean up with `git checkout -- src/`.** It restores to `HEAD`, not to your working
  state, so it silently **discards the fix you are verifying**. This happened once during
  Phase 1 and undid the P0-1 change mid-verification. Copy `src/` to a scratch directory first
  and restore from that:
  ```bash
  rm -rf /tmp/erp-src && cp -r src /tmp/erp-src
  # ... mutate, test, then:
  rm -rf src && cp -r /tmp/erp-src src
  diff -r src /tmp/erp-src && echo "restored"
  ```
* **The sources are CRLF.** A patch written with LF line endings will not match, and a silent
  no-op looks exactly like a passing test. Make the patch tool try both, and always confirm the
  mutation actually applied.

### Gaps worth closing

* **No test drives `ReactorPlannerFrame` itself.** The frame needs a display, so only its pure
  static helpers are covered — which now includes the P2-1 icon cache, since `getCachedIcon` and
  `setComponentIcon` were made `static` precisely to give it a seam. The generated Swing in
  `initComponents` (~2 400 lines) remains untested, so P3-7 still needs a manual pass.
* **No fuzz or property test on `Reactor.setCode`.** The malformed cases are hand-picked. A
  generator over random byte strings is the natural way to close P1-1 off properly.
* **No performance regression guard.** P2-1, P2-2 and P2-3 were measured with a throwaway harness,
  not by a benchmark in the suite. The P2-1 *cache* is pinned (a mutation that stops caching fails),
  and P2-3(a) is pinned by an equivalence test, but nothing fails if any of them is merely slow or poorly bounded.
* **`volatile` fixes are not test-observable.** P1-2 landed with no test that can fail against it;
  the mutation table records that as *not caught*. A real guard would need a thread-sanitizer-style
  harness or a deliberately slow interleaving, neither of which JUnit here provides.
* **P3-4's narrowing has no visible replacement.** With `catch (Exception e)`, a JVM `Error`
  leaves `doInBackground` and is captured by `FutureTask.run()`; it would rethrow as
  `java.util.concurrent.ExecutionException` at `get()`, which `ReactorPlannerFrame` never calls,
  so the GUI now shows a report that simply stops. A guard would need the frame to call `get()`
  (or install a listener) and render that exception.
* **`TextureFactory`'s zip branch is still uncovered.** `TextureFactoryTest` now drives the
  classpath branch, including the P3-8 fallback, but `TEXTURE_PACK` is null in a headless run
  unless an `erpprefs.xml` in the working directory names a real zip, so the zip branch and its
  `ASSET_PATHS` walk remain untested.
* **The GUI spinner bound is smaller than the code format's.** `thresholdSpinner` is a
  `SpinnerNumberModel(9000, 0, Reactor.MAX_COMPONENT_HEAT, 1)` (1.08e6), but a rev-4 code carries
  a threshold up to 1e9 and round-trips it exactly, so `thresholdSpinner.setValue(component.getAutomationThreshold())`
  (`ReactorPlannerFrame.java:195/196`) can be handed a legitimate value the model rejects. P3-12
  deliberately did *not* clamp the data to the spinner bound; the fix is to widen the model.
