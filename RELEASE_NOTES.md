# Release notes — 2.5.2-GTNH

Everything since tag `2.5.1-GTNH` (`26dba79` "fix breedercell", 2023-01-31): **32 commits**.
Suite at HEAD: **525 JUnit 5 tests, 0 failed, 0 skipped**. Corpus gate: **304 designs** in
`testResources/corpus-baseline.txt`, all matching.

The full audit trail for every line below is [`CODE_REVIEW.md`](CODE_REVIEW.md).

## 1. Numbers you will see change on an existing design

These are the changes that are *user-visible*: a design you have already saved can report
different metrics after this release. The corpus numbers are measured over the 304-design
regression corpus, not over published designs, but they are the closest proxy we have.

| Change | Designs moved | What moves |
|---|---|---|
| **P0-1** `Exchanger.transfer()` reactor-side cascade used `switchSide` instead of `switchReactor` | **12 / 304** | every one tagged `exchanger`; 292 byte-identical |
| **P0-2** `Condensator` absorption had no capacity bound | **1 / 304** | `named-condensator-over-capacity` only |
| P0-1 + P0-2 together | **13 / 304** | the two sets are disjoint |
| **P3-19** an exploding run now reports the output it produced *before* the explosion | **213 / 304** | totals only; 236 corpus designs explode, 23 of them on the first tick |

**P0-2 is the one that changes a safety verdict.** `named-condensator-over-capacity` (a The Core
rod pushing 26 880 heat/tick into an adjacent RSH) was reported as a design that never explodes,
carrying a `totalEUoutput` of 9 063 808 000. It now reports:

| field | before | after |
|---|---|---|
| `timeToXplode` | never | **2** |
| `totalEUoutput` | 9 063 808 000 | **0** |
| `maxTemp` | 0 | **26 880** |

That design class was being advertised as safe when it is not, so this release is worth reading
before you trust a "never explodes" verdict on a design that over-fills a condensator.

**P3-19 is the largest move and the least alarming.** 213 of 304 designs change their EU/HU
totals because a run that explodes now reports what it produced up to the explosion rather than
zero. Designs that never explode are untouched. If you have been reading zero out of exploding
runs, expect real numbers now.

**A report that stops mid-run now says so.** A simulation killed by a JVM `Error`
(`OutOfMemoryError`, `StackOverflowError`) used to leave the report area with a plausible-looking
partial result and no explanation — the failure was captured by the worker's `FutureTask` and nothing
asked it. Such a run now prints the same "where it stopped" line an ordinary simulation error prints,
plus one line naming the error and its message, with no stack trace. Ordinary simulation failures are
unchanged, and the error is still rethrown, so a caller that does ask the worker still gets it.

## 2. Deliberately *not* changed, despite looking like bugs

Two findings were **retracted** during this cycle. They are recorded so nobody re-applies them:

* **P3-16** — a broken component's `adjustCurrentHeat` is an unclamped pass-through. Relaxing the
  guard the review proposed moves **4 of 304** designs; the pass-through is the game's rule.
* **P3-17** — a GoodGenerator rod's `mox` bonus is its own, and it *replaces* the mode-derived
  bonus rather than composing with it. Composing moves **74 of 304** designs. The comment was
  fixed, the code was not.

## 3. Save-code compatibility

The code format's range is now stated once, as `Reactor.MAX_AUTOMATION_THRESHOLD` (`(int) 1e9`),
and the reader, the writer, the setter guard and both GUI spinners all use it.

* **Older files still load.** The reader's bound still comes from the revision ladder (rev 4 →
  1e9, rev 3 → 1 080e3, else 360e3), so nothing that loaded before has stopped loading.
* **Out-of-range automation is now refused, not clamped.** P3-12 did this for `reactorPause`;
  this release extends the same rule to `automationThreshold`. A component whose threshold is
  outside `[0, 1e9]` keeps its previous value and the code string is not rewritten around it.
  Capacity itself stays unbounded above — only the *encodable* range is refused.
* **P1-1** made code parsing strict: a payload that does not parse is refused whole rather than
  half-applied. **P1-5** refuses a Base64 payload that decodes to a negative length.

## 4. Performance

| Change | Measured |
|---|---|
| **P2-2** the tick loop walks a flat `ReactorItem[]` snapshot | 552–591 → **244–273 ns/tick** on a 5-component design (**−54 %**); ~−7 % and noisy on a full 54-cell grid |
| **P2-1** button icons stop being re-scaled when unchanged | icon cache, no calculation touched |
| **P2-3** minor sweep | 3 of 5 sub-findings applied, 2 retracted |

No corpus design moved for any of these — they change iteration cost, not arithmetic.

## 5. Test suite and corpus

* Suite grew **458 → 525** tests, and **nothing is skipped any more**. The `Current…`
  characterisation tests and their `@Disabled` contract tests from Phase 0 are gone: both P0s are
  fixed, so the suite now asserts the intended behaviour directly.
* **P1-5** added `ReactorCodeFuzzTest`, a deterministic mutation harness over `setCode`: ~1 600
  generated variants of one populated code, each required to end in one of two whole states.
  It now also walks every bounded code field at its bound and one past it, so a reader and writer
  bound that drift apart fails a test instead of reading back a shifted value.
* Every field the code format bounds now names its limit once — `MAX_PULSE_DURATION`,
  `MAX_SIMULATION_TICKS`, `MAX_REACTOR_PAUSE`, `CODE_TEMP_BOUND`, `CODE_HEAT_BOUND`,
  `MAX_AUTOMATION_THRESHOLD` — and the writer, the reader, the component setters and the GUI
  spinners all read that constant instead of spelling the same number as a literal at 18 sites.
  The spinners are reached through static factories (`pulseDurationModel`, `temperatureModel`,
  `tickLimitModel`, `pauseModel`), which is what makes their ranges testable. **No number changed,
  so no design moves** — this is what stops the threshold spinner's kind of drift from happening
  again rather than fixing a second instance of it.
* The corpus gate (`CorpusBaselineTest`) is unchanged in mechanism: it fails on any drift and
  reports which designs moved and which component categories they share. It is **green at HEAD**.
* `TextureFactory`'s texture-pack zip branch is now covered: `getImageFromPack` and
  `getTexturePackZip(path)` take the pack and the preferences path as arguments, and
  `TextureFactoryTest.ZipBranch` drives them with a committed fixture zip
  (`testResources/texture-pack-probe.zip`). Before this the branch was dead in every test run,
  because `TEXTURE_PACK` is only non-null when an `erpprefs.xml` sits in the working directory.

## 6. Still open, stated honestly

* **Cross-thread visibility of the config fields (P1-2, P3-11) is not observable by a test here.**
  The fields are `volatile` now, but JUnit in one process cannot demonstrate the race; that needs
  a TSAN-style harness. Recorded as *not caught*, not as *verified*.
* **The generated `initComponents` in `ReactorPlannerFrame` (~2 400 lines) is still largely
  uncovered.** The frame-level tests use static seams (`getCachedIcon`, `setComponentIcon`,
  `clampedFrameSize`, `automationThresholdModel`, `pulseDurationModel`, `temperatureModel`,
  `tickLimitModel`, `pauseModel`) because a `java.awt.Window` cannot be built headless
  (`java.awt.HeadlessException`). The spinner *ranges* are pinned through those factories now;
  the wiring is not — a frame that ignored a factory and built its own model again would still
  pass, and so would a frame that stopped honouring `clampedFrameSize`'s `null`.
* **Spotless is a no-op offline.** In a checkout where Blowdryer's shared config has not been
  downloaded, `spotlessJava` has an empty target and `spotlessCheck` passes without inspecting
  anything. Run `./gradlew spotlessApply` with network access **before pushing**.
* **No performance regression guard.** P2-1/P2-2/P2-3 were measured with a throwaway harness;
  nothing in the suite fails if the simulation gets slower.

## Building and testing this release

Gradle 7.6 will not run on Java 20 or newer, so JDK 8 is required for the suite:

```bash
JAVA_HOME="/path/to/jdk-8" ./gradlew test --rerun     # ~21 s, expect 525 passed / 0 failed
JAVA_HOME="/path/to/jdk-8" ./gradlew assemble         # the jar into build/libs
```

The version string is supplied from the git tag (`-Derp.writeBaseline=true` regenerates the corpus
baseline; read the diff before you use it).
