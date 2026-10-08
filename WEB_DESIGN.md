# Web UI & Engine Design — Ic2ExpReactorPlanner

Design decisions settled **before** Stage 1. Read alongside `WEB_MIGRATION_PLAN.md`.

Everything below is grounded in the Swing source, not invented. Where the web shape
differs from the desktop shape, the desktop shape is cited so the port can be checked
against it.

---

## 1. Orientation: portrait phone **and** desktop monitor

### The binding constraint is width, not height

The board is `grid[6][9]` — 9 columns × 6 rows. Measured against real CSS viewport widths
(24 px total page padding):

| Viewport | Gap 0 px | Gap 2 px | Board height at that cell size |
|---|---|---|---|
| 360 (Android) | 37.3 px/cell | 35.6 px | 223 px |
| 375 (iPhone SE) | 39.0 px | 37.2 px | 233 px |
| 390 (iPhone 14) | 40.7 px | 38.9 px | 243 px |
| 412 | 43.1 px | 41.3 px | 258 px |
| 430 (Pro Max) | 45.1 px | 43.3 px | 270 px |

**The whole board is ~223–270 px tall.** On a 780 px-tall portrait viewport that leaves
~500 px for controls. Portrait is not a squeeze — it is the comfortable case. Width is the
only thing that binds, and it binds only mildly: cells land at 36–45 px, against a 44 px
touch guideline.

### Options considered

| Option | Verdict |
|---|---|
| **A. Scale-to-fit width.** Board always renders 9×6. Cell size = `min((vw − pad − gaps)/9, (vh − pad − gaps)/6)`, clamped to `[32, 96]` px. | **Adopt as default.** One DOM, no data change, icons stay upright, adjacency reads correctly. |
| **B. Transpose to 6×9 on portrait.** 6 cols × 44 px = 264 px, roomy. | **Reject as default.** Reactor layout is spatial — vents cool named neighbours, reflectors face rods. A transpose changes how the design reads to the user. If ever offered, it must be an explicit labelled mode, never automatic. |
| **C. CSS `transform: rotate(90deg)` the whole board.** | **Offer as a user setting, off by default.** Honest (the board is a physical object; the user tilts their head) and it is one CSS rule. Counter-rotate text labels or they become unreadable. |
| **D. Pinch-zoom / pan the board.** | **Adopt as a gesture, not a layout.** Needed only to inspect a 36 px cell closely, and to read a component's state. Does not change the layout, so it cannot mislead. |
| **E. Orientation lock to landscape.** | **Reject.** User wants portrait. |

**Decision: A + D, with C available as a setting.** One DOM, driven by CSS custom
properties, with `@media (hover: none), (pointer: coarse)` selecting touch sizing. No
second layout, no transposed data path, nothing that can silently change what the design
means.

### The thing that actually doesn't fit on a phone

Not the board — the **palette**. `componentsGroup` is a Swing `ButtonGroup` of 72
components (`ReactorPlannerFrame.java:5`, `ReactorPlannerFrame.form:5`). A wall of 72
buttons is unusable on a phone.

Web palette:
- Group by the mod tag already carried as the 7th constructor argument in
  `ComponentFactory.java` (`null` = IC2 core, `"GTNH"`, `"FM"`, `"GG"`) plus the class
  (`FuelRod`, `CoolantCell`, `Vent`, `Exchanger`, `Condensator`, `Reflector`, `Plating`,
  `BreederCell`, `GGFuelRod`). That is a real taxonomy that already exists in the data.
- Scrollable list of ≥ 40 px tap targets, or a 3-column chip grid.
- "Recently used" shortcut, plus the pick gesture below, which is the main way back.

---

## 2. Interaction model

### What the desktop actually does

Read from `ReactorPlannerFrame.java:130–330`:

| Gesture | Effect |
|---|---|
| Palette button click | Sets `paletteComponentId`. `componentsGroup` is a **radio** group — exactly one component is selected at all times. Also pushes that component's `initialHeat` / `automationThreshold` / `reactorPause` into three spinners. |
| Left-click a grid cell | `reactor.setComponentAt(row, col, createComponent(selection))` with the three spinner values |
| Right-click a grid cell | `reactor.setComponentAt(row, col, null)` |
| Alt + click a grid cell | Pick up: reads the cell's component, copies its three settings into the palette, and clicks the matching palette button |
| Per-cell "Automate" button | Selects the automation tab and shows that cell's settings |
| Per-cell "Info" button | Shows that cell's post-simulation `component.info` |

**Key finding:** the desktop model already has a single "selected component" concept.
Touch needs only **two gesture substitutions** — there is no right-click and no Alt —
not a redesign.

### Web model

| Action | Mouse | Touch |
|---|---|---|
| Select component | Click palette chip | Tap palette chip (identical) |
| Place in cell | Click cell | Tap cell (identical) |
| Clear cell | Right-click | **Mode toggle**: a `Clear` chip in the palette, so tapping a cell clears it. Also `long-press` as a shortcut. |
| Pick up from cell | Alt + click | **`Pick` mode chip**, then tap a cell. Also `long-press` as a shortcut. |
| Cell detail | Hover tooltip | Tap cell while in `Inspect` mode → popover |

A mode chip (`Place` / `Clear` / `Pick` / `Inspect`) is more reliable on touch than
long-press alone, and long-press is offered as the fast path for people who discover it.
The default mode is `Place`, which matches the desktop default, so muscle memory carries
over.

The 54 × 2 tiny per-cell `Automate` / `Info` buttons (`componentDetailButtons`) are
**dropped from the layout** — at 36 px cells they are physically unusable. Their data is
still reachable through `Inspect` mode. The existing
`showComponentDetailButtonsCheck` setting already gates them on desktop, which confirms
they were always optional.

---

## 3. Feature triage

The Swing frame has 8 output tabs plus a pulse-config tab (`ReactorPlannerFrame.java`
lines 1548–2261).

### Keep — the core loop

| Feature | Why it's core |
|---|---|
| 6×9 grid render with component icons | the board |
| Palette, place, clear, pick | the board editing |
| Clear grid (`UI.ClearGridButton`) | requested |
| Run simulation (`UI.SimulateButton`) + cancel (`UI.CancelButton`) | requested |
| Simulation output text (`UI.SimulationTab`) | the results |
| Reactor config: fluid/EU (`Config.EUReactor`/`Config.FluidReactor`), pulsed, automated, RCIs, max heat, initial heat, on/off pulse, suspend/resume, max sim ticks | every one changes the numbers |
| Temperature effects readout (`UI.TemperatureEffects*`) | the 0.4 / 0.5 / 0.7 / 0.85 × maxHeat thresholds — this is the safety verdict users come for |
| Materials list (`UI.MaterialsTab`) | what to build |
| Component list (`UI.ComponentListTab`) | what is placed |
| Reactor code: `getCode()` / `setCode()`, copy + paste (`UI.CopyCodeButton`, `UI.PasteCodeButton`) | the entire reason the app exists — sharing designs |
| Warnings (`WarningDisplay`, invalid code, depleted isotope, unrecognised id) | bad-paste handling |
| `gtVersionCombo` (None / 5.08 / 5.09 / GTNH) | a real mode that changes component availability and recipes — not fat |
| `showOldStyleReactorCodeCheck` | the legacy hex code format is staying, so its toggle stays |
| `expandAdvancedAlloyCheck` | materials-list expansion, one checkbox |

### Drop — decided

| Feature | Where |
|---|---|
| CSV tab | `UI.CSVTab`, `Config.CSVCheckbox`, `Config.CSVLimit`, 12 `CSVData.*` keys, 33 sites in `AutomationSimulator.java` |
| Texture pack tab | `UI.TexturePack*`, `erpprefs.xml` zip half |
| Talonius legacy code | `TaloniusDecoder.java`, `Reactor.handleTaloniusCode` (153 LOC) |
| 54 × 2 per-cell Automate/Info buttons | `componentDetailButtons` — replaced by `Inspect` mode |

### Defer — keep the data, postpone the UI

| Feature | Note |
|---|---|
| Comparison tab (`UI.ComparisonTab`, 39 `Comparison.*` keys, `lockPrevCodeCheck`, `onlyShowDiffDataCheck`) | `SimulationData` already carries everything the comparison needs, so the engine keeps it. The UI is a Stage-5 decision. |
| Per-cell post-sim info (`UI.ComponentTab`, `component.info`) | Data is already on the component. UI shape is `Inspect` mode. |
| Per-cell automation panel (`UI.ComponentAutomationTab`) | Same. |
| `erpprefs.xml` preferences (`loadAdvancedConfig`/`saveAdvancedConfig`, frame lines 411/454) | Becomes `localStorage` or is dropped. Not needed to run the app. |

---

## 4. Branch strategy

`desktop` keeps the Java app. `web` carries **zero Java**.

### Delete from `web`

```
src/Ic2ExpReactorPlanner/*.java          (all 23 .java, incl. the GUI)
test/**                                   (527 JUnit tests)
build.gradle  settings.gradle  gradle.properties  gradlew  gradlew.bat
gradle/**  .gradle/**  build/**
.github/workflows/build-and-test.yml      (Gradle/JDK 8 based — replace)
.github/workflows/release-tags.yml        (Maven publish to jenkins.usrv.eu — replace)
```

### Keep in `web`

```
testResources/corpus-baseline.txt         <- text fixture, not Java. The oracle.
src/assets/**/*.png                       <- 78 icons, 162 KB
src/Ic2ExpReactorPlanner/Bundle*.properties  <- i18n source, compiled to JSON
LICENSE  README.md  RELEASE_NOTES.md  CODE_REVIEW.md
WEB_MIGRATION_PLAN.md  WEB_DESIGN.md
```

### The oracle survives the Java removal

`corpus-baseline.txt` is a `|`-delimited text file — 304 designs, 312 lines, read by
both sides. Removing Java from `web` does not remove the oracle, it removes the ability
to **regenerate** it. So:

1. Regenerate once **on the `desktop` branch**: `./gradlew test -Derp.writeBaseline=true`.
2. Commit that file into `web` and record the desktop commit/tag it came from, in a
   header line. A future mismatch is then attributable to a specific reference build.
3. In `web`, the baseline is **frozen golden data**. `corpus.test.js` reads it and fails
   on drift. Never regenerate it in `web` — there is nothing to regenerate from.
4. Replace the Gradle CI workflow with a Node one: run `corpus.test.js` + the unit tests,
   and a static-site deploy step.

Desktop's P0 fixes are already applied and its 527 tests pass, so the desktop build is a
*correct* reference. That is what makes the frozen baseline meaningful.

---

## 5. Performance and fat-trimming

### 5.1 Make the engine pure before making it fast

`AutomationSimulator` is GUI-coupled today: it `extends SwingWorker<Void, String>`, takes
a `JTextArea output` and a `JPanel[][] reactorButtonPanels` in its constructor, and calls
`publish(String.format("R%dC%d:0xC0C0C0", row, col))` per cell (line 190) plus ~20 more
`publish()` / `firePropertyChange()` calls.

The port takes a **progress callback** instead:

```js
simulate(reactor, { onProgress, onCancel })   // no DOM, no Swing, no textarea
```

This is the single change that turns the engine testable headlessly — and the corpus
runner is a headless test.

### 5.2 Data-oriented, not object-oriented

The Java version went flat-list in P2-2 (`tickComponents`, `tickCell`). In JS, go one
step further: **struct of arrays** over the 54 cells.

```js
// per-cell, length 54
id            Int32Array
row, col      Int32Array        // or derived: cell = row * 9 + col
currentHeat   Float64Array
maxHeat       Float64Array
currentDamage Float64Array
maxDamage     Float64Array
initialHeat   Float64Array
automThreshold Int32Array
reactorPause  Int32Array
// per-tick accumulators, reset each tick
eugenerated   Float64Array
heatgenerated Float64Array
hullHeating   Float64Array
...
```

Why it matters: 54 JS objects with ~30 properties each, mutated in a loop that runs up to
4,000 times per design and 304 designs per corpus run, is where V8's inline caches and
shape transitions actually cost. `Float64Array` access is unboxed and monomorphic.

**If you keep the OO shape instead**, the one hard rule is that all 9 component
subclasses must produce **identical hidden-class shapes** — no subclass adding a field
the others lack. `GGFuelRod` and `Vent` are the likely offenders; check before shipping.

### 5.3 Hot-loop rules

1. Index loops, not `for...of` over objects — mirrors the Java `for (int i = 0; i < tickComponents.length; i++)` already used at lines 406, 795, 889.
2. No closures, no allocation in the tick body.
3. **No formatting in the tick loop.** `DecimalFormat`, `Intl`, `toFixed` only at report time. The Java version already hoists the bundle lookups out (P2-3); same idea.
4. Precompute per-run invariants once (`clockPeriod`, the threshold flags, the flat cell list) — the Java constructor already does this at lines 122–135.
5. Keep the cancel check in the loop. It is what bounds pathological runs, and it is free.

### 5.4 Chunked execution

```js
const BUDGET_MS = 8;            // ~one frame at 60 Hz
while (ticks < cap && !cancelled) {
  const t0 = now();
  do { tick(); } while (ticks < cap && now() - t0 < BUDGET_MS);
  await nextFrame();            // let the UI paint, keep the progress bar live
}
```

Only needed for the pathological case. All 304 corpus designs finish in ≤ 4,000 ticks,
which is single-digit milliseconds — the chunking exists for the 5M-cap design, not the
common one.

### 5.5 Payload

| Item | Desktop | Web |
|---|---|---|
| Icons | 78 PNGs, 162 KB, loaded via `javax.imageio` | **one sprite sheet**, 1 request, 1 decode, CSS `background-position` |
| i18n | 454 + 451 lines, `ResourceBundle` loads at startup | `en.json` only by default; `zh-CN.json` fetched **only** when the locale is selected |
| Framework | — | **none.** Plain ES modules + one CSS file. No React, no Vue, no bundler-required runtime |
| Java runtime | JVM | none — static files, GitHub Pages / Netlify |

Target: **under 300 KB** total, first paint under one second on a phone.

### 5.6 Measure before optimising further

`CODE_REVIEW.md` says the Java repo has **no benchmark harness**. The web port should not
repeat that mistake: `corpus.test.js` running all 304 designs **is** a harness. Print its
wall time and ns/tick, and keep the two relative invariants `SimulationCostTest` already
asserts (per-tick cost flat in the tick cap; a five-component design far cheaper per tick
than the same design plated). Do not reach for WASM before those numbers say you need it.

---

## 6. Settled in this pass

1. **Comparison view: the UI lands in Stage 5**, not dropped. `SimulationData` already carries
   everything it needs, so the engine is unchanged either way; only the panel is deferred.
2. **`localStorage`, scoped to three keys.** Persist `gtVersion`, the non-base availability toggle,
   and the last loaded reactor code — nothing else. The design itself needs no persistence: the
   reactor code string *is* the design, and copy/paste is the app's whole reason for existing.
   What does not fit in a code string is the mod selection, and that is the one thing a phone
   user would otherwise re-pick every visit. The blob carries a schema key and a visible
   "reset to defaults"; nothing is sent anywhere. Of `erpprefs.xml`'s eight settings, two were
   already dropped (texture pack, CSV), one dies with the 54 × 2 buttons, one dies with decision
   4 (`showComponentPreconfigControls`), and `expandAdvancedAlloy` is decided with the materials
   panel rather than here.
3. **Palette: a non-base toggle plus a class filter.** Availability is a catalog axis — `sourceMod`
   splits 26 base from 46 mod (Coaxium 6, GT5.08 9, GT5.09 4, GTNH 27) — so a toggle filters it
   cleanly. Behaviour is a *separate* axis and stays a four-state selector: `gt509behavior`,
   `gtnhbehavior` and `mcVersion` change the numbers, and 5.08 / 5.09 / GTNH disagree with each
   other, so one on/off switch cannot stand in for `gtVersionCombo`.
4. **`Inspect` replaces the Component tab outright, at every viewport; the editing half becomes a
   fifth mode chip, `Automate`.** The two Swing tabs are different kinds of thing: the Component
   tab is a post-simulation *readout* of `component.info` (up to 11 lines — broke/replaced time,
   reached heat, cooling used, EU and heat generated, residual heat, cooldown time, breeder
   progress), which the JS engine already builds and only needs something to render; the
   Component Automation tab is pre-simulation *editing* of a cell's `h`/`a`/`p` params. A single
   popover that is read-only sometimes and carries spinners other times is what makes a mobile UI
   feel broken, so the chips are `Place` / `Clear` / `Pick` / `Inspect` / `Automate`, default
   `Place`. The Swing tabs are not re-created as wide-viewport panels: the tab is a global panel
   you look away from, and on the web the popover *is* the board cell.

**`mcVersion` is pinned, not selectable.** The planner targets 1.7.10-era mods, so the version
spinner is dropped from the UI and the app pins `setMcVersion('1.7.10')` at startup. The engine
mirror keeps Java's `1.12.2` default and `setMcVersion` stays exported, because `components.test.js`
exercises both values against the Java oracle — the pin is a product decision, not an engine one.
Worth knowing: the effect is `getMaxDamage()` returning `maxDamage / 3` for the two reflectors
with capacity above 1 (30,000 and 120,000), so reflector durability and depletion times read 3×
shorter than the desktop default. **The corpus cannot arbitrate this** — 69 of 304 designs carry
the `reflector` tag, and pinning `1.7.10` moves zero baseline lines, because no corpus design
damages a reflector enough to reach the difference. The frozen baseline was generated at the
`1.12.2` default and stays clean under either pinning, which is to say the oracle says nothing
about it. This is a behaviour decision, not one the diff can check.
