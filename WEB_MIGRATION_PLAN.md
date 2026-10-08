# Web Migration Plan — Ic2ExpReactorPlanner

Port of the Java 8 / Swing desktop planner to plain ES modules, hosted as a static
webpage for mobile and desktop browsers.

**Status:** not started. `web` and `desktop` branches are currently identical.

---

## 0. Decisions (settled before writing any code)

| Question | Decision | Consequence |
|---|---|---|
| Source of truth | **The web app replaces the Java app** | Java becomes a reference implementation only. Ship web; keep Java around just long enough to run the corpus against it, then it can be archived. |
| `Bundle_zh_CN.properties` | **Keep** | Free — it is already translated. Emit it as `i18n/zh-CN.json` alongside the default bundle. |
| CSV export | **Drop** | 33 `csvOut` / `csvLimit` / `CSVData.*` sites in `AutomationSimulator.java` go away. |
| Talonius legacy-code reader | **Drop** | `TaloniusDecoder.java` (25 LOC) and `Reactor.handleTaloniusCode` (153 LOC) go away. |
| Texture pack / `erpprefs.xml` zip | **Drop** | `TextureFactory.java` (113 LOC) collapses to a name → static asset lookup. |
| Language | **Plain ES modules** | No TypeScript, no bundler-required syntax. |
| Branches | **`desktop` keeps Java; `web` carries zero Java** | Java stays on the `desktop` branch as the reference build. The `web` branch deletes every `.java` file, the Gradle wrapper, and the Gradle CI workflows. See `WEB_DESIGN.md` §4 for the exact delete/keep list. |
| Orientation | **Portrait phone supported** | Scale-to-fit 9×6 board + pinch-zoom. See `WEB_DESIGN.md` §1. |

**Not dropped — worth stating so nobody assumes it was:** the pre-2.3.1 legacy hex code
(`readLegacyCode` / `getOldCode()`, 108 hex digits + `|` suffix) stays. It is a code
*format* shared with older planner builds and old forum posts, not one of the three
candidates above.

Net effect of the drops: **5,208 → ~5,070 LOC** of engine logic to port, and one whole
dispatch branch out of `Reactor.setCode`.

---

## 1. What is being ported

| | Files | LOC | Treatment |
|---|---|---|---|
| **Engine** | 20 `.java` | **5,208** | Near-mechanical port, one JS module per Java file, same names |
| **UI** | `ReactorPlannerFrame.java` + `ReactorPlannerFrame.form` + `HtmlSelection.java` + `ExceptionDialogDisplay.java` | **3,734** | **Rewrite** in HTML/CSS, not a port |
| **Data** | 72 components (ids 1–72), 78 PNGs (162 KB), `Bundle.properties` (454), `Bundle_zh_CN.properties` (451) | — | Static assets / generated JSON |
| **Tests** | 527 JUnit 5 tests, 8,839 LOC + `testResources/corpus-baseline.txt` (304 designs) | — | Ported; the corpus is reused **as-is** |

Engine file inventory with target module:

```
Reactor.java              976  ->  engine/reactor.js              (minus handleTaloniusCode, -153)
AutomationSimulator.java 1012  ->  engine/automation-simulator.js (minus CSV, -33 sites)
ComponentFactory.java     901  ->  engine/component-factory.js + data/components.json
ReactorItem.java          524  ->  engine/reactor-item.js
components/FuelRod.java   313  ->  engine/components/fuel-rod.js
components/Exchanger.java 152  ->  engine/components/exchanger.js
components/Vent.java      145  ->  engine/components/vent.js
components/Condensator.java 75 ->  engine/components/condensator.js
components/Reflector.java  89  ->  engine/components/reflector.js
components/CoolantCell.java 55 ->  engine/components/coolant-cell.js
components/Plating.java    68  ->  engine/components/plating.js
components/BreederCell.java 69 ->  engine/components/breeder-cell.js
components/GGFuelRod.java  47  ->  engine/components/gg-fuel-rod.js
MaterialsList.java        387  ->  engine/materials-list.js
SimulationData.java        81  ->  engine/simulation-data.js
BigintStorage.java         70  ->  engine/bigint-storage.js
TaloniusDecoder.java       25  ->  DROPPED
TextureFactory.java       113 ->  engine/assets.js (lookup table only)
BundleHelper.java          42  ->  engine/i18n.js
WarningDisplay.java        64  ->  engine/warning-display.js
```

---

## 2. Java constructs with no 1:1 JS equivalent

Ordered by how much they can silently break correctness.

| # | Java | JS | Where | The trap |
|---|---|---|---|---|
| 1 | `java.math.BigInteger` | native `BigInt` | `BigintStorage.java` | `toByteArray()` is **signed** two's-complement big-endian and `new BigInteger(bytes)` honours the sign bit. A JS `BigInt → bytes` helper that omits the leading zero byte shifts every field. The existing P1-5 negative-payload refusal is the guard that must survive the port. |
| 2 | `Integer.parseInt(s, 36)` | `parseInt(s, 36)` | `Reactor.readLegacyCode`, `getOldCode()` | Java **throws** `NumberFormatException`; JS returns `NaN`. The entire all-or-nothing guarantee of `setCode` (CODE_REVIEW.md P1-1) rests on those throws. Needs a `parseInt36()` helper that throws, and negative-value handling differs between the two. |
| 3 | `java.text.DecimalFormat` | `Intl.NumberFormat` | `Simulation.DecimalFormat`, `Comparison.CompareDecimalFormat=+#,##0.##;-#` | `Intl` cannot express the leading-sign patterns used here. Vendor a ~60-line formatter. |
| 4 | `String.format("%s", …)` | template literals | ~450 bundle entries | Mixed `%s` / `%d`; needs a small formatter shared with #3. |
| 5 | `java.util.ResourceBundle` | JSON map | `BundleHelper.java` | Generate `i18n/en.json` + `i18n/zh-CN.json` from the two `.properties` files at build time. `\uXXXX` escapes and `\u0020` need unescaping. |
| 6 | `javax.imageio` + zip texture pack | `<img>` / CSS sprite | `TextureFactory.java` | Drop the `erpprefs.xml` zip branch and the 8-entry `ASSET_PATHS` probe loop; the 78 PNGs become static files. |
| 7 | `SwingWorker`, `volatile`, `isCancelled()` | single-thread + cancel flag | `AutomationSimulator.java` | The P1-2 / P1-3 thread hazards disappear for free. Keep the cancel check in the tick loop — it is what bounds pathological runs. The channel is not only report text: `process` also paints `R%dC%d:0xRRGGBB` onto the design grid buttons, which §35 ports. |
| 8 | `java.awt.clipboard` | `navigator.clipboard` | `HtmlSelection.java` | **Permission-gated on mobile.** Needs a visible-text fallback so the user can always copy the reactor code. |
| 9 | `File` / `FileOutputStream` | `Blob` + `URL.createObjectURL` | `AutomationSimulator`, `JFileChooser` | Dropped per decision 0 — only the reactor-code download path remains. |
| 10 | `javax.swing.*` (JButton, JSpinner, tooltips, GridBagLayout) | HTML + CSS | the frame | Not a port. Design for touch. |

**The one thing that does translate exactly:** every heat and EU value is already a Java
`double`, and JS numbers are the same IEEE-754 doubles. The simulation should match the
corpus **bit-for-bit**. That is what makes the port verifiable rather than hopeful.

---

## 3. Performance — the number that looks fatal and isn't

`CODE_REVIEW.md` measures **566 ns/tick** in Java, and the tick cap is
`MAX_SIMULATION_TICKS = 5e6`. That reads like a browser-killer. It isn't, for real designs:

```
$ grep -v '^#' testResources/corpus-baseline.txt | awk -F'|' '{print $4}' | sort -n | tail -1
4000
```

All 304 corpus designs finish in **≤ 4,000 ticks**. A 4k-tick run is single-digit
milliseconds in V8 — the UI stays at 60 fps on a phone.

Only the pathological design (never boils, still producing output) walks to the 5M cap,
and that is ~10–40 s in JS on a mobile browser. Mitigation, in order of preference:

1. Keep the existing cancel check in the tick loop (it already exists in the Swing version).
2. Chunk the loop and yield to the event loop with a progress readout — the Swing version
   already `publish()`es per tick, so the shape is there.
3. Optionally lower the default tick cap on web while leaving the spinner bound at 5e6.

Do **not** reach for WASM before measuring. The corpus says the common case is already fast.

---

## 4. Target architecture

Keep the engine a near-mechanical port — one JS module per Java file, same identifiers,
same bounds constants — so `corpus-baseline.txt` is a **cross-language oracle**: run the
Java corpus, run the JS corpus, diff 312 lines.

```
web/
  engine/      reactor.js  automation-simulator.js  component-factory.js
               reactor-item.js  components/*.js  bigint-storage.js
               materials-list.js  simulation-data.js  assets.js  i18n.js
               warning-display.js
  data/        components.json   (72 entries, ids 1-72)
               bounds.js         (MAX_PULSE_DURATION, MAX_SIMULATION_TICKS,
                                  MAX_REACTOR_PAUSE, CODE_TEMP_BOUND, CODE_HEAT_BOUND,
                                  MAX_AUTOMATION_THRESHOLD, MAX_COMPONENT_HEAT)
               i18n/en.json  i18n/zh-CN.json
  ui/          index.html + one CSS file (~400 lines, responsive)
  test/        corpus.test.js    <- reads the SAME testResources/corpus-baseline.txt
               code-roundtrip.test.js  components/*.test.js
  assets/      78 PNGs -> one sprite sheet (~80 KB)
```

Payload: 162 KB PNGs (one sprite sheet → ~80 KB) + ~150 KB engine + ~30 KB i18n ≈
**under 300 KB**, no server, no runtime dependencies. GitHub Pages / Netlify / a static
clone is the whole hosting story.

Mobile UI specifics:
- The grid is `grid[6][9]` — 9 wide × 6 tall. On a portrait phone that needs horizontal
  scroll or a landscape hint.
- Cells must be ≥ 44 px touch targets.
- `JSpinner` controls become `<input type="number">` or drag sliders, bounded by `bounds.js`.
- Swing tooltips become a tap-to-open panel.

---

## 5. Stages

Stages 1–3 are the mechanical part. Do them first: a Stage-3 corpus mismatch is far
cheaper to debug in a finished engine than in a half-built UI.

| Stage | Work | Done when |
|---|---|---|
| **1** | `BigintStorage` → `bigint-storage.js`, `Reactor` code read/write, `bounds.js` | `erp=` codes round-trip byte-identically against a real desktop code string |
| **2** | `ReactorItem` + 9 component subclasses + `ComponentFactory` (72 entries → `components.json`) | component math matches the ported unit tests |
| **3** | `AutomationSimulator` + `SimulationData` + `MaterialsList` | **corpus diff is clean across all 304 designs** — the port is proven |
| **4** | HTML/CSS UI (the 3,734 Swing LOC, rewritten) | the actual webpage |
| **5** | i18n JSON, sprite sheet, clipboard fallback, PWA manifest | mobile-grade polish |

---

## 6. Verification strategy

The Java suite is 527 tests plus a 304-design corpus. Do not rewrite it from scratch —
port it, and let the corpus be the cross-check.

1. **Corpus is the oracle.** `testResources/corpus-baseline.txt` is a `|`-delimited text
   fixture — 304 designs, 312 lines — read by the Java `CorpusBaselineTest` (on the
   `desktop` branch) and by the new `corpus.test.js` (on `web`). Same file, same 312 lines.
   It is **frozen golden data in `web`**: regenerate it on `desktop`, commit the result,
   record the desktop tag it came from. A clean diff is the proof of equivalence; a dirty
   diff reports which designs moved and which component categories they share.
2. **Code round-trip is a second oracle.** Java `getCode()` → JS `setCode()` → JS
   `getCode()` must equal the Java string, and the legacy hex path must survive too.
3. **Port the fuzz test, don't hand-write cases.** `ReactorCodeFuzzTest` mutates one
   populated design ~1,600 ways and walks every bounded field at its bound and one past it.
   That generator ports directly and is the cheapest large coverage win.
4. **Keep the deliberate-failure semantics.** `Reactor.setCode` refuses bad codes with a
   warning and leaves the design untouched (P1-1). `parseInt36` throwing is what makes that
   true. Losing it is the single most likely way to break the port quietly.
5. **Do not regenerate the baseline without reading the diff** — and in `web` there is
   nothing to regenerate from. Regeneration belongs to `desktop` only.

---

## 7. Resolved by `WEB_DESIGN.md`

| Was open | Now settled in |
|---|---|
| Portrait orientation | `WEB_DESIGN.md` §1 — scale-to-fit 9×6 board, pinch-zoom as a gesture, rotate offered as a setting. The board is only ~223–270 px tall, so portrait is the comfortable case. |
| Which UI features survive | `WEB_DESIGN.md` §3 — keep / drop / defer triage against all 8 Swing tabs. |
| Java tree location | `desktop` branch keeps Java; `web` branch deletes it entirely. `WEB_DESIGN.md` §4 lists what is deleted and kept. |
| Performance shape | `WEB_DESIGN.md` §5 — struct-of-arrays engine, progress-callback instead of `SwingWorker`, chunked tick loop, sprite sheet, corpus runner as the benchmark harness. |

**Still open** (`WEB_DESIGN.md` §6): the comparison view (keep the UI or drop it — the
`SimulationData` fields stay either way), `localStorage` preferences vs. none, palette
grouping taxonomy, and whether `Inspect` mode replaces the Component/ComponentAutomation
tabs outright.

---

## 8. Stage 1 result — what the oracle found

Stage 1 is `BigintStorage`, the code writer and the two code readers. It is green: all 11
frozen Java codes round-trip byte-identically, and the base64 and legacy codes of each design
decode to the same design.

Seven divergences were found by running against the Java oracle rather than reasoned about.
Each is a JS/Java semantic difference that will recur in later stages, so they are recorded
rather than just fixed:

| # | Symptom | Cause | Where |
|---|---|---|---|
| 1 | Every field after the grid shifted | Reader extracted `automated` before `pulsed`; Java extracts **pulsed first** (`Reactor.java:669-670`) | `readCodeFields` |
| 2 | A field silently became 0 | Base64 decoder emitted the low byte (`acc & 0xff`); the payload is big-endian, so it must be `(acc >> bits) & 0xff` | `base64DecodeStrict` |
| 3 | A valid legacy code was refused | Java's parameter-group guard is `pos + 1 < code.length()` measured against the **whole** code, not the part before the first `\|`. Walking only the 108 id characters breaks when the 54th cell is last | `readLegacyCode` |
| 4 | An automated legacy code read back as not-pulsed | The suffix's middle character is one three-way switch: `s` neither, `p` pulsed, `a` **both**. The legacy format couples the flags; the current format does not | `readLegacyCode` |
| 5 | A design read back as a different design | "The code did not carry these parameters" means the component's **own** defaults, not the global 9000. `ReactorItem`'s constructor derives the threshold from capacity (`maxHeat*0.9`, else `maxDamage*1.1`, else 9000), so `getDefaultComponent(1)` is 22000 | `defaultParamsFor` + `data/component-code-defaults.json` |
| 6 | `\|nzyzzzz` accepted | JS `parseInt` has no range limit and truncates silently; Java's `Integer.parseInt(s, radix)` rejects the digit set *and* signed 32-bit overflow | `parseIntOrThrow` |
| 7 | A bare `erp=` decoded as an all-zero design | Java's `new BigInteger(byte[])` rejects an empty array ("Zero length BigInteger") | `inputBase64` |

Two further facts were settled by the oracle and are now asserted, not assumed:

- Java's `Base64.getDecoder()` is **not** padding-mandatory. `AA`, `AAA`, `AAAAAA` decode; a
  final group of one character does not. The earlier "must be a multiple of four" rule was wrong
  and would have refused `erp=AAAAAAAA`.
- `erp=AAAAAAAA` is **accepted** as revision 0 with every field zero — the readers fill with
  zeros rather than refusing a short payload.

The oracle lives outside the repo (`Workspace/erp-java-ref`) so the `web` branch stays Java-free,
and `testResources/java-reference-codes.txt` is frozen data: it is never regenerated in `web`.

## 9. Stage 1 addendum — the fuzz sweep, and the eighth divergence it found

`web/test/code-fuzz.test.js` is the port of `test/Ic2ExpReactorPlanner/ReactorCodeFuzzTest.java`.
It exists because the fixture test can only ever check the eleven designs someone chose to write
down. The fuzz test checks a property instead: reading a code is **atomic**. Every input, valid or
not, ends in one of exactly two states — the design that existed before the call, or a whole design
that re-encodes to itself. A blend of the two is what P1-1 was, and no hand-written case finds it.

The seed design is the Java test's seed (quad uranium rod at (2,2), plating at (0,8), fluid, pulsed,
on-pulse 1111, heat 2222, tick limit 3333), and its two codes are asserted against a twelfth
fixture line the oracle emitted for it. That matters: without the anchor, the fuzz test only proves
the JS engine is self-consistent, and a self-consistent-but-wrong engine passes. With it, every
generated mutation is a mutation *of a Java code*.

| family | inputs | refused | applied |
|---|---|---|---|
| truncations | 84 | 80 | 4 |
| deletions | 84 | 82 | 2 |
| substitutions | 1176 | 710 | 466 |
| edge junk | 14 | 12 | 2 |
| legacy prefixes + deletions | 238 | 128 | 110 |

**Divergence 8 — the legacy reader skipped the reactor-level encodability checks.** A mutated
legacy code decodes to `currentHeat = 103700551`, far above `CODE_HEAT_BOUND = 120000`. The reader
accepted it, so the design it lands on has a `getCode()` that throws — exactly the state `setCode`
promises never to create. Java refuses it; the port was accepting it. Fixed by porting
`requireEncodable` for current heat (only when the suffix carries the field), on/off pulse, and
suspend/resume temperature, alongside the pulse-overflow check that was already there.

Two of the Java test's nine cases are not portable at this stage and are named rather than
quietly dropped: `aRefusedComponentFieldStillLandsOnAWritableDesign` needs component setters
(Stage 2's `ReactorItem`), and the seed's *derived* max heat that plating adds on contact is
Stage 3's `Reactor`. The JS seed asserts on the whole design instead, which is a stronger claim
about everything that exists today.

## 10. Stage 2 result — the component layer

Three new files:

| file | lines | what it is |
|---|---|---|
| `web/data/components.json` | 1243 | all 72 entries, every constructor argument |
| `web/engine/components.js` | 453 | `ReactorItem` plus its nine subclasses, folded into one shape |
| `web/test/components.test.js` | 214 | 1296 oracle-verified values plus the primitive semantics |

**The catalog had to be a source extraction, not an oracle dump.** Every subclass constructor
argument (`energyMult`, `heatMult`, `switchSide`, `switchReactor`, `heatBonus`, `selfVent`,
`hullDraw`, `mHeatBonusStep`, ...) is `private final` with no getter, so no driver can print it.
`extract-components.mjs` (desktop-side, outside the repo) parses the `ITEMS` array literal instead;
it refuses an entry whose argument count disagrees with the constructor signature, and it produced
28 FuelRod, 12 GGFuelRod, 14 CoolantCell, 5 Vent, 4 Exchanger, 3 Reflector, 3 Plating, 2 Condensator,
1 BreederCell — the same counts a `grep` of the source gives.

`testResources/java-component-catalog.txt` is the other half: an oracle dump of everything the
engine *can* see (capacity, the derived automation threshold, and nine class-level predicates),
plus two probes that make otherwise-invisible behaviour observable — the 1.7.10 damage table, and
the reactor's max heat with each component placed, which is the only way `heatAdjustment` shows up
at all. 1296 field values match.

**One shape, not nine JS classes.** Every field a subclass declares exists on every instance,
zeroed where unused. Nine JS classes with different field sets would make `cell.automationThreshold`
megamorphic in the simulation loop. `kind` carries the Java class name and the overrides
(`adjustCurrentHeat` for Condensator and CoolantCell, `isNeutronReflector`, `getMaxDamage` for
Reflector, `getHeatBonus` for GGFuelRod) are branches, which is what a small virtual-dispatch
hierarchy costs in JS.

**Stage boundary.** This file carries data, queries, and the primitives that mutate one component.
The per-tick actions (`generateHeat`, `generateEnergy`, `dissipate`, `transfer`) are Stage 3's:
each one reads through `parent`, and `Reactor` does not exist until Stage 3. `formatTooltip` is
Stage 5's, with the i18n layer. The fields only the JSON pins (`energyMult`, `heatMult`,
`switchSide`, `mHeatBonusStep`, `mHeatBonusMultiplier`) are pinned here as "extracted correctly
from the source"; their numeric effect is pinned by Stage 3's corpus diff, and the test says so
rather than pretending the oracle covered them.

**A redundancy worth naming.** `web/data/component-code-defaults.json` is exactly derivable from
`components.json` — all 72 entries agree with the constructor's own threshold rule and a pause of
0. It stays as frozen oracle data because it is what the Stage 1 fixture test reads, but it is not
a second source of truth and the shipped payload will not carry both.

---

## 11. Stage 3 result — the simulation, and the corpus that proves it

Six new engine files, one new test:

| file | lines | what it is |
|---|---|---|
| `web/engine/reactor.js` | 278 | the 6×9 grid plus the reactor-level state the tick loop mutates |
| `web/engine/automation-simulator.js` | 836 | `AutomationSimulator.java`: the tick loop, `publish`/`process` routing, the report |
| `web/engine/simulation-data.js` | 89 | `SimulationData.java`, field names kept so the report can read them |
| `web/engine/materials-list.js` | 107 | `MaterialsList.java`, the "Components replaced:" multiset |
| `web/engine/format.js` | 354 | `DecimalFormat` and `String.format`, ported explicitly |
| `web/engine/i18n.js` | 58 | the resource bundle and `BundleHelper`'s two entry points |
| `web/test/corpus.test.js` | 198 | the 35-field result line, the SHA, the diff |

**The corpus diff is clean: 304 of 304 designs match the committed baseline**, scalars and report
hash, in about 250 ms (0.8 ms/design — the Java runner takes the same order of magnitude, so the
"performance looks fatal" section of this plan was right that it isn't). That is the Stage-3
done-when, and it is the whole claim: the report hash covers the per-component figures no scalar
field holds.

**Three bugs, all found by the corpus, none of them in Stage 3's own code.**

1. **`intCast` in `components.js` negated twice.** It was written
   `value < 0 ? -Math.trunc(value) : Math.trunc(value)`; Java's `(int)` *is* truncation toward zero,
   so the extra negation made every negative cast positive. The visible symptom was an exchanger
   that *heated* the reactor instead of cooling it: the sign flip is `add = (int)(add - 2 * add)`,
   and a `-9` came back as `+9`. One design per exchanger-heavy tag in the corpus moved; the fix
   is one line and it moves all of them back.
2. **`simulateCode` decoded with an empty defaults table.** The code format compares a component's
   automation parameters against *that component's* defaults, which the constructor derives from
   capacity — `maxHeat * 0.9`, so 900 for a 1000-heat vent, 54000 for a 60k coolant cell. With no
   table, `defaultParamsFor` fell back to the bare `9000`, which is above a vent's capacity:
   automation never fired, a vent ran to 1000 instead of being replaced at 900, and it broke.
   `codeDefaults(catalog)` builds the table by reading a fresh catalog component, which is exactly
   the derived value, so there is no second rule to keep in sync. `web/data/component-code-defaults.json`
   and the derived values agree, as section 10 said they would.
3. **`publishOutputs` inherited a guard it should not have.** The before-break block in Java's
   `handleBrokenComponents` publishes unconditionally; the `totalHeatOutput > 0` guard belongs to
   `reportOutputTotals`, the tail summary. A design that broke before producing any output therefore
   lost two report lines — `Simulation.HeatOutputsBeforeBreak` and `Simulation.Efficiency`, both
   printing zeros — while every scalar stayed correct. Two designs, both caught by the SHA alone.

**The CSV sink is the debugging instrument, not a port target.** `AutomationSimulator`'s `csvFile`
is `null` in the corpus, so the CSV branch is dead there; it is kept in JS as an `onCsvRow` callback
because it is what makes a divergence legible at all. `CsvDump.java` (a driver that runs one design
with the sink live) and `ThreshProbe.java` (per-component automation settings after `setCode`)
turned "gen-177 breaks a vent at tick 3 and the oracle does not" into a three-value sequence to
compare. `ReportDump.java` does the same for the report text.

**`format.js` is where the ties live.** `String.format("%.2f", 0.125)` → `0.13` (half-up on the
shortest round-trip decimal) and `DecimalFormat("#,##0.##").format(0.125)` → `0.12` (half-even on
the exact binary value) — neither matches `Number.toFixed`, and the report body uses the second
while the bundle strings use the first. A design that lands on a tie moves for a formatting reason,
not a behaviour reason, and the corpus is what pins which is which.

**Stage boundary.** `ReactorPlannerFrame` (3,734 LOC of Swing) is Stage 4's; nothing in the tick
loop reads it. `MaterialsList`'s shopping-list half and `formatTooltip` are Stage 5's with the i18n
payload. The engine as it stands takes a code string and returns `SimulationData` plus the report —
which is the whole of the planner's contract.

## 12. Stage 4 result — the page, and what a browser cannot verify

**The board is a translation, not a model.** `web/ui/board.js#describeBoard` takes a code string and
returns positioned cells; `web/ui/app.js` moves those values into elements. The split is the point:
`describeBoard` is DOM-free and asserted against the decoder for all 304 corpus designs
(`web/test/board.test.js` — 2,043 cells, every one checked for index, row/col, id, and heat), so the
only thing left unproven is painting.

**The drawn extent is the used extent.** A 3 × 4 reactor renders as 12 slots, not a 6 × 9 frame with
12 filled: `bounds` comes from the maximum occupied row and column. The slot loop still indexes the
design's flat array with `GRID_COLS`, which is what keeps a cell that sits at row 2 in the code at
row 2 on screen — the first cut indexed the slot instead, and the test caught it as "1 component
decoded, 0 icons drawn".

**Icons are copied, not sheeted.** 66 of the catalog's image references resolve to files under
`build/classes/java/main/assets/{ic2,fm}/textures/items/`, all 66 copied to `web/assets/icons/` at
163 KB total. `web/test/board.test.js` asserts every catalog entry resolves to a file that ships,
counting the `fallback` field. A sprite sheet is a Stage 5 optimisation, not a prerequisite.

**`codeDefaults` is exported for the same reason the simulator needs it.** The board shows a cell's
`a` value; a cell that omits `a` must show its constructor-derived threshold, not the 9000 field
initialiser. The test measures the difference — exactly one cell in the first corpus design reads a
different threshold without the table — so the export is load-bearing rather than convenient.

**The page is verified by a shim, and that is the whole limit of this stage.** `web/test/page-shim.js`
stands in for `document`, `window`, `localStorage` and `fetch` so Node can execute `app.js`
(`ERP_CODE=<code> node web/test/page.test.js`): it checks the glue runs, finds every element the
stylesheet styles, draws one `<img>` per filled cell with the catalog's icon and localized name,
sets `--cell`/`--cols`, and writes only the three allowed keys to storage. Layout, painting and
image loading are not covered by anything here — they need eyes, and the page has not been opened in
a browser yet.

**Still open in Stage 4:** the mode chips (`Place` / `Clear` / `Pick` / `Inspect` / `Automate`) are
decided in `WEB_DESIGN.md` §6 but not in the page — nothing is shipped that does not work. The
palette (mod toggle plus class filter) and the `Inspect` readout are the next two pieces.

## 13. Stage 4 addendum — opening the page, and the two bugs only a browser finds

**`tools/serve.mjs` exists because the module paths need an origin.** `app.js` imports
`../engine/components.js` and fetches `../data/components.json`; both only resolve over http, so the
repo is served at `http://127.0.0.1:8123/` and the page is `/web/ui/`. Content types are explicit —
a module served as `text/plain` is refused rather than failing quietly, which is the difference between
a blank board and a diagnosable one.

**Two defects were invisible to the shim and obvious to Edge.**

1. **`element.clear()` is not a DOM method.** The shim implemented `clear`, so `page.test.js` passed
   for months of edits; the browser threw `boardElement.clear is not a function` and the board stayed
   empty. Replaced with `replaceChildren()`, which is the standard one.
2. **The icon prefix was resolved against the wrong document.** `ICON_ROOT` was `assets/icons/`, which
   from `/web/ui/index.html` asks for `/web/ui/assets/icons/` — a 404 for every cell, rendered as 19
   broken-image glyphs with their alt text spilling across the board. The files live at `/web/assets/icons/`,
   so the constant is `../assets/icons/`. `board.test.js` strips the prefix when it checks that a file
   ships, so the fix had to move in both places.

**Finding them required an error handler, not a screenshot.** A failing module leaves a blank board and
nothing else; `window.addEventListener('error', ...)` injected before the module script turns that into
`Uncaught TypeError: boardElement.clear is not a function @ …/app.js`. Every screenshot in this pass was
taken against that probe page.

**Sprite pixels are scaled by an integer.** Every icon is 16 × 16, so the cell is now a whole multiple of
16 (`scale = clamp(floor(available / 16), 1, 6)`). A 2.5 × cell renders some sprite pixels 2 device px
wide and others 3, which is what makes copied game art look warped.

**Headless Edge cannot emulate a phone width, and that is a limit of the instrument, not the page.**
`--window-size=390,844` yields `window.innerWidth = 504`: the layout viewport is clamped to a minimum of
500 CSS px while the PNG is still 390 wide, so a narrow capture shows the board clipped at both edges —
a capture artifact. The narrowest faithful capture is 500 CSS px, which is what the baseline uses.

**The baseline is two committed PNGs** (`testResources/visual-baseline/`, 41 KB total): `narrow-500x1000.png`
and `desktop-1280x800.png`, both rendering gen-122 — 19 components across six categories, the sample
design `index.html` ships the textarea with. Reproduce with:

```
node tools/serve.mjs
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless --disable-gpu \
  --hide-scrollbars --user-data-dir=<temp> --window-size=500,1000 --virtual-time-budget=15000 \
  --screenshot=<path> http://127.0.0.1:8123/web/ui/
```

**What the baseline shows and does not settle:** the board is centred and shrink-wrapped, icons are crisp
at 48 px (3 ×) on the narrow capture and 80 px (5 ×) on the desktop one, and the code sits below the board
in both. The desktop capture wastes the right 40 % and the bottom 45 % of the viewport — the cell size is
bound by `0.62 × height`, chosen so the code stays visible without scrolling. Whether the code should come
before the board, and whether the desktop board should be allowed to grow, are layout decisions for the
next pass, not bugs in this one.

## 14. Stage 4 addendum — one button, and what the console can now see

The IDE is IntelliJ IDEA **Ultimate 2026.2** (`IU-262.8665.258`), and the two plugins the web target
needs are already installed in it: `nodeJS` (run/debug a `.mjs`) and `javascript-debugger` (breakpoints
inside a browser page). Nothing to install, nothing to configure on disk.

**Green Run is a right-click on `tools/serve.mjs`.** Run it with `--open` in the parameters and one
click starts the server and hands the URL to the default browser. `--open` is `explorer.exe <url>` on
Windows (`open` / `xdg-open` elsewhere), which asks the registered browser handler rather than
hardcoding an executable path — verified: the console showed Edge fetching the page.

**The console is the error log.** Two additions turn "the page is blank" into a line next to the Run
button:

- every non-200 prints the path and who asked: `404 /web/assets/icons/nope.png <- …/web/ui/`. A wrong
  icon prefix, a renamed sprite and a moved data file all read as one line instead of a broken-image
  glyph.
- `POST /_log` prints what the page's own error handler caught, so an uncaught JS error appears in the
  IDE console and not only in the page's red strip.

The handler is a **classic** script in `index.html`, placed before the module script, because a module
that fails to import never runs and therefore cannot report itself. Proven end to end: a page ending in
`throw new Error("probe failure")` printed `[2026-…Z] browser: Uncaught Error: probe failure @
…/web/ui/tmp-broken.html`. The same handler was made to echo the strip back (`strip=[Uncaught Error:
sync failure @ …] len=76`), which is how the write to `#error` was confirmed without trusting the
instrument that failed to show it.

**Hitting the Run button twice is a sentence, not a stack trace.** `EADDRINUSE` prints
`port 8123 is already taken — stop the earlier server, or set PORT to another value`.

**The tab icon is an existing sprite** (`reactorCoolantSimple.png`). Without it, the one console line in
an otherwise clean run was `404 /favicon.ico`, which is noise that hides the noise that matters.

**Breakpoints in the page's own JS are a second configuration**, not this one: a *JavaScript Attach*
run configuration (Edge) starts the browser with a debug socket and attaches IDEA's JS debugger to it.
Create it in the UI — `+ New Run Configuration` ▸ JavaScript Attach ▸ set the URL to
`http://127.0.0.1:8123/web/ui/` — and keep `serve.mjs` running underneath it, since the page's module
graph only resolves over an http origin. Breakpoints go in `web/ui/app.js` and `web/ui/board.js`.

**`tools/check-imports.mjs` was lying and is now fixed.** Collapsing `/../` into `/` resolved
`../data/limits.js` from `web/engine/` as `web/engine/data/limits.js`, so 15 of 27 edges were reported
unresolvable while the browser loaded all of them. Resolution is segment-wise now (`..` pops the
previous segment), and the tool agrees with the browser: 27 edges, 0 unresolvable.

**One instrument limitation restated:** headless Edge's `--dump-dom` does not reflect DOM mutations —
a direct `textContent` write was absent from the dump while the live write was confirmed through
`/_log`. DOM assertions belong to `web/test/page.test.js`; `--dump-dom` is for the module graph and
nothing else.

Suite after this pass: `board`, `components`, `corpus` (clean diff), `code-roundtrip`, `code-fuzz`,
`page` — all green; `check-imports` 27/0; a clean browser pass prints only the serving line.

---

## 15. Stage 4 addendum — the palette, and what only a DOM check catches

**The palette is a filter over the catalog, never a second list.** `web/ui/palette.js` is DOM-free
like `board.js`, and `web/test/palette.test.js` asserts the split `WEB_DESIGN.md` §3 names — 26 base
against 46 mod (Coaxium 6, GT5.08 9, GT5.09 4, GTNH 27) over 72 entries, 9 classes — and that the
two filters compose. The axes are *derived* from the catalog, so the page cannot offer a filter for
a pack it does not have; the test asserts the axes cover the catalog exactly.

**The palette is a drawer the `Place` chip opens, under the board.** A permanent strip would compete
with legibility: the cell-size math already gives the board 62% of the viewport height on a phone.
Closed, the drawer collapses to nothing, so the page a first-time visitor sees is still just the
board.

**Only `Place` is authored in `#modes`.** `WEB_DESIGN.md` §6 settled five chips, and nothing ships
that a visitor cannot use — `Clear` / `Pick` / `Inspect` / `Automate` arrive in the same element
with the behaviour they need. Clicking `Place` opens or closes the drawer rather than switching to a
mode that does nothing.

**The shim had to grow before the page could be checked at all:** `getAttribute`, `querySelector`,
`hidden` as a real property, `children`, `firstElementChild`, `replaceChildren(...)` with arguments,
`createTextNode`. It also mirrors `index.html`'s authored state — Place active, drawer closed — so a
green test proves `app.js` *opened* the drawer, not that the shim forgot to close it.

**Two bugs the DOM check caught before a browser did.** `readFilters` read an empty class list as
"no filter", so switching every class off showed 72 components instead of none; the fix compares the
on-count to the chip count, which is what keeps "all on" and "all off" different values. And the
available-count line was written into `#error`, the danger strip — a working palette reporting in
red. Both are invisible to `--dump-dom`, which does not reflect DOM mutations.

**`modPackFilter` is the only prefs key the palette owns**, stored as `'base'` or `'all'`; the class
filter is a viewing aid and never reaches storage, which the test asserts against the three-key
decision.

Suite after this pass: `board`, `components`, `corpus` (clean diff), `code-roundtrip`, `code-fuzz`,
`page`, `palette` — all green; `check-imports` 29 edges / 0 unresolvable.

---

## 16. Board editing: `Clear` / `Pick`, and the code that follows every tap

`web/ui/board-edit.js` is DOM-free like the other models, and it is deliberately thin: a design and
one tap in, a design out. `clearCell`, `placeComponent`, `pickUp`, `writeCode`. The page calls it,
and after every accepted edit the new design goes back through `encodeBase64Code` into the textarea
and into `localStorage`. There is no second representation of a reactor: what a tap produces is a
code the desktop already accepts, and `code-roundtrip` / `code-fuzz` already prove that encoder green
against Java.

`web/test/board-edit.test.js` runs the corpus through all three:

```
clear: 303 designs lost one component and still read back
place: 304 fresh components carry the catalog's own defaults
pick:  303 cells read, 15 of them carrying a non-default initial heat
refusals: empty cell, off-board index, unknown id, unstorable heat — all reported, none thrown
```

The placement line is the point of the module existing at all: `automationThreshold` and
`reactorPause` have *per-component* defaults, so placing a rod at a guessed default would encode a
parameter flag bit the desktop does not encode — a code that reads back the same in this page but
differently in Java. The test places each component and re-reads it against `codeDefaults(catalog)`.
`pickUp` is checked the same way: the three settings survive a code, and 15 corpus cells carry a
non-zero initial heat, which is where a lost field would show.

**Three chips are authored now** (`Place` / `Clear` / `Pick`), and the drawer exists exactly while
`Place` is lit — `Clear` and `Pick` close it rather than leaving a drawer nobody is using. `Inspect`
and `Automate` still arrive with their behaviour. The placing line is the bundle's words
(`UI.ComponentPlacingDefault` / `UI.ComponentPlacingSpecific`), and tapping a cell with nothing
selected answers `Config.NoComponentSelected` rather than a sentence invented here.

**One bug the DOM check caught before a browser did:** `catalogDisplay` keyed its entries by id but
never carried one, so every palette entry shipped `data-id="undefined"` — a control that draws a
component the page then has to guess back. `palette.test.js` printed `undefined` in its messages and
still passed, because the id only appeared inside the message. `catalogDisplay` now carries its own
`id`, which is what makes a Place tap name the component it placed.

**The page test now clicks.** The shim grew a `click()` that walks up the parent chain and runs every
ancestor's handler with `target` the tapped node — which is what makes `app.js`'s delegated handlers
(one per container, not one per cell) testable at all. The sequence is select → place → pick → clear
→ refuse, and each step asserts the DOM *and* the textarea.

**The assertions compare decoded designs, not code strings.** Clearing a fresh placement from an
empty board returns a full `erp=` code, not the `''` the textarea started with — the two are the same
design in two representations, and comparing strings would fail on the empty board while meaning
nothing. So the test re-reads the code and compares filled counts and `index:id` pairs.

**Still invisible to a test:** that the outline appears on the touched cell, that the selected entry
reads as selected, and that a tap lands where a finger aimed. `--dump-dom` does not reflect DOM
mutations, so these remain the browser's job.

Suite after this pass: `board`, `board-edit`, `components`, `corpus` (clean diff), `code-roundtrip`,
`code-fuzz`, `page`, `palette` — all green; `check-imports` 34 edges / 0 unresolvable.

---

## 17. `Inspect`: the readout a finished run already owns

`web/ui/inspect.js` is DOM-free like the other models, and it is thin on purpose: the desktop's
whole shape is 10 lines of `ReactorPlannerFrame` (the info button, lines 217-226), and it has three
branches — no run yet says `UI.NoSimulationRun`, a cell the run left empty says
`UI.NoComponentLastSimRowCol`, and a cell that has a component says
`UI.ComponentInfoLastSimRowCol` around the component's label and whatever the run appended to
`component.info`. The run already put the figures on the component, so this module picks a cell and
formats the bundle's own sentence. Nothing is computed here.

`componentToString` moved from private to exported in `automation-simulator.js`: the popover's header
is `ReactorItem#toString`, which the engine already mirrors for
`Simulation.FirstComponentBrokenDetails`, and a header rebuilt from the catalog instead would be a
second label that could drift from the run's.

`web/test/inspect.test.js` runs the corpus through the reader:

```
readouts: 2043 over 14373 empty cells, 543 of them saying nothing, longest 50 lines
templates: GeneratedHeat 1029, GeneratedEU 833, ReachedHeat 399, ReplacedTime 262, UsedCooling 108,
           ReceivedHeat 184, BrokeTime 53, RemainingHeat 15, BreederProgress 28
           (CooldownTime and ResidualHeat: 0 — the corpus never reaches those two branches)
labels:   105 headers carry an initial heat
```

Three claims, none of them a screenshot. The reader picks the right cell: every readout is compared
array-for-array against the `component.info` the run left on the component at the same flat index, so
an off-by-one in the row/column math shows as a mismatched pair. Every line is the bundle's: each one
matches exactly one of the eleven `ComponentInfo.*` templates once its numbers are masked, so no
sentence was invented for the web target. The refusals are the desktop's, and they name the cell the
finger aimed at.

**The design document's "up to 11 lines" counts kinds, not lines.** `WEB_DESIGN.md` §6 describes the
readout as "up to 11 lines", and the corpus's longest cell has 50: an automated reactor replaces a
consumed rod every 84 seconds, and each replacement appends its own `ReplacedTime`. Eleven is the
number of `ComponentInfo.*` keys, and the most any cell mixes is four of them. The popover is
therefore scrollable rather than sized, and the test asserts the ceiling on *kinds*.

**The fourth chip is authored, the fifth is not.** `index.html` now carries `Inspect`, and the
stylesheet gives it a popover that hangs from the tapped slot: `position: absolute` below the cell,
`pointer-events: none` so the board stays tappable under it, `white-space: pre-wrap` because the text
is the desktop's whole string with its newlines, `max-height: 45vh` with `overflow: auto` because of
the fifty lines above. `Automate` still arrives with its behaviour.

**A refusal leaves the readout the visitor was reading.** `inspectAt` clears the previous popover only
after the cell answers, so a mis-tap adds a line to the red strip without blanking the popover under
a thumb. A successful readout also clears the strip, which is what `applyEdit` already does for the
same reason: a stale refusal above a board that is answering reads as a page that is still broken.

**The run is keyed to the code, not to the mode.** `inspectedCode` is compared against the textarea on
every `Inspect` tap, so typing a new code invalidates the popover data instead of serving figures for
a design that is no longer on the page. One run per code, which is what the desktop's `simulatedReactor`
field is for.

**The page test builds the expected popover itself.** It runs the code through `simulate` and formats
`UI.ComponentInfoLastSimRowCol` from the run's own `component.info`, rather than calling `inspectCell`
and comparing it to itself — a reader that picked the wrong cell fails there rather than passing here.
The empty-board run of the same test now exercises the refusal branch only, which is why the block is
conditional rather than asserted away.

Suite after this pass: `board`, `board-edit`, `components`, `corpus` (clean diff), `code-fuzz`,
`code-roundtrip`, `inspect`, `page`, `palette` — all green; `check-imports` 38 edges / 0 unresolvable.

---

## 18. The eyes pass the palette needed, and it disagreed with itself

The two committed PNGs in `testResources/visual-baseline/` were captured before the palette existed,
so they no longer show this page. Both were regenerated with the §13 command against the current page,
and the captures said three things the tests could not.

**One entry's name printed across the next entry's icon.** The entry grid's columns were
`minmax(56px, 1fr)`, and a flex item cannot shrink below its longest word: at 11px, "Overclocked" and
"Condensator" are wider than 56px, so those names overflowed their column and over the neighbour's
icon. The column is now `minmax(88px, 1fr)` with `gap: 4px 8px`, and `overflow: hidden` on the entry
is the belt for the rest. The catalog's longest name ("Heat-Capacity Reactor Plating") wraps to three
lines inside 88px, which is why the row gap is 4px rather than the old 4px all-around.

**The open drawer pushed the code off the first screen.** `#palette` was authored above the textarea,
and an open drawer is 72 entries tall, so on a 1280×800 desktop the page's most-used control — the
code, the thing the whole page is about — was below the fold. The authored order is now board → chips
→ code → drawer. Nothing in the tests cares: every element is found by `getElementById`, and the
palette test asserts the drawer's contents, not its position.

**The popover CSS is the desktop's readout, sized for the corpus's worst cell.** `position: absolute`
hangs it from the tapped slot rather than reflowing the grid; `pointer-events: none` keeps the board
tappable under it; `white-space: pre-wrap` because the text is the desktop's whole string with its
newlines; `max-height: 45vh` with `overflow: auto` because §17 measured a fifty-line cell.

What the captures show, and still show: the board's 9×7 grid with 19 icons, the four chips with
`Place` lit, the code reading the sample design under them, the drawer's nine class filters plus the
`mod components` toggle, and 72 entries each with its own icon and wrapped name. What they cannot show
is a popover — a headless capture cannot tap, so the readout's placement is asserted by `page.test.js`
(the popover is a child of the tapped slot, and exactly one is on the board) and its look is still the
browser's job for a human to confirm.

Suite after this pass: `board`, `board-edit`, `components`, `corpus` (clean diff), `code-fuzz`,
`code-roundtrip`, `inspect`, `page`, `palette` — all green; `check-imports` 38 edges / 0 unresolvable.

---

## 19. A tap landed on the icon, not on the cell

A visitor reported that tapping a palette entry, then a board cell, then `Inspect`, did nothing. The
handlers read `event.target` and asked it for `data-index` / `data-id`. A cell is a slot `div` with an
`<img>` child that fills it (`#board > div img` is `width: var(--cell)`), and a palette entry is a
`div` with an icon and a name — so a tap on the thing the visitor aimed at resolves to the `<img>`,
which carries neither attribute, and the handler returns. The only tap that ever reached a handler was
one on a cell's 3px gap or on an entry's padding. The page was not dead; every tap was being thrown
away, and the one message that would have said so (`Config.NoComponentSelected`, in the red strip) is
below the fold on a phone.

The shim never caught this because its `click(node)` aims at an element, and the test passed that
element: the shim's tap was already a resolved one. The test now aims at the icon when a cell or an
entry has one (`tap(node)` clicks the `img` child, else the node), which is what a finger does, and
`app.js` resolves the tap by walking up from `event.target` to the nearest ancestor carrying the
attribute — the same resolution the desktop makes against a component's drawn rectangle. A tap that
resolves to no such element is a tap on the gap between cells, and does nothing.

**The placing line moved above the entry list.** It is the confirmation that a palette tap registered,
and it was appended after the entries — 72 of them — so selecting a component could only be read by
scrolling past the whole catalog. The drawer's order is now filters → placing → entries. Nothing else
cares: every element is found by `getElementById` or `querySelector`, and `page.test.js` stopped
indexing the drawer's children for the same reason.

Suite after this pass: `board`, `board-edit`, `components`, `corpus` (clean diff), `code-fuzz`,
`code-roundtrip`, `inspect`, `page`, `palette` — all green; `check-imports` 38 edges / 0 unresolvable.

---

## 20. `children` is a live collection in a browser, an array in the shim

`Inspect` threw `TypeError: slot.children.filter is not a function` in the browser while every test
passed. A browser's `element.children` is a live `HTMLCollection` — it has `length` and index access
but no `filter`, `map`, or `find` — while the shim's `children` getter returns an array, so the call
that works in the test does not exist in the page. `clearPopovers` now copies first
(`[...slot.children].filter(...)`), which is also what makes the swap safe: dropping a child
invalidates a live collection mid-iteration.

**The shim is lenient about this on purpose, and the leniency is documented.** Its `children` stays an
array because the tests read it with array methods; the comment above the getter names the divergence
and says what it means: a test that reads `children` with an array method is testing the shim, not the
page. The two places `app.js` touches a collection are now written for the browser's shape.

**The browser was the judge, not the shim.** A probe page — `index.html` with a script that lights the
`Inspect` chip, clicks a filled cell's `<img>`, and writes what it finds into `#design` — was rendered
by headless Edge with a virtual-time budget, and the capture reads:

```
RESULT popovers=1 parent=5 text=Reactor Heat Exchanger (initial heat: 835) at row 0 column 5
```

with the popover drawn under the tapped cell, accent border and all, and the `Inspect` chip lit. That
is the one path the shim cannot reach: a real click whose target is the icon, a real collection, and
real layout. The probe is not committed — it is generated from `index.html` on demand, since a page
that taps itself would be a page that lies about what a visitor did.

Suite after this pass: `board`, `board-edit`, `components`, `corpus` (clean diff), `code-fuzz`,
`code-roundtrip`, `inspect`, `page`, `palette` — all green; `check-imports` 38 edges / 0 unresolvable.

## 21. `Automate`: the panel the desktop already has, and the one event the shim got wrong

The desktop's automation controls are a panel, not a modal: two spinners (`Config.ReplacementThreshold`,
`Config.ReactorPause`) and the `UI.AutomatedReactor` checkbox, all living on the selected cell. The web
page gets the same shape — an `Automate` chip on the mode row, and a panel that names the cell the
finger aimed at in the cell's own `ComponentInfo` words, refuses an empty one in `Config.NothingSelected`
(`AutomationSimulator.java:100`), and leaves a component that cannot be automated alone.

**The typed number goes back through the code, not into a field.** The desktop's spinner handler
(`ReactorPlannerFrame:2167`, `:2188`) writes both spinners into the selected component and re-encodes;
so does the page. What that buys is the desktop's own asymmetry, which the corpus had already shown:
on a reactor that is **not** automated the code cannot carry the two numbers, so a typed value is
refused and the panel re-reads the default the code holds. `automate.test.js` asserts both halves —
1,679 edits on a reactor that cannot carry a threshold read back as defaults, 364 pairs survived the
code.

**A dispatched `change` does not bubble, and the shim had been assuming it did.** The first cut put one
`change` listener on the panel, delegating like the board delegates clicks. Two probe pages rendered by
headless Edge settled what a browser does: a real click on a child reaches an ancestor's listener
(`seen=box-click`), while `dispatchEvent(new Event('change'))` on an input fires that input's own
listeners and stops there — the panel's listener sat deaf (`seen=field`, `saw=false`). The shim's `type`
had been walking ancestors, so the test exercised a path the page does not have. Both sides changed:
the page now registers one handler per spinner, which is what the desktop's `ChangeListener` is, and the
shim's `type` runs only the node's own handler, with the comment naming the instrument that said so.

**The browser agreed with the shim once they agreed with each other.** `tools/probe-automate.mjs`
generates `index.html` plus a script that lights `Automate`, clicks a filled cell's `<img>`, types a
threshold, and toggles the checkbox, writing what it finds into `#design`; the capture reads:

```
inputs=2 before chosen=Reactor Heat Exchanger (initial heat: 835) at row 0 column 5 fields=4500/0 off=true len=100 saw=false fired=true
after  chosen=Reactor Heat Exchanger (initial heat: 835) at row 0 column 5 fields=4500/0 off=true len=100
       toggled chosen=… fields=4500/0 off=false len=144
```

`fired=true` is the spinner's own listener running, `saw=false` is the panel's would-be listener not
running, and `after fields=4500` is the typed 5500 being refused and re-read from the code — the same
asymmetry `automate.test.js` asserts, seen in a real browser. `len` going 100 → 144 on the toggle is
the two numbers becoming storable once the flag is on. The probe is generated, not committed.

Suite after this pass: `automate`, `board`, `board-edit`, `components`, `corpus` (clean diff), `code-fuzz`,
`code-roundtrip`, `inspect`, `page`, `palette` — all green; `check-imports` 44 edges / 0 unresolvable.

## 22. Getting a code in and out of the page, and the phone-sized controls

**`Copy Code` is the desktop's button, not a new one.** `ReactorPlannerFrame:2151` puts the code
field on the system clipboard and says nothing; the label is the bundle's `UI.CopyCodeButton`. A
browser cannot do that quietly — the clipboard is gated — so the page tries `navigator.clipboard.writeText`
first and falls back to selecting its own field and asking `execCommand('copy')`, leaving the text
highlighted for the visitor's keyboard. The capture reads `clipboard=true exec=1`, which is both
halves at once: the API was there, its `catch` ran, and the fallback ran. In the screenshot the
field is visibly selected. Nothing is reported in any branch, because the desktop reports nothing
and a page that announces a copy the visitor can already see has no more to say — which also means
a refused copy is indistinguishable from a quiet one, and that is the honest reading of an API this
page cannot observe.

**A paste keeps its wrapping, and the desktop has always stripped it.** `ReactorPlannerFrame:2388`
hands the code field `clipboard.replaceAll("[^0-9A-Za-z(),.?|:/+=]+", "")` before anything reads it,
which is what makes a code pasted out of a chat window or a terminal still decode. A browser's
`<textarea>` takes the paste verbatim, so the page applies the same strip where it reads the field
and writes the stripped text back — the field then shows what was accepted rather than what was
pasted. `page.test.js` ran with a newline-wrapped `ERP_CODE` and drew the same 19 icons the clean
form does.

**The manifest is one file, and every value in it is one the repo already owns.** The name is the
page's `<h1>`, the colours are the stylesheet's `--bg`, the start URL is the page, and the icon is a
real component sprite — declared at `16x16`, because that is the size the sprite actually is and the
repo has no larger one. A manifest claiming `192x192` for a 16-pixel file would be lying about an
asset that does not exist.

**The dev server had to learn the manifest's content type, and the running one had not.** `serve.mjs`
falls back to `application/octet-stream`, and a browser ignores a manifest served that way — so the
link would have been dead in every capture. `curl` proved `application/manifest+json` after the type
was added, and the server logged no 404 for it. The server that was already running when the edit
landed still served the old type; the pass restarted it rather than reading a stale console.

**A finger is not a mouse, and the stylesheet asks the browser which it has.** `@media (pointer:
coarse)` gives the chips, the copy button, the filter chips, the toggle and the two inputs the padding
that reaches the 40 px the design doc asks for. Two captures of the same page measure it: the fine
pointer gets `chipH=32 copyH=32` (the desktop spacing the earlier captures measured, unchanged), and
the same page with the condition forced to `@media all` gets `chipH=46 copyH=46`. The forced page is
the instrument for the declarations; headless Edge reports a fine pointer and cannot claim a touch
device, so what remains unproven is which browser reports coarse — the same instrument limit §20
named for phone width.

**The shim grew one method and kept one trap.** `select()` is recorded rather than painted, since what
a headless test can know is that the page asked. The label check reads `index.html`, not the shim's
`textContent` — the shim's registry elements carry no authored text, so a test that read it would be
testing the shim, which is the trap §20 named.

Suite after this pass: `automate`, `board`, `board-edit`, `components`, `corpus` (clean diff), `code-fuzz`,
`code-roundtrip`, `inspect`, `page`, `palette` — all green; `check-imports` 44 edges / 0 unresolvable.

## 23. The shopping list the engine already had, and the walk that only a browser could take

**The list was ported in §14 and has never been visible.** `web/engine/materials-list.js` is pinned
against the Java dump by `materials.test.js`, and nothing in `web/ui/` ever asked it for a string.
The panel is therefore page-only: `ui/materials.js` builds the reactor the design sits in and returns
`getMaterials().toString()`, and `app.js` paints that into a `pre-wrap` box. The desktop's
`materialsArea` is the same call with the same `toString()`, so the panel is the desktop's text rather
than a re-imagining of it — same `#,##0.##` counts, same `TreeMap` order.

**The two controls above the list are the desktop's combo and checkbox, not a dropdown.**
`ReactorPlannerFrame.java:1710` set a four-item model — the bundle's `UI.GregTechVersionNone` plus
the three literals `"5.08"`, `"5.09"`, `"GTNH"` the bundle never had — so the page authors four chips,
one lit, and labels them the same way. `GTNH` is asserted nowhere as a list change because it is not
one: `MaterialsList.java:240-269` reads `5.08` and `5.09` for the reflector, the vent and the
containment plate, while `GTNH` moves the rods' behaviour and not one material. The test clicks
`5.09` (`Beryllium` appears, `Graphite` 108→116, `Copper` 119→76) and clicks back to `None`.

**`expandAdvancedAlloy` is not a preference, and the panel does not make it one.** The preferences
decision kept exactly three storage keys, and `gtVersion` was already among them; the checkbox stays
session-only, which is what the design doc asked for by name. The first attempt inverted the toggle —
`!hasAttribute('data-off')` is the chip's *current* state, not the click's — and the test caught it by
name: the list still carried `Advanced Alloy` and had no `Bronze`.

**`tapped` walked off the top of the tree, and only a browser could see it.** Every delegated handler
resolves a tap by walking up to the nearest ancestor carrying the attribute, and the walk used
`parentNode`. In a browser that chain is `BUTTON > DIV > DIV > BODY > HTML > #document`: the root
element's parent is the `Document` node, which is not an element and has no `hasAttribute`, so a tap
that aims at nothing — a panel's padding, the gap between chips — threw. The shim's chain ends at
`null`, so no test had ever taken that last step. `parentElement` is the accessor that stops at the
root element, and the shim grew the same name so the walk still works under test. This is the second
thing §20's lesson predicted: the browser's live collections and parent chains differ from the shim's,
and the difference shows up only over http.

**The panel is below the code, not above it.** Same reasoning as the drawer: an open panel is a dozen
lines tall, and ahead of the textarea it pushes the page's most-used control off the first screen.

**The browser judged it.** Over the dev server — `file://` cannot resolve the engine's module paths,
which is what §19's server is for — the capture reads
`open=true caption=Materials gt=4/5.09 alloyOff=false lines=29 gtChanged=true beryllium=true
alloyGone=true bronze=true err= panelH=621 panelW=488 gtH=25 listH=504`, and the screenshot shows the
`5.09` chip ringed, the alloy line struck while off, and 29 material lines under it. The forced-coarse
capture of the same page gets `gtH=41 panelH=653`: the new chips clear the 40 px the design doc asks
for, and the fine-pointer page keeps the compact desktop spacing. Headless Edge still reports a fine
pointer, so which browser reports `coarse` remains the instrument limit §20 named.

Suite after this pass: `automate`, `board`, `board-edit`, `components`, `corpus` (clean diff), `code-fuzz`,
`code-roundtrip`, `inspect`, `materials`, `page`, `palette` — all green; `check-imports` 48 edges / 0 unresolvable.

## 24. The comparison view: the label the bundle spells, and the two slips only a test could catch

The panel was already on the page — `#comparison`, its stylesheet, its `Compare` chip, `paintComparison`
rebuilding both reactors from their codes — but nothing had ever executed `web/engine/comparison.js`
end to end. The first thing that ran it was its own test, and the first thing that test did was fail.

**Two slips were in the engine before the first run of anything.** `appendOutput` reads its fields as
`leftData[prefix + suffix]` with `prefix` one of `prebreak`, `predeplete`, `''`, and the call sites
spell the suffix capitalized (`MinEUoutput`). That is right for the two prefixed sections and wrong for
the postsim one, where the record's field is `minEUoutput`: every postsim guard compared `undefined`
with `undefined`, so the output lines and the two temperature lines never printed. The fix is in the
helper, not at a dozen call sites: an empty prefix lower-cases the suffix's first letter. The second
slip was one `)` too many on the `EUEUoutput` push — a `SyntaxError`, which is how §19's server
announced it (`Uncaught`) before any line of the panel existed.

**The test is the oracle, and it says so at the top of the file.** There is no Java dump for this
panel and there cannot be one: `updateComparison` is a private method of a Swing frame, and the JDK
that runs the planner's own classes has no `javax` left in it. Three claims carry the panel instead.
Every line, markup stripped, matches a `Comparison.Prefix.*` (or nothing) followed by one of the
nineteen body templates with its specifiers masked — the same provenance claim `inspect.test.js` makes,
and it is what would catch a sentence this port wrote rather than copied. For 24 corpus pairs, the
postsim output line is asserted to carry exactly the pair the two `SimulationData` records hold,
formatted with the bundle's `Comparison.SimpleDecimalFormat`, and the coloured difference carries
`Comparison.CompareDecimalFormat` with the colour the desktop's threshold picks. And a fluid design
against a solid one gets the `HUEUoutput`/`EUHUoutput` sentence and never the `EUEUoutput` one, which
is the pairing that follows the two *designs* rather than the two reports.

**The thresholds and the sections needed fixtures, not corpus pairs.** Every corpus pair's output
difference is far past the desktop's 1000, so a difference of 750 gets its own fixture — orange, where
a mutated threshold makes it green. And no corpus pair reaches rod depletion, so the whole predeplete
half of the panel was untested until a fixture set `firstRodDepletedTime`, `totalRodCount`, and the
`predeplete*` fields; that fixture is also where the 15% rule lives, the one place the desktop colours
the two *values* rather than the difference, each side against its own reactor's ceiling.

**`<br>` ends a line, it does not start one.** The desktop's label always closes with a break, and a
`JLabel` renders that as nothing. The renderer drops one trailing empty line for the same reason, and
keeps every interior one — the gap between sections is an empty row on the page, four of them in the
capture below.

**The shim had never seen the seventh chip.** `page-shim.js` registered six panels and six chips;
`index.html` authors seven of each, and `wireComparison(comparison, catalog)` took the undefined that
`getElementById('comparison')` returns for an unregistered id. The shim grew the panel and the chip, and
`page.test.js` grew the claim that goes with them: the page looked up `#comparison`, the `Compare` chip
exists, and the panel stays closed while `Place` is the lit chip.

**The browser judged it.** Over the dev server, the capture reads
`open=true caption=Comparison rows=62 emptyRows=4 coloured=55 words=green,orange,red
painted=rgb(121, 189, 136) | rgb(216, 112, 95) | rgb(216, 162, 79) toggleOff=true prevCode=true
panelH=1284 rowH=17`, and the screenshot shows the panel open under the code with the `Compare` chip
ringed: green differences, red ones, the materials block in green down the left column, and the empty
rows between sections visible. The strip's `err=` reads `No component at row 0 column 0 during last
simulation.` — the probe's second tap landed on an empty cell, which is the desktop's own refusal and
not a fault of this panel. 62 rows is the honest cost of the desktop's label: the panel is taller than
the board, and it sits below the code for the reason §23 gives.

Suite after this pass: `automate`, `board`, `board-edit`, `comparison`, `components`, `corpus` (clean
diff), `code-fuzz`, `code-roundtrip`, `inspect`, `materials`, `page`, `palette` — all green;
`check-imports` 59 edges / 0 unresolvable.

## 25. The phone pass is deferred, not skipped

§20's phone-width proof stays open: `tools/probe-phone.mjs` writes the page that reads a phone's own
report of `pointer: coarse`, viewport width, and tap-target heights into the status strip, and
`tools/serve.mjs` prints the LAN address under the local one (Windows reports the LAN route with
`internal: false` and the loopbacks with `internal: true`, the reverse of a macOS route, so the filter
is on the address rather than that flag). From this PC the page still reads `coarse=false`, `chipH=32`,
`all40=false` — the desktop's answer, which is what a phone has to contradict. The phone itself is not
on this machine, so Stage 6's portrait layout waits until the desktop behaves properly at a monitor
width.

## 26. The desktop's tall panels scroll inside themselves

`tools/probe-desktop.mjs` drives two corpus designs so the readouts have data, visits every mode chip,
and posts the per-mode report to the dev server's `/_log` channel — the status strip cannot hold a
five-hundred-character line and a screenshot of it costs more than a log line. At a 1250 × 705
monitor window, before the change:

```
Place pageH=1216 | Clear 705 | Pick 705 | Inspect 705 | Automate pageH=877 panelH=221
Materials pageH=1243 panelH=587 | Compare pageH=3172 panelH=2517 rows=124 maxRowH=17
```

The comparison is 124 rows of 17 px: 2517 px of panel, 4.5 screenfuls of page. The Swing frame does
not do that — `ReactorPlannerFrame.java:1887` adds the comparison to the tab through a
`JScrollPane`, and `:2786` sets its `unitIncrement(16)`; the materials list and the component list sit
in `JScrollPane`s of their own (`:636`, `:638`). A long readout on the desktop is a fixed-height area
with its own scrollbar, never a window that grows.

`@media (pointer: fine)` now gives `#palette`, `#materials` and `#comparison` `max-height: 45vh`,
`overflow: auto` and `overscroll-behavior: contain`, the same treatment the `Inspect` popover already
carries. After: every mode caps at `pageH=973` (1.4 screens), the panels read `panelH=317`, and the
comparison reports `scrollH=2515 viewH=315 overflowY=auto` with `lastRowReachable=true` after
scrolling the box to the bottom — the whole 124-line readout is reachable without the page moving.
`copyAboveFold=true` in all seven modes, before and after: the panels sit below the code, so the two
things a desktop visitor uses most were never the problem, the panels below them were.

Scoped to a fine pointer rather than every viewport: the phone's portrait pass is still open (§20,
§25), and a thumb already scrolls the page itself. `page.test.js` needed `ERP_CODE`, not `CODE`
(`web/test/page.test.js:28`), and is green with it — twelve green, `check-imports` 59 edges / 0
unresolvable.

The probe found a second bug on the way. It visits every mode chip, and the `Compare` chip gets
clicked twice — once to load the readout, once in the loop — and the second visit reported `rows=124`,
exactly double. `openAutomation`, `openMaterials` and `openComparison` set `panel.hidden = false` and
append a fresh caption, header, toggle and row set onto whatever the panel already held, so re-clicking
a chip — the ordinary gesture of looking away and back — duplicated the whole panel. The drawer already
cleared itself (`renderEntries`, `web/ui/app.js:210`); the three panels did not. Each now opens with
`panel.replaceChildren()`. The same visit then reports `rows=62`, `scrollH=1265` rather than 2515.

## 27. The board sized itself once, and the code box spanned the monitor

Measured at the window the visitor uses (1798 × 952; Edge reports the inner viewport as 1768 × 857),
before the change: the board was 267 px wide with 27 px cells, the drawer ran to the last pixel row,
and `#code` was 1798 px wide. The board is not a taste call — 27 px is what a ~540 × 290 window
would produce, so the page had been sized at load and never resized.

`render` read `window.innerWidth`/`innerHeight` once, and `render` runs only when the code changes
(`web/ui/app.js:439`), so a window that grows after the page loads keeps the cell size it was loaded
at. The cell math is now `sizeBoard(boardElement, bounds)` of its own, and boot registers a `resize`
listener that calls it with the bounds of the last design (`boardBounds`, set in `render`). It rewrites
only `--cell` and `--cols`: no re-decode, no re-render, the placed icons stay where they are.

`#code` was `width: 100%`. A reactor code is ~100 characters of 12 px monospace — about 720 px of
text — so at a monitor width the box put a thousand pixels of empty field between the end of the
string and the `Copy Code` button under its left edge, which is the one action this app exists for.
It now reads `width: min(100%, 900px)` and keeps the left edge the controls share.

After, at the same viewport: `cellForced=27 cellAfterResize=80 codeW=900 boardBottom=546`. The probe
forces `--cell` back to the stale 27 px and fires a resize event — the only way to exercise the
listener without a hand on the window edge. `page.test.js` claims the same under the shim: `window`
grew `addEventListener`/`dispatchEvent`, and the test sets a monitor viewport, dispatches the event,
and requires the cell to change, to stay a whole number of sprite pixels, and the slot count and
`--cols` to stay put.

Still unproven: browser zoom does not fire a `resize` event in every browser, so a page zoomed rather
than resized can still keep its load-time cell size.

## 28. Clear Grid, and the audit of what the desktop still has that this page does not

The visitor asked for a way to empty the board in one gesture. The desktop has one —
`clearGridButton` (`ReactorPlannerFrame.java:602`, labelled `UI.ClearGridButton` at `:1375`, action
at `:2056`) — and the web page did not: its only `Clear` is the mode chip, whose tap clears one
cell (`web/ui/app.js:427`). The label was already ported (`web/data/i18n/en.json`), the control was
not. `web/ui/board-edit.js` grew `clearDesign`, the design half of the engine's `Reactor#clearGrid`
(`Reactor.java:106`, which walks the grid and touches nothing else), and `index.html` grew a
`Clear Grid` button under the field next to `Copy Code`.

Two deliberate divergences from the desktop's handler:

- **The field keeps the encoded empty design, not the desktop's null.** The desktop writes
  `codeField.setText(null)`; this page's field always holds the code that encodes what it draws, and
  `Reactor.java:106` clears cells only, so the reactor-level switches survive the click. An empty
  field would decode to defaults and drop them, disagreeing with the board. Measured: a 100-character
  field goes to 68 characters, not to nothing.
- **The board collapses to its used extent** (an empty design is 1 × 1), where the Swing frame keeps
  its 6 × 9 frame. This is the page's existing rule for an empty field, not a new one.

`tools/probe-clear-grid.mjs` clicks the button in a real browser and reports
`label=Clear Grid icons=19->0 codeLen=100->68 flags= listLen=panel closed buttonH=32 err=`.
`page.test.js` claims the label equals the bundle's `UI.ClearGridButton`, that one click leaves
`filled === 0` and no icons, that the four reactor-level switches survive, that the materials panel
goes back to the emptied reactor's list, and that the stored code is the field. Run against a design
with `fluid`, `injectors` and `pulsed` set, the same claims hold with three flag chips lit — the
survival claim is not vacuous.

**The audit.** Counting the bundle's 422 strings against the ones the web code names leaves the
desktop's remaining controls visible as a group. Already dropped by decision (§0, `WEB_DESIGN.md`
§3): `CSVData.*` (12), `UI.TexturePack*`, `UI.CSV*`, `UI.Remove*Components*`. Still on the Keep list
and not built:

| Missing | Evidence (no web file names the key) |
|---|---|
| Obsolete components | `Warning.DepletedIsotope`, `Warning.DualPlutonium`, `Warning.Heating`, `Warning.Plutonium`, `Warning.QuadPlutonium`, `Warning.Unrecognized` — the title `Warning.Title` and `Warning.InvalidReactorCode` are built, but `describeBoard` drops an unknown or obsolete id silently rather than naming it |
| Cancelling a run | `UI.CancelButton` — the page has no run to interrupt, it runs on load |
| Comparison extras | `UI.CopyComparisonData` (`UI.OnlyShowDiffData` and `UI.LockInTabCode` are both built) |
| Paste button | `UI.PasteCodeButton` — the page strips a paste as it reads the field, so no button is needed |

`ComponentName.*` and `ComponentData.*` (72 each) look unreferenced to the same count but are not:
the page names them through `prototype.nameKey`, a variable, which a key-name count cannot see.
Five rows left the table as they were built: the simulation output and the temperature-effects
readout (§31), the reactor-level configuration (§32), the component list tab (§33), the Simulate
button with the old-style checkbox (§34), and the comparison's copy button (§36). `UI.CancelButton`
stayed: the page has no run to interrupt.

## 29. The frame is the whole reactor, not the used extent

The visitor's rule from the game: the Nuclear Reactor block brings 3 columns, each Reactor Chamber
opens one more, six of them reach the 9 the code can carry — so the smallest legal board is 6 × 3
and the largest is the engine's 6 × 9. Nothing in the engine models this: `Reactor.java` is a fixed
6 × 9 grid and no component is a chamber, so the rule is web-side and lives in `web/ui/board.js` as
`CORE_COLS = 3`.

`describeBoard` now returns `bounds` as the constant `{ rows: 6, cols: 9 }` plus `minChambers`, the
fewest chambers the design's own width implies (`maxCol + 1 - 3`, floored at 0). §29 started from the
design saying how many chambers it implies, because the page had no chamber control; §30 adds the
control and the design's width becomes only its floor. `render` marks every slot at or past
`CORE_COLS + chambers` — the page's selection, not the design's width — with `data-locked`, and one
CSS rule draws the pair of hairlines corner to corner with `calc(50% ± 1px)` stops, so the cross
stays 2 px at a 32 px phone cell and at a 96 px monitor cell; percentage stops made it 8 px wide and
turned the locked half of the board into a wall.

This supersedes §12's rule ("the drawn extent is the used extent, not the 6 × 9 maximum") and fixes
the empty-board case §28 left behind: clearing the grid used to collapse the frame to one cell.

Measured in a real browser at 1280 × 900: the sample design fills all 9 columns, so the gate loads at
6 chambers and nothing is crossed; one Clear Grid click leaves the frame 6 × 9 with the gate where it
was, and closing the gate to 2 crosses 24 cells. `page.test.js` claims the frame is always 6 × 9, that
the crossed slots equal `(9 - 3 - chambers) × 6`, that crossed plus open add to 54, and that clearing
the grid leaves the gate alone. `board.test.js` claims the same over every corpus design: `minChambers`
equals what the cells imply.

---

## 30. The chamber gate: a control, and columns the game has not opened take nothing

§29 left the frame's crossed columns as a property of the design's width, which meant a visitor could
tap a crossed column and get a component in it. The visitor's rule turned into a control instead: the
page selects how many Reactor Chambers the reactor has, and the columns past it are a hard gate —
opened left to right, one chamber per column, and nothing lands in a closed one.

The control is a `<div id="chambers">` under the board, filled by `buildChambers` in `app.js`: a
`<label>` and an `<input type="number" min=0 max=6 step=1>`, the desktop's spinner idiom, the same one
the Automate panel's two numbers use, with one `change` handler on the input rather than on the panel
for the reason that panel's comment gives. The input counts chambers rather than columns, which is the
game's object: 0 is the smallest legal reactor (the 3 the block brings) and 6 the widest the code can
carry. The label reads "Reactor Chambers", authored in English on the web side — the bundle has no
chamber key (`Bundle.properties` and `web/data/i18n/en.json` were checked), so the control and its
wording join the mode chips as web-side inventions.

`chambers` is module state in `app.js`, not a field on any element and not part of the code format:
`Reactor.java` has no chamber concept. It is remembered in the prefs blob as a fourth key, `chambers`,
kept as a string like the other three. At load it is the remembered count raised to the design's floor
— `describeBoard`'s `minChambers` — because a design that reaches column 7 cannot stand in a column the
game has not opened, and the page's field always encodes what it draws.

Three refusals, each in the page's own words since the bundle has nothing for any of them:

- a count outside 0..6, or not a whole number: the spinner is put back to the count the page kept, so
  it never shows a number the page ignored;
- closing below what the design fills: refused, since the components standing in the closed columns
  would have nowhere to be — the gate moves only where the design allows it;
- a tap in a closed column: `no Reactor Chamber opens column N`, and the design is untouched.

The gate survives Clear Grid. The count is the visitor's rather than the design's, so emptying the
plan does not empty the reactor they said they built; the frame keeps its crossed columns.

Measured in a real browser at 1280 × 900 (`tools/probe-chambers.mjs`): the gate loads at 6 chambers for
the sample design, Clear Grid leaves it at 6, closing it to 2 crosses 24 cells and the spinner reads 2,
a tap in the first crossed column answers `no Reactor Chamber opens column 6` with the board untouched,
and the prefs blob carries `"chambers":"2"`. `page.test.js` claims the bounds, the label, the closed
gate crossing every column past the core, the out-of-range spinner put back, the closed-column refusal,
and that opening the gate lets the same tap land; `board.test.js` keeps `minChambers` equal to what the
cells imply over every corpus design.

## 31. The run's own text: a readout under the board and a panel for the report

Both halves of the verdict a visitor opens the app for. The Swing frame keeps them in two places that
never meet: a JLabel beside the max-heat label, rewritten after every edit, and a JTextArea the
simulator writes into while it runs.

**The readout** is `UI.TemperatureEffectsSpecific`'s five `%,d` slots, filled from one expression the
frame repeats at four sites (`ReactorPlannerFrame:285-291`, `:327-333`, `:2073-2079`,
`:2695-2701`): the reactor's max heat times 0.4, 0.5, 0.7, 0.85 and 1.0, each cast to an `int`. Java's
`(int)` cast truncates toward zero, so the port is `Math.trunc` and not `Math.floor` — plating can
drive max heat below zero (`reactor.js:176` says so) and a floor would move a negative limit one step
the wrong way. The five factors are the simulator's own: `automation-simulator.js:224-227` decides
`reachedBurn`, `reachedEvaporate`, `reachedHurt` and `reachedLava` against the same four fractions of
the same number, and the report's "will explode at" line is the fifth. Naming them once in
`web/ui/heat.js` is what keeps a visitor from reading one set of gates under the board while a run
uses another. `UI.TemperatureEffectsDefault` is the label's state at construction only — a page always
has a design, so a page always gets the specific line.

The max heat comes from the design at rest (`designReactor`, the desktop's own `tempReactor` move)
rather than from the last run's grid, because a run mutates heat in passing and the label is about the
design's limits. The panel is always shown, unlike every other panel on the page: it is one line of
numbers a visitor needs before they decide anything, and there is no control that opens it.

**The panel** is the desktop's Simulation tab (`ReactorPlannerFrame:1548`, whose one piece of content
is the `outputArea` JTextArea at `:2106-2112`), and the eighth mode chip. The engine already builds the
report — `automation-simulator.js` returns `{ data, report, reactor }`, and `corpus.test.js` has hashed
that report against the Java dump for every design since the corpus baseline was frozen — so this half
is rendering only: one row per `\n`, in the order the Swing JTextArea received them.

Opening the panel runs a simulation for the code the field holds if the page has not run one yet, which
is the desktop's `simulatedReactor` discipline rather than its `UI.SimulateButton`: the tab shows the
last run, it does not start one, and the page has no cancel and no queue. The step is factored into
`ensureRun` and shared with the Inspect popovers, because a second run of the same code would put the
same design into the desktop's history twice and drift the comparison. A design change repaints the
panel while it is open, the same way it repaints the shopping list.

The elapsed-time line is the one line of a report that legitimately differs between two runs of the
same design, so `page.test.js` compares it for presence and leaves its content to `corpus.test.js`,
which strips it before hashing — same marker, same rule.

**Measured** in a real browser at 1280 × 900 (`tools/probe-temperature.mjs`): the line reads
`Burn: 4,880  Evaporate: 6,100  Hurt: 8,540  Lava: 10,370  Explode: 12,200` for the sample design
(max heat 12,200), the eight chips are `Place,Clear,Pick,Inspect,Automate,Materials,Compare,Simulation`
with the panel hidden at load, tapping the chip gives a caption of `Simulation` and 14 rows whose first
is `Simulation started.` and last is `Simulation took 0.00 seconds.`, and tapping `Compare` hides the
panel again. The engine's report string ends with a newline, which is not a line the JTextArea shows,
so the trailing one is dropped — 14 rows, not 15.

**Tests.** `web/test/heat.test.js` is the thirteenth file: the bundle's line must carry exactly five
grouped-integer slots and name all five gates, and under every corpus design the readout's five numbers
must equal `Math.trunc(maxHeat × factor)`, its last gate must equal the reactor's max heat, and its
text must be the five gates spelled out with the bundle's grouping. It is also the file that proves the
readout is not constant: every design printing the same line fails. `page.test.js` claims the panel has
a line that agrees with whatever design the field holds, that the Simulation chip exists and the panel
ships closed, and that the panel's rows are the run's report. `check-imports` goes from 59 edges to 62:
`app.js → heat.js`, `heat.js → comparison.js`, `heat.js → i18n.js`.

## 32. The reactor-level configuration: ten widgets, four ranges, and a refusal that is not a clamp

The audit's first row is the largest control group the page lacked: the desktop's left column holds
the reactor's own settings as Swing widgets — a radio pair (`euReactorRadio` `:1347`,
`fluidReactorRadio` `:1357`), three checkboxes (`pulsedReactorCheck` `:1430`,
`reactorCoolantInjectorCheckbox` `:1476`, and the automation checkbox), the old-style checkbox
(`showOldStyleReactorCodeCheck` `:1741`), and six spinners — and the page read all ten figures out of
the code and showed four of them as chips, with no way to set any. `web/ui/config.js` is the DOM-free
half (`setReactorFlag`, `setReactorNumbers`, `resetPulseConfig`, `pulseAtDefaults`, `maxHeatLabel`),
`index.html` grew `<div id="config" hidden>` and a `Config` mode chip, and `app.js` grew `openConfig`
/ `paintConfig` / `wireConfig`.

Every handler on the desktop is the same two lines — write one field on the `Reactor`, then
`updateCodeField()` — so there is no configuration *model* to port on either side: the ten figures
are already in the code format and the simulator already reads them. What the port had to supply is
the part the page was missing, and it is all bounds:

| Spinner | Swing model | Bound |
|---|---|---|
| `heatSpinner` | `:1409` `SpinnerNumberModel(0.0, 0.0, 9999.0, 1.0)` | 0..9999, a literal |
| `onPulse`, `offPulse` | `pulseDurationModel` `:1978` | `Reactor.MAX_PULSE_DURATION` = 5,000,000 |
| `suspendTemp`, `resumeTemp` | `temperatureModel` `:1983` | `Reactor.CODE_TEMP_BOUND` = 120,000 |
| `maxSimulationTicks` | `tickLimitModel` `:1988` | `Reactor.MAX_SIMULATION_TICKS` = 5,000,000 |

The two pulse ranges differ by four orders of magnitude from the temperature range, which is the
difference between a duration in seconds and a temperature in kelvin; the heat spinner's 9,999 is a
bare literal in the Swing file and the only one of the four that is not a `Reactor.java` constant.
`config.js` names each once and both the panel's `min`/`max` attributes and the engine's refusal read
the same constant, so the control and the code cannot drift apart — the failure mode §P3-12 records
for the automation threshold, where a control declared a maximum nearly a thousand times smaller than
the field's bound.

**A figure outside a spinner's range is refused, not clamped.** The Swing spinner will not move
past its model, so the desktop never has a clamped figure to show; the page answers with the bundle's
label for the field and the bound it offered, and leaves the design where it was. A mixed change with
one bad figure applies none of it — a panel showing three moved spinners and one refusal is a design
that is neither what the visitor asked for nor what it was before.

The pulse tab is a Swing tab, not four greyed spinners: `togglePulseConfigTab` (`:2257`, called at
`:385` and `:2253`) inserts it only while the reactor is pulsed, so the page builds the group only
then, and the group's caption is `UI.PulseConfigurationTab` with `Config.Seconds` spelled out after
the two durations and after nothing else. The reset button is `Reactor.resetPulseConfig`
(`Reactor.java:970`), which touches the four pulse figures and nothing else — the page's button leaves
heat, the tick limit and the pulsed flag alone, which is what makes the claim non-vacuous.

**Two findings the tests caught.** The pulse loop read `if (unitKey === null) continue;` before
appending the row, so the two temperature rows were built and thrown away: the tab had two rows, not
four. `page.test.js` counts them, and the fix moves the unit span inside an `if` so every row reaches
the group. Separately, the max-heat line's format is `UI.MaxHeatSpecific` = `/%,.0f`, a grouped float,
not the `%,d` the temperature-effects line uses — a test that assumed the integer format would have
passed against a mis-shaped label.

## 33. The Component List tab: the list class's own string, not a re-derivation

`Reactor.getComponentList` (`Reactor.java:203`) walks the grid column-major and adds each component's
`name` to a `MaterialsList`; `ComponentName` is an i18n key, so the name is the *localized display
name*, and the tab is that class's `count name` lines in `String.compareTo` order. The Swing side is a
`JTextArea` in a `JScrollPane` (`ReactorPlannerFrame:634-638`) rewritten after every action at the same
four sites that rewrite the max-heat label (`:280`, `:322`, `:2068`, `:2690`) — all four read the
design's reactor, never the last run's grid. `web/ui/component-list.js` wraps the engine's existing
`componentToString` path and returns both the whole string and its lines; `app.js`'s `openComponents`
puts one row per line in `<div id="components" hidden>`.

There is no frozen baseline for this tab: the corpus baseline carries a run's figures and the
component list is never part of a report, so the oracle is the board itself. `component-list.test.js`
claims the counts equal what the decoder found cell by cell, the names are the catalog's display names
rather than the `ComponentName.*` keys the code carries, the order is the list class's, and the rows
are the whole string split at its newlines rather than a re-derivation of it — the engine's string ends
with a newline after every entry, including the last, and a test that split without checking that
would not notice a missing terminator.

One thing the walk's direction does *not* decide: a column-major walk and a row-major walk put the
same components in the same counts, so the tab's output is the same either way. The test says so
rather than assuming the direction is observable, which is why the file asserts order and counts and
never asserts a walk.

## 34. The Simulate button and the old-style checkbox: two controls the audit named

`simulateButton` (`:603`, labelled `UI.SimulateButton` at `:1383`, action at `:2085`) starts a run and
opens nothing; the page's `#simulate` button matches, and `page.test.js` claims the Simulation panel
stays closed under the button and that the rows still match a fresh run after the click. `UI.CancelButton`
stays unbuilt: the desktop's button interrupts a running simulator, and the page's run finishes before
the visitor can click.

The old-style checkbox (`showOldStyleReactorCodeCheck` `:1741`) reaches the ported
`readLegacyCode`/`encodeLegacyCode`, and the format's narrowness is where the interesting behaviour
lives. It has no slot for the tick limit, so the text in the field cannot carry it — the desktop has
the same split, where the `Reactor` object keeps its limit and the textarea's text does not, and the
page follows the object: its spinner still reads 4,000 while re-decoding the field's text gives the
5,000,000 default. And the format's one style letter cannot carry the two automation flags
separately: `encodeLegacyCode` writes `a` for an automated reactor and `readLegacyCode` reads `a` as
automated *and* pulsed, so an automated-not-pulsed reactor gains the pulsed flag rather than losing
one. Both directions are asserted in `config.test.js` as the engine's behaviour, which is the
desktop's behaviour, and not smoothed over in the page.

**Tests.** `config.test.js` and `component-list.test.js` are the fourteenth and fifteenth files: 304
corpus designs read the max-heat line, four switches flip without moving each other, six spinners keep
their own bounds and refuse one step past them, the reset moves only the four pulse figures, and the
old-style format loses the tick limit and gains the pulsed flag. `page.test.js` grew the Config and
Components panels and the Simulate button: the radio pair has one lit chip, the three checkboxes read
the design, the pulse tab has four rows and two unit words, a typed out-of-range duration names the
control in the bundle's words and leaves the spinner where it was, the reset leaves the pulsed flag on,
the old-style code holds as many components as the board shows icons, and the component list's rows are
the engine's lines. `check-imports` goes from 62 edges to 68.

## 35. What the run leaves on the grid: two colours on the cells the visitor edits

"What melts down" is not a report line. The desktop's simulator is a `SwingWorker`, and the run's grid
state travels through its message channel as one-line chunks: `AutomationSimulator` publishes
`R%dC%d:0xRRGGBB` — `:191` silver for **every one of the 54 cells** before the loop starts, `:367`
orange for a component that still holds heat at the end, `:686` red for one that broke — and the
worker's own `process` (`:984-997`) decodes each chunk onto `reactorButtonPanels[row][col]` and sets
that button's tooltip. `reactorButtonPanels` is the frame's **design** grid, not a grid of the run's
own: the run paints the cells the visitor edits, and the colours stay there until the next run clears
them back to silver. `isReactorCellChunk` (`:957-976`) is the shape test, single digits only, and a
chunk that reads as a cell but whose tail is not `0x…` reaches **neither** the report nor a button —
which is why the `return` sits outside the `0x` test.

`automation-simulator.js` already routed the chunks (it dropped them, which is why the corpus baseline
hashes), so the engine change is small: `process` records them in `run.cellPaint` rather than
throwing them away. The tooltip is **stored beside the colour, not derived from it at paint time**, because
Java's three branches are not exhaustive: silver clears the tooltip, red and orange set
`ComponentTooltip.Broken` and `ComponentTooltip.ResidualHeat`, and an unrecognised colour leaves the
button's tooltip alone. A colour-to-words lookup at paint time cannot reproduce that third case.

The page's two decisions over that data:

- **Only a cell the board shows an icon for gets a marker.** The desktop paints all 54 buttons silver,
  which on a Swing grid is the colour every button already has; on this page an empty cell carries its
  own drawing and a closed column carries the cross-hatch (§29), and a run that painted over both would
  silently flatten that vocabulary. Silver is therefore read as "no marker" rather than as a colour.
  The red and the orange are the desktop's own hex values, and the icons carry alpha (colour type 6),
  which is what lets the colour read around the sprite.
- **The legend strip.** The desktop says the same thing as a Swing tooltip on the button; a phone has
  no hover and a screenshot has no tooltip, so `#runlegend` spells the bundle's words out under the
  board, and only for the colours actually on it. The strip stays closed while nothing is marked, which
  is what keeps a page that has never run from claiming a run happened.

The marks persist until the next run, which is the desktop's own behaviour: `process` repaints the same
buttons rather than rebuilding the grid, so `ensureRun` re-marks the board the page already drew, and
`render` re-applies the last run's marks after an edit rebuilds it.

**Two findings only a real browser could catch.** `element.children` is a live `HTMLCollection`, not an
array, so `slot.children.some(...)` throws — the shim's array `children` let the page pass every test
until headless Edge reported `Uncaught TypeError: slot.children.some is not a function`. And `attributes.get`
is the shim's API, not the browser's: the page reads `getAttribute`/`hasAttribute`, and detects a filled
slot by the `data-kind` `render` sets beside the icon rather than by looking for an `<img>` kid (whose
property is `tagName`, not the shim's `tag`).

**Numbers.** 45 of the 304 corpus designs melt something, 9 end with residual heat, and the runs mark
69 cells in total — so the red marker is neither constant nor absent. The authored sample marks nothing,
which is why the legend is closed on load and why the page-level claim is a consistency claim rather
than a count.

**Tests.** `run-grid.test.js` is the sixteenth file: no colour chunk reaches a report (which is what
keeps every baseline hash valid), a melt only ever lands where the desktop's walk found a component,
a cell that melted is never painted orange (the residual pass skips a broken component, `:364`
`!component.isBroken()`), the tooltip words are the bundle's rather than a translation, the page's marks
are a subset of the cells it draws an icon for and are in board order, and the legend names only what
is on the board. `page.test.js` grew the marks and the legend strip: the board's marked slots equal the
run's chunks cell for cell and colour for colour, a marked slot hovers as the bundle's words, no mark
lands on a cell that shows no component, and the strip is open exactly when the board is marked. `check-imports`
goes from 68 edges to 70.

## 36. The Chinese bundle, and the comparison's own copy button

The audit's last two open rows were a data asset and a control, and both are now on the page.

**The second bundle.** `web/data/i18n/zh-CN.json` is 419 strings, made by the same converter run over
`src/Ic2ExpReactorPlanner/Bundle_zh_CN.properties` (`../erp-java-ref/tools/properties-to-json.mjs`,
which names the locale in the output so the file says where it came from). `i18n.test.js` was already
the merge's oracle — 422 keys before and after, the three keys Chinese lacks answering the default's
text, 419 translated patterns checked against the ten upstream breaks — so what the page adds is only
the *choice*: `requestedLocale()` reads `?lang=` over `navigator.language`, `LOCALE_BUNDLES` maps the
language part of a locale code to a file the repo ships, and only the selected file is fetched, which
is `WEB_DESIGN.md` §5's payload rule (422 strings always, 419 more only for a visitor who asked).
A locale with no file leaves the page English rather than broken, the same fallback `BundleHelper.java:11`
makes.

**What a Chinese visitor sees**, from `tools/probe-locale.mjs` over `tools/serve.mjs`:
`LOCALE search=?lang=zh-CN open=true run0 lines=14 englishKept=0 run1 lines=15 englishKept=1
chips[Place,Clear,Pick,Inspect,Automate,Config,Materials,Components,Compare,Simulation] failed=0 detail= err=`.
The Simulation panel answers the merged report line for line — 模拟开始. for the first line,
反应堆在 1 秒时过热. for the ninth — its caption is 模拟, and the Simulate button is 模拟. The probe
runs two designs rather than one: the page's own sample translates fully (14 lines, none left in
English), and the corpus's `single-fuelRodUranium` is the shortest design that writes one of the two
before-overheated output lines, which is the line the merge leaves in English.

**The finding the probe caught on the way.** The three buttons beside the code field were authored
English in `index.html` while every other visible word on the page comes from a bundle, so a Chinese
visitor read Chinese report lines under English buttons. They are now labelled from the bundle in the
three `wire*` functions (`UI.CopyCodeButton`, `UI.ClearGridButton`, `UI.SimulateButton`), which is a
no-op for an English visitor — the English answers *are* the authored words, and a DOM dump of the
plain page still reads `Copy Code`, `Clear Grid`, `Simulate` — and the only place those three appear
in another locale is where the bundle has a key. The mode chips stay authored on purpose: the bundle
has no key for a mode, and the probe asserts the chips stayed English rather than letting a word slip
in untranslated and quietly wrong.

**Copy Comparison Data** is `UI.CopyComparisonData` (`ReactorPlannerFrame.java:1855`, action at
`:2385-2389`), which puts `comparisonLabel.getText()` on the system clipboard as an `HtmlSelection`.
The page writes the panel's own rows joined with newlines through `navigator.clipboard.writeText` —
the Clipboard API offers `writeText`, not a rich selection — and takes the same quiet route Copy Code
takes when the API is missing, because the desktop reports nothing about a copy either. `tools/probe-comparison.mjs`
grew the claim: the rows the button hands over equal the comparison the engine builds in node, line
for line (`copyExact=true copyChars=1644 expectedChars=1644`), and the tap leaves the panel and the
strip untouched (`rowsUnchanged=true`). The instrument stops one step short and says so in its header:
a headless browser has no system clipboard to read back, and Edge refuses a probe that swaps
`navigator.clipboard` for a recorder (it is a getter-only accessor), so the text is proven and the
write is not.

**Numbers.** 419 Chinese strings against 422 English, and the three keys only English has are
`Simulation.AbortedByError`, `Simulation.EUOutputsBeforeOverheated` and
`Simulation.HeatOutputsBeforeOverheated`. The two output lines are not exotic: 201 of the 304 corpus
designs write one of them, so a Chinese visitor reads an English sentence in the middle of a Chinese
report on two thirds of the corpus — which is what the probe's second run holds (`run1 lines=15
englishKept=1`), and what a page that swapped the bundle instead of merging it would leave as a hole.
The third key sits on an aborted run, which the page cannot produce. The authored design's 14 report
lines all translate.

**Tests.** `page.test.js` grew the three live label claims: each of the three buttons is checked both
in the page file and on the live element, since the words now come from the bundle at startup and a
test that read only the file would miss a locale that disagrees. It grew the comparison copy button
too — the label equals the bundle's, the tap adds nothing to the error strip, and the panel is not
redrawn. `i18n.test.js` needed nothing: the merge was already its oracle. `check-imports` stays at
70 edges, which is the honest sign that these two items added controls and data rather than a new
layer.
