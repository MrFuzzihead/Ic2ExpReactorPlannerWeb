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

The suite is 458 JUnit 5 tests and runs headless in about 20 seconds. It covers the component
calculation logic, the tick simulation loop, and reactor code serialization. Two things are
worth knowing before you change a formula:

* **Some tests pin behaviour that is known to be wrong.** The `Current…` tests in
  `ExchangerTest` and `CondensatorTest` characterise today's output for the two P0 bugs, and the
  matching `@Disabled` tests state the intended behaviour. Fixing a bug means the
  characterisation tests fail, the contract tests pass, and the skipped count drops — not
  editing the expectation to whatever the code now does.
* **Some tests pin behaviour that is subtle but correct.** `ReactorItemTest` and
  `PassiveComponentsTest` document real edge cases (a broken component's `adjustCurrentHeat`
  is an unclamped pass-through; overfill refusal is off by one; `Plating` is the only type with
  no tooltip override). Those are not bugs to be "fixed" — read the comment before changing one.

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

* [`CODE_REVIEW.md`](CODE_REVIEW.md) — a full review of the codebase: two P0 bugs in the
  heat-transfer formulas, crash and data-race findings, measured performance work, and dead
  code. It also records what was checked and *cleared* as not-a-bug, so those do not get
  re-investigated.
* Code style is enforced by Spotless: run `./gradlew spotlessApply` before pushing.
