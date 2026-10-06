Ic2ExpReactorPlanner
====================

A planner for nuclear reactors in the popular Minecraft mod IndustrialCraft2 Experimental.

Development
-----------

### Requirements

* **A JDK 8, 11, 17 or 19.** Gradle 7.6 cannot run on Java 20 or newer; with `JAVA_HOME`
  pointing at JDK 21 the wrapper fails with `Unsupported class file major version 65`. If
  `java -version` reports 21+, override it for the build:

  ```bash
  JAVA_HOME="/path/to/jdk-8" ./gradlew build
  ```

* Network access for the first build, so Gradle can fetch its plugins and Spotless'
  `google-java-format`.

### Building and running

```bash
./gradlew assemble   # build the jar into build/libs
./gradlew run        # launch the GUI
```

### Tests

```bash
./gradlew test                                  # the whole suite
./gradlew test --tests '*FuelRodTest'           # one class or nested class
```

The suite is 525 JUnit 5 tests and runs headless in about 20 seconds. It covers the component
calculation logic, the tick simulation loop, and reactor code serialization. Two things are
worth knowing before you change a formula:

* **The corpus is the alarm, not a test you can edit.** Both P0 bugs from
  [`CODE_REVIEW.md`](CODE_REVIEW.md) are fixed and every test asserts the intended behaviour, so
  there is nothing skipped and no characterisation test to keep green. A deliberate change to a
  formula is reviewed by the corpus diff below, and by the "EVERY changed design is tagged" line
  it prints.
* **Some tests pin behaviour that is subtle but correct.** `ReactorItemTest` and
  `PassiveComponentsTest` document real edge cases (a broken component's `adjustCurrentHeat`
  is an unclamped pass-through; overfill refusal is exact; `Plating` is the only type with
  no tooltip override). Those are not bugs to be "fixed" — read the comment before changing one.
* **`ReactorCodeFuzzTest` generates its inputs.** It mutates one populated design ~1 600 ways and
  asserts `setCode` is atomic, and it walks every bounded code field at its bound and one past it.
  A new bounded field belongs in that table, not in a hand-written case.
* **Each code field has one bound constant.** `Reactor.MAX_PULSE_DURATION`, `MAX_SIMULATION_TICKS`,
  `MAX_REACTOR_PAUSE`, `CODE_TEMP_BOUND`, `CODE_HEAT_BOUND` and `MAX_AUTOMATION_THRESHOLD` are shared
  by the writer, the reader, the component setters and the GUI spinners. A bound change belongs there,
  not at the 18 places that used to spell the same number as a literal.

### The simulation corpus

`testResources/corpus-baseline.txt` records the full metric fingerprint of 304 reactor
designs. `CorpusBaselineTest` re-simulates all of them and fails on any drift, reporting which
designs moved and which component categories they share.

This exists so a change to the calculation logic can be reviewed by diffing a text file rather
than by re-running designs by hand. **It is expected to fail when you change a formula on
purpose** — that is the alarm working. When it fires:

1. Read the "EVERY changed design is tagged" line. If designs outside the category you expected
   moved, you have touched a shared path — investigate before regenerating.
2. Read the per-field diffs, confirm the fields that moved are the ones you meant to move.
3. Regenerate deliberately and commit the result:

   ```bash
   ./gradlew test -Derp.writeBaseline=true
   ```

Never regenerate without reading the diff first. The baseline is only a guard if somebody
actually looks at it.

### Documentation

* [`RELEASE_NOTES.md`](RELEASE_NOTES.md) — what changed since the last release tag, including the
  designs whose reported numbers move and the findings that were deliberately *not* changed.
* [`CODE_REVIEW.md`](CODE_REVIEW.md) — a full review of the codebase: two P0 bugs in the
  heat-transfer formulas, crash and data-race findings, measured performance work, and dead
  code. It also records what was checked and *cleared* as not-a-bug, so those do not get
  re-investigated.
* Code style is enforced by Spotless. **Caveat:** in a checkout where Blowdryer's shared
  config has not been downloaded, `spotlessJava` ends up with an *empty* target and the check
  passes without inspecting anything. That is the case offline, and it means formatting is
  unverified rather than verified-good. Run `./gradlew spotlessApply` somewhere with network
  access before pushing, and don't trust a local green `spotlessCheck` as evidence.
