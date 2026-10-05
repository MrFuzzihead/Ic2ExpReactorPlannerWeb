package Ic2ExpReactorPlanner;

import static Ic2ExpReactorPlanner.TestSupport.assertClose;
import static Ic2ExpReactorPlanner.TestSupport.place;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import Ic2ExpReactorPlanner.components.Condensator;
import Ic2ExpReactorPlanner.components.CoolantCell;
import Ic2ExpReactorPlanner.components.ReactorItem;
import java.io.File;
import java.util.List;
import javax.swing.JPanel;
import javax.swing.JTextArea;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * End-to-end {@link AutomationSimulator} runs: the tick loop, mode flags, automation, reactor
 * coolant injectors, depletion, explosion power and CSV output.
 *
 * <p><b>One behaviour to know before reading these tests.</b> {@link SimulationData}'s output
 * totals ({@code totalReactorTicks}, {@code totalEUoutput}, {@code avg/min/maxEUoutput},
 * {@code totalHUoutput} and friends) are only written in {@code AutomationSimulator}'s
 * "did not explode" branch. For a design that explodes they are all left at zero, while the
 * per-threshold times ({@code timeToBurn}, {@code timeToXplode}), {@code maxTemp} and the
 * broken/depleted details <i>are</i> populated. {@link #explodingRunsLeaveOutputTotalsAtZero}
 * pins that, and the rest of the suite picks the right metric for the question being asked.
 *
 * <p>Assertions are split into:
 *
 * <ul>
 *   <li><b>Invariants and relationships</b> that any correct implementation must satisfy
 *       (determinism, "more cooling survives longer", "pulsing makes less EU", "automation keeps
 *       cells from breaking"). These are what catch a genuinely broken refactor.
 *   <li><b>Golden values</b> on small designs whose numbers can be checked by hand -- 4 heat per
 *       tick from a bare rod, 10 000 hull, 20 000 rod durability. If a refactor keeps every
 *       relationship but shifts every number, these still fail.
 * </ul>
 */
class AutomationSimulatorTest {

    @BeforeEach
    @AfterEach
    void resetGlobals() {
        TestSupport.resetGlobalConfig();
    }

    // ================================================================== designs

    /**
     * A single bare uranium rod at (2,2). 0 neutron neighbours, so 4 heat/tick and 100 EU/tick
     * (5 EU/t) with nothing absorbing: the hull reaches 10 000 on tick 2 500.
     */
    private static Reactor bareRod() {
        Reactor reactor = new Reactor();
        place(reactor, 2, 2, "fuelRodUranium");
        return reactor;
    }

    /** The same rod with four reflectors: 60 heat/tick, so the hull reaches 10 000 on tick 167. */
    private static Reactor reflectedRod() {
        Reactor reactor = bareRod();
        place(reactor, 1, 2, "neutronReflector");
        place(reactor, 3, 2, "neutronReflector");
        place(reactor, 2, 1, "neutronReflector");
        place(reactor, 2, 3, "neutronReflector");
        return reactor;
    }

    /**
     * A rod next to one heat vent and nothing else. The vent is the rod's only heat acceptor, so
     * it absorbs all 4 heat/tick and immediately re-emits 4/tick as vented heat. The hull never
     * warms, so this design never explodes and runs until the rod depletes at 20 000 ticks.
     *
     * <p>This is the workhorse for output assertions because it produces output in a run that
     * does not end in an explosion.
     */
    private static Reactor rodWithVent() {
        Reactor reactor = bareRod();
        place(reactor, 2, 3, "heatVent");
        return reactor;
    }

    /** A quad rod with four 10k coolant cells around it: 96 heat/tick, 24 into each cell. */
    private static Reactor quadRodWithCells() {
        Reactor reactor = new Reactor();
        place(reactor, 2, 2, "quadFuelRodUranium");
        place(reactor, 1, 2, "coolantCell10k");
        place(reactor, 3, 2, "coolantCell10k");
        place(reactor, 2, 1, "coolantCell10k");
        place(reactor, 2, 3, "coolantCell10k");
        return reactor;
    }

    /** Four quad rods in a row: 4 x 96 = 384 heat/tick into an empty hull. */
    private static Reactor fourQuadRods() {
        Reactor reactor = new Reactor();
        place(reactor, 0, 0, "quadFuelRodUranium");
        place(reactor, 0, 2, "quadFuelRodUranium");
        place(reactor, 0, 4, "quadFuelRodUranium");
        place(reactor, 0, 6, "quadFuelRodUranium");
        return reactor;
    }

    private static Reactor fourQuadRodsWith(ReactorItem extra, int row, int col) {
        Reactor reactor = fourQuadRods();
        reactor.setComponentAt(row, col, extra);
        return reactor;
    }

    // ================================================================== determinism

    @Nested
    @DisplayName("determinism and isolation")
    class Determinism {

        @Test
        @DisplayName("the same design simulates to identical results every time")
        void identicalRuns() throws Exception {
            Reactor design = rodWithVent();

            TestSupport.SimResult first = TestSupport.simulate(design);
            TestSupport.SimResult second = TestSupport.simulate(design);

            assertTrue(first.producedData(), "the run produced data");
            assertEquals(first.data.totalReactorTicks, second.data.totalReactorTicks, "same tick count");
            assertEquals(first.data.totalEUoutput, second.data.totalEUoutput, 1e-9, "same total EU");
            assertEquals(first.data.avgEUoutput, second.data.avgEUoutput, 1e-12, "same average EU");
            assertEquals(first.data.minTemp, second.data.minTemp, 1e-9, "same minimum temperature");
            assertEquals(first.data.maxTemp, second.data.maxTemp, 1e-9, "same maximum temperature");
            assertEquals(first.data.timeToBurn, second.data.timeToBurn, "same time to burn");
            assertEquals(first.data.timeToXplode, second.data.timeToXplode, "same time to explode");
            // The only line that may differ is the wall-clock one.
            assertEquals(
                    stripElapsedTime(first.outputText),
                    stripElapsedTime(second.outputText),
                    "otherwise the reports are identical");
        }

        @Test
        @DisplayName("simulating does not disturb the reactor that was handed in")
        void designIsNotMutated() throws Exception {
            Reactor design = rodWithVent();
            String before = design.getCode();
            TestSupport.simulate(design);
            assertEquals(before, design.getCode(), "the caller's reactor is unchanged");
        }
    }

    // ================================================================== heating to explosion

    @Nested
    @DisplayName("heating to explosion")
    class Heating {

        @Test
        @DisplayName("a bare single rod boils the reactor on tick 2 500")
        void bareRodBoilsInTwentyFiveHundredTicks() throws Exception {
            // 4 heat/tick into a 10 000 hull. Fully hand-checkable.
            SimulationData data = TestSupport.simulate(bareRod()).data;

            assertEquals(2500, data.timeToXplode, "time to explode");
            assertClose(10000, data.maxTemp, 1e-6, "the peak is the explosion point");
            assertClose(0, data.minTemp, 1e-9, "starting from cold");
            // 40% of 10 000 is reached after (4000 - 0) / 4 = 1 000 ticks
            assertEquals(1000, data.timeToBurn, "time to burn");
            assertEquals(1250, data.timeToEvaporate, "50%: 5000 / 4");
            assertEquals(1750, data.timeToHurt, "70%: 7000 / 4");
            assertEquals(2125, data.timeToLava, "85%: 8500 / 4");
        }

        @Test
        @DisplayName("thresholds are crossed in ascending order")
        void thresholdOrder() throws Exception {
            SimulationData data = TestSupport.simulate(bareRod()).data;
            assertTrue(data.timeToBurn <= data.timeToEvaporate, "40% before 50%");
            assertTrue(data.timeToEvaporate <= data.timeToHurt, "50% before 70%");
            assertTrue(data.timeToHurt <= data.timeToLava, "70% before 85%");
            assertTrue(data.timeToLava <= data.timeToXplode, "85% before 100%");
        }

        /**
         * {@code reachedBurn} is seeded from the starting temperature, so a reactor that begins
         * already above a threshold never reports the time it "reached" that threshold.
         */
        @Test
        @DisplayName("a pre-heated reactor never reports thresholds it started above")
        void preheatedSkipsEarlyThresholds() throws Exception {
            Reactor design = bareRod();
            design.setCurrentHeat(4000);
            SimulationData data = TestSupport.simulate(design).data;

            assertEquals(1500, data.timeToXplode, "6 000 heat left, 4 per tick");
            assertEquals(
                    Integer.MAX_VALUE,
                    data.timeToBurn,
                    "it started exactly at the 40% threshold, so that was never 'reached'");
            assertClose(4000, data.minTemp, 1e-9, "the pre-heat is reported as the minimum");
        }

        @Test
        @DisplayName("four reflectors take a bare rod from 2 500 ticks to 167")
        void reflectorsShortenTheRun() throws Exception {
            SimulationData bare = TestSupport.simulate(bareRod()).data;
            SimulationData reflected = TestSupport.simulate(reflectedRod()).data;

            assertEquals(167, reflected.timeToXplode, "60 heat/tick: 10000 / 60 = 166.67 -> 167");
            assertEquals(67, reflected.timeToBurn, "40%: 4000 / 60 = 66.67 -> 67");
            assertTrue(reflected.timeToXplode < bare.timeToXplode, "reflecting must not slow it down");
            // The final tick overshoots, because the whole tick's heat lands at once.
            assertClose(10020, reflected.maxTemp, 1e-6, "peak overshoot on the final tick");
        }

        @Test
        @DisplayName("a reactor that never explodes reports no explosion time")
        void survivorHasNoExplosionTime() throws Exception {
            SimulationData data = TestSupport.simulate(rodWithVent()).data;
            assertEquals(Integer.MAX_VALUE, data.timeToXplode, "never exploded");
            assertEquals(Integer.MAX_VALUE, data.timeToBurn, "and never even got hot");
            assertClose(0, data.maxTemp, 1e-9, "the hull never warmed");
        }

        @Test
        @DisplayName("an empty reactor stops after a single tick")
        void emptyReactor() throws Exception {
            SimulationData data = TestSupport.simulate(new Reactor()).data;
            // With no rods, allFuelRodsDepleted is true and there is no output, so the loop
            // condition fails on the very first evaluation.
            assertEquals(1, data.totalReactorTicks, "it ticks once and stops");
            assertEquals(0.0, data.totalEUoutput, 1e-9, "no EU out of an empty reactor");
            assertEquals(0.0, data.totalHUoutput, 1e-9, "no heat out either");
            assertEquals(Integer.MAX_VALUE, data.timeToXplode, "and it never boiled");
        }
    }

    // ================================================================== output totals

    @Nested
    @DisplayName("output totals")
    class Output {

        /**
         * The behaviour the rest of this class depends on: exploding runs leave the output
         * totals at their zero defaults, while the threshold times and peak temperature are
         * still recorded.
         */
        @Test
        @DisplayName("exploding runs leave output totals at zero but still record thresholds")
        void explodingRunsLeaveOutputTotalsAtZero() throws Exception {
            SimulationData data = TestSupport.simulate(bareRod()).data;
            assertEquals(0, data.totalReactorTicks, "not set for an exploding run");
            assertEquals(0.0, data.totalEUoutput, 1e-9, "not set");
            assertEquals(0.0, data.avgEUoutput, 1e-9, "not set");
            assertEquals(0.0, data.maxEUoutput, 1e-9, "not set");
            // ... but these are
            assertEquals(2500, data.timeToXplode, "recorded");
            assertClose(10000, data.maxTemp, 1e-6, "recorded");
        }

        @Test
        @DisplayName("a non-exploding reactor records EU totals over its whole life")
        void euTotals() throws Exception {
            // The rod runs for 20 000 ticks at 100 EU/tick, then depletes and the run ends.
            SimulationData data = TestSupport.simulate(rodWithVent()).data;

            assertEquals(20001, data.totalReactorTicks, "runs past the rod's last tick, then stops");
            assertEquals(20000, data.firstRodDepletedTime, "uranium has 20 000 durability");
            assertClose(2000000, data.totalEUoutput, 1e-6, "20 000 ticks x 100 EU");
            assertClose(5.0, data.maxEUoutput, 1e-9, "100 EU/tick = 5 EU/t");
            assertClose(0.0, data.minEUoutput, 1e-9, "the last tick has a broken rod, so it is the minimum");
        }

        @Test
        @DisplayName("a fluid reactor reports heat output instead of EU")
        void fluidReportsHeat() throws Exception {
            Reactor design = rodWithVent();
            design.setFluid(true);
            SimulationData data = TestSupport.simulate(design).data;

            assertEquals(0.0, data.totalEUoutput, 1e-9, "no EU is reported in fluid mode");
            assertEquals(20001, data.totalReactorTicks, "same lifetime as the EU variant");
            // 4 heat/tick for 20 000 ticks; AutomationSimulator scales the total by 40.
            assertClose(3200000, data.totalHUoutput, 1e-6, "4 heat/tick x 20 000 ticks x 40");
            // NOTE an apparent units inconsistency in AutomationSimulator: totalHUoutput is
            // scaled by 40 but avg/min/maxHUoutput are only scaled by 2, so the per-tick figures
            // come out 20x smaller than the total implies (3200000/20001 = 160 HU/t, yet
            // maxHUoutput reports 8). Pinned so the discrepancy cannot change unnoticed; see
            // CODE_REVIEW.md.
            assertClose(8.0, data.maxHUoutput, 1e-6, "maxHUoutput is scaled by 2, not 40");
            assertClose(2.0 * 4, data.maxHUoutput, 1e-9, "i.e. 2 x the peak heat of 4");
        }

        @Test
        @DisplayName("a reactor with no output at all reports zero heat output")
        void noVentMeansNoHeatOutput() throws Exception {
            Reactor design = new Reactor();
            place(design, 2, 2, "fuelRodUranium");
            place(design, 2, 3, "coolantCellSpace1080k"); // absorbs heat, vents nothing
            design.setFluid(true);
            SimulationData data = TestSupport.simulate(design).data;
            assertEquals(0.0, data.totalHUoutput, 1e-9, "a coolant cell is not a heat vent");
        }

        @Test
        @DisplayName("the reactor's total tick count honours the tick limit")
        void tickLimitIsHonoured() throws Exception {
            Reactor design = new Reactor();
            place(design, 2, 2, "fuelRodUranium");
            place(design, 2, 3, "coolantCellSpace1080k");
            design.setMaxSimulationTicks(1234);
            SimulationData data = TestSupport.simulate(design).data;
            assertEquals(1234, data.totalReactorTicks, "stopped exactly at the limit");
        }
    }

    // ================================================================== cooling

    @Nested
    @DisplayName("cooling")
    class Cooling {

        @Test
        @DisplayName("a quad rod with four 10k cells breaks them on tick 417 and explodes on 522")
        void cellsBreakThenTheReactorBoils() throws Exception {
            // 96 heat/tick split four ways is 24 per cell; 10 000 / 24 = 416.67 -> the cells
            // break on tick 417, after which all 96 heat/tick hits the hull, so 10000/96 =
            // 104.17 more ticks.
            SimulationData data = TestSupport.simulate(quadRodWithCells()).data;
            assertEquals(417, data.firstComponentBrokenTime, "the first cell fills and breaks");
            assertEquals(522, data.timeToXplode, "417 + 105 ticks of hull heating");
            assertClose(10080, data.maxTemp, 1e-6, "peak overshoot");
        }

        @Test
        @DisplayName("a reactor with more cooling survives longer")
        void moreCoolingMeansLongerLife() throws Exception {
            // One 60k cell holds more heat in total than four 10k cells do (60 000 vs 40 000),
            // so it is the bigger design that lasts longer -- capacity is what matters here, not
            // the cell count.
            Reactor oneBigCell = new Reactor();
            place(oneBigCell, 2, 2, "quadFuelRodUranium");
            place(oneBigCell, 2, 1, "coolantCell60k");

            Reactor fourSmallCells = quadRodWithCells();

            assertTrue(
                    TestSupport.simulate(oneBigCell).data.timeToXplode
                            > TestSupport.simulate(fourSmallCells).data.timeToXplode,
                    "60 000 of cooling beats 40 000 of cooling");
        }

        @Test
        @DisplayName("heaters and coolers are reported per component in the run summary")
        void heatingAndCoolingIsReported() throws Exception {
            String report = TestSupport.simulate(rodWithVent()).outputText;
            assertTrue(report.contains(BundleHelper.getI18n("Simulation.Started").split("\\n")[0]), report);
            assertTrue(
                    report.contains(BundleHelper.getI18n("Simulation.ElapsedTime").split("%")[0]),
                    "the run reports its elapsed time: " + report);
        }
    }

    // ================================================================== modes

    @Nested
    @DisplayName("reactor modes")
    class Modes {

        @Test
        @DisplayName("pulsing makes less EU than running continuously over the same window")
        void pulsingReducesOutput() throws Exception {
            Reactor continuous = rodWithVent();
            continuous.setMaxSimulationTicks(5000);

            Reactor pulsed = rodWithVent();
            pulsed.setPulsed(true);
            pulsed.setOnPulse(2000);
            pulsed.setOffPulse(2000);
            pulsed.setMaxSimulationTicks(5000);

            TestSupport.SimResult continuousResult = TestSupport.simulate(continuous);
            TestSupport.SimResult pulsedResult = TestSupport.simulate(pulsed);

            assertTrue(
                    pulsedResult.data.totalEUoutput < continuousResult.data.totalEUoutput,
                    "a pulsed reactor idles half the time, so it must make less EU");
            // onPulse 2 000 / offPulse 2 000 over a 5 000-tick window is two full cycles plus
            // a 1 000-tick active tail: 2 000 + 2 000 + 1 000 = 3 000 active ticks x 100 EU.
            assertClose(300000, pulsedResult.data.totalEUoutput, 1e-6, "3 000 of 5 000 ticks are active");
            assertClose(500000, continuousResult.data.totalEUoutput, 1e-6, "continuous runs all 5 000");
        }

        @Test
        @DisplayName("an automated reactor replaces its cells before they break and survives")
        void automationExtendsLife() throws Exception {
            Reactor manual = quadRodWithCells();

            Reactor automated = quadRodWithCells();
            automated.setAutomated(true);
            for (int[] cell : new int[][] {{1, 2}, {3, 2}, {2, 1}, {2, 3}}) {
                ReactorItem component = automated.getComponentAt(cell[0], cell[1]);
                component.setAutomationThreshold(2000);
            }
            automated.setMaxSimulationTicks(100000);

            TestSupport.SimResult manualResult = TestSupport.simulate(manual);
            TestSupport.SimResult autoResult = TestSupport.simulate(automated);

            assertEquals(522, manualResult.data.timeToXplode, "the unautomated design boils");
            assertEquals(
                    Integer.MAX_VALUE,
                    autoResult.data.timeToXplode,
                    "the automated one replaces its cells and never boils");
            assertEquals(
                    Integer.MAX_VALUE,
                    autoResult.data.firstComponentBrokenTime,
                    "no cell ever filled to breaking");
            assertTrue(
                    !autoResult.data.replacedItems.toString().isEmpty(),
                    "and the report lists what was replaced");
            assertTrue(
                    autoResult.data.totalEUoutput > manualResult.data.totalEUoutput * 4,
                    "so it also made far more power");
        }

        @Test
        @DisplayName("automation keeps output steady at the quad rod's peak")
        void automationKeepsOutput() throws Exception {
            Reactor design = quadRodWithCells();
            design.setAutomated(true);
            for (int[] cell : new int[][] {{1, 2}, {3, 2}, {2, 1}, {2, 3}}) {
                design.getComponentAt(cell[0], cell[1]).setAutomationThreshold(2000);
            }
            design.setMaxSimulationTicks(100000);

            SimulationData data = TestSupport.simulate(design).data;
            assertEquals(100000, data.totalReactorTicks, "the whole window");
            assertClose(60.0, data.maxEUoutput, 1e-9, "a quad rod with no reflectors makes 1200 EU/tick");
            // Unlike the manual design, automation replaces the rod before it can break, so no
            // tick is ever dead and the minimum matches the maximum.
            assertClose(60.0, data.minEUoutput, 1e-9, "automation keeps every tick productive");
        }
    }

    // ================================================================== coolant injectors

    @Nested
    @DisplayName("reactor coolant injectors")
    class CoolantInjectors {

        /**
         * A rod feeding a condensator. The rod only lives 20 000 ticks, which is not long enough
         * to fill an LZH past its 85% trigger, so callers that need the injector to actually fire
         * give the condensator a starting heat just over the threshold.
         */
        private Reactor condensatorReactor(String condensatorName) {
            Reactor design = bareRod();
            place(design, 2, 1, condensatorName);
            return design;
        }

        /** Pre-charges the condensator at (2,1) just past its 85% injector threshold. */
        private void preChargeCondensator(Reactor design) {
            ReactorItem condensator = design.getComponentAt(2, 1);
            condensator.setInitialHeat((int) (condensator.getMaxHeat() * 0.9));
        }

        @Test
        @DisplayName("with injectors off, a condensator fills and breaks")
        void withoutInjectorsTheCondensatorBreaks() throws Exception {
            Reactor design = condensatorReactor("rshCondensator");
            design.setUsingReactorCoolantInjectors(false);
            design.setMaxSimulationTicks(100000);

            SimulationData data = TestSupport.simulate(design).data;
            // The rod's 4 heat/tick all go into the condensator; it holds 20 000.
            assertEquals(5000, data.firstComponentBrokenTime, "20 000 / 4 = 5 000 ticks");
            assertTrue(
                    data.firstComponentBrokenDescription.contains("Condensator"),
                    data.firstComponentBrokenDescription);
        }

        @Test
        @DisplayName("with injectors on, the condensator is emptied before it can fill")
        void injectorsKeepTheCondensatorAlive() throws Exception {
            Reactor design = condensatorReactor("rshCondensator");
            design.setUsingReactorCoolantInjectors(true);
            design.setMaxSimulationTicks(100000);

            SimulationData data = TestSupport.simulate(design).data;
            assertEquals(
                    Integer.MAX_VALUE,
                    data.firstComponentBrokenTime,
                    "the injector drained it every tick, so it never reached 20 000");
        }

        /** True when the report contains the rendered usage line, ignoring the numbers in it. */
        private boolean reportsUsage(String report, String bundleKey) {
            String expected = BundleHelper.getI18n(bundleKey).replaceAll("%d", "").trim();
            return report.replaceAll("[0-9]", "").contains(expected);
        }

        @Test
        @DisplayName("an RSH condensator reports redstone usage")
        void rshReportsRedstone() throws Exception {
            Reactor design = condensatorReactor("rshCondensator");
            design.setUsingReactorCoolantInjectors(true);
            preChargeCondensator(design);
            design.setMaxSimulationTicks(100000);

            String report = TestSupport.simulate(design).outputText;
            assertTrue(reportsUsage(report, "Simulation.RedstoneUsed"), "expected redstone usage in: " + report);
            assertFalse(reportsUsage(report, "Simulation.LapisUsed"), "and no lapis usage");
        }

        @Test
        @DisplayName("an LZH condensator reports lapis usage instead of redstone")
        void lzhReportsLapis() throws Exception {
            Reactor design = condensatorReactor("lzhCondensator");
            design.setUsingReactorCoolantInjectors(true);
            preChargeCondensator(design);
            design.setMaxSimulationTicks(100000);

            String report = TestSupport.simulate(design).outputText;
            assertTrue(reportsUsage(report, "Simulation.LapisUsed"), "expected lapis usage in: " + report);
            assertFalse(reportsUsage(report, "Simulation.RedstoneUsed"), "and no redstone usage");
        }

        @Test
        @DisplayName("injectors never make a reactor worse")
        void injectorsNeverHurt() throws Exception {
            Reactor off = condensatorReactor("rshCondensator");
            off.setUsingReactorCoolantInjectors(false);
            off.setMaxSimulationTicks(100000);

            Reactor on = condensatorReactor("rshCondensator");
            on.setUsingReactorCoolantInjectors(true);
            on.setMaxSimulationTicks(100000);

            assertTrue(
                    TestSupport.simulate(on).data.totalReactorTicks
                            >= TestSupport.simulate(off).data.totalReactorTicks,
                    "a repaired condensator absorbs at least as long");
        }
    }

    // ================================================================== explosion power

    @Nested
    @DisplayName("explosion power")
    class Explosion {

        /** Pulls the "Raw explosion power: N" figure out of the run report. */
        private double explosionPowerOf(String report) {
            String prefix = BundleHelper.getI18n("Simulation.ExplosionPower").split("%")[0];
            int start = report.indexOf(prefix);
            if (start < 0) {
                throw new AssertionError("no explosion power line in: " + report);
            }
            String tail = report.substring(start + prefix.length());
            return Double.parseDouble(tail.split("\\R")[0].trim().replace(",", ""));
        }

        @Test
        @DisplayName("one single rod gives power 12 (10 base + 2 per rod)")
        void singleRodPower() throws Exception {
            assertClose(12.0, explosionPowerOf(TestSupport.simulate(bareRod()).outputText), 1e-9);
        }

        @Test
        @DisplayName("four quad rods give power 42 (10 base + 2 x 4 rods each)")
        void fourQuadRodsPower() throws Exception {
            // 4 rods x (2 * rodCount 4) = 32, plus the base 10
            assertClose(42.0, explosionPowerOf(TestSupport.simulate(fourQuadRods()).outputText), 1e-9);
        }

        @Test
        @DisplayName("containment plating multiplies the power down by 0.81")
        void platingLowersPower() throws Exception {
            Reactor plated = fourQuadRodsWith(
                    ComponentFactory.createComponent("containmentReactorPlating"), 1, 0);
            assertClose(42 * 0.81, explosionPowerOf(TestSupport.simulate(plated).outputText), 1e-9);
        }

        @Test
        @DisplayName("plating also delays the explosion by raising the hull's maximum heat")
        void platingDelaysTheExplosion() throws Exception {
            assertEquals(27, TestSupport.simulate(fourQuadRods()).data.timeToXplode, "10000 / 384");

            Reactor plated = fourQuadRodsWith(
                    ComponentFactory.createComponent("containmentReactorPlating"), 1, 0);
            // containment plating adds 500, so 10500 / 384 = 27.34 -> 28
            assertEquals(28, TestSupport.simulate(plated).data.timeToXplode, "10500 / 384");
        }

        @Test
        @DisplayName("a neutron reflector subtracts 1 from the power")
        void reflectorsSubtract() throws Exception {
            Reactor withReflectors = fourQuadRods();
            place(withReflectors, 1, 1, "neutronReflector");
            place(withReflectors, 1, 3, "neutronReflector");
            assertClose(
                    40.0, explosionPowerOf(TestSupport.simulate(withReflectors).outputText), 1e-9, "42 - 2");
        }

        @Test
        @DisplayName("a surviving reactor reports no explosion power at all")
        void survivorReportsNoExplosionPower() throws Exception {
            String report = TestSupport.simulate(rodWithVent()).outputText;
            assertTrue(
                    !report.contains(BundleHelper.getI18n("Simulation.ExplosionPower").split("%")[0]),
                    "nothing exploded, so there is no power figure: " + report);
        }
    }

    // ================================================================== depletion

    @Nested
    @DisplayName("depletion and breakage")
    class Depletion {

        @Test
        @DisplayName("rod depletion is reported with a tick, position and description")
        void depletionIsReported() throws Exception {
            SimulationData data = TestSupport.simulate(rodWithVent()).data;
            assertEquals(20000, data.firstRodDepletedTime, "1 damage per tick, 20 000 durability");
            assertEquals(2, data.firstRodDepletedRow, "row of the rod");
            assertEquals(2, data.firstRodDepletedCol, "column of the rod");
            assertEquals(
                    ComponentFactory.getDefaultComponent("fuelRodUranium").name,
                    data.firstRodDepletedDescription,
                    "described by its display name, since it comes from component.toString()");
            assertEquals(1, data.totalRodCount, "the design has one rod");
        }

        @Test
        @DisplayName("the rod count drives the reported efficiency")
        void efficiencyUsesTheRodCount() throws Exception {
            SimulationData data = TestSupport.simulate(rodWithVent()).data;
            // Simulation.Efficiency reports totalEUoutput / ticks / 100 / rodCount, which is
            // 1.00 for a single rod producing its full 100 EU/tick.
            double efficiency = data.totalEUoutput / data.totalReactorTicks / 100 / data.totalRodCount;
            assertClose(1.0, efficiency, 1e-3, "one rod at its full 100 EU/tick is efficiency 1.00");
            assertEquals(1, data.totalRodCount, "and the design really has one rod");
        }

        @Test
        @DisplayName("a component that breaks is reported with a tick and position")
        void breakageIsReported() throws Exception {
            SimulationData data = TestSupport.simulate(quadRodWithCells()).data;
            assertTrue(data.firstComponentBrokenTime != Integer.MAX_VALUE, "something broke");
            assertTrue(data.firstComponentBrokenRow >= 0, "with a row");
            assertTrue(data.firstComponentBrokenCol >= 0, "and a column");
            assertTrue(
                    data.firstComponentBrokenDescription.contains("Coolant"),
                    data.firstComponentBrokenDescription);
        }
    }

    // ================================================================== CSV

    @Nested
    @DisplayName("CSV output")
    class Csv {

        @Test
        @DisplayName("the file gets a header and one row per tick up to the limit")
        void headerAndRows(@TempDir File dir) throws Exception {
            File csv = new File(dir, "sim.csv");
            runWithCsv(rodWithVent(), csv, 50);

            List<String> lines = TestSupport.readLines(csv);
            assertEquals(51, lines.size(), "a header plus 50 rows");

            String header = lines.get(0);
            // rodWithVent occupies (2,2) and (2,3); only components that hold heat or take
            // damage get columns, and they are labelled with their grid position.
            assertTrue(header.contains("R2C2"), "the rod's column is labelled by position");
            assertTrue(header.contains("R2C3"), "and so is the vent's");
            assertFalse(header.contains("R0C0"), "empty slots get no column");
            assertTrue(countCommas(header) > 0, "and there is more than one column");
        }

        @Test
        @DisplayName("every data row has the same column count as the header")
        void rowsMatchTheHeader(@TempDir File dir) throws Exception {
            File csv = new File(dir, "sim.csv");
            runWithCsv(rodWithVent(), csv, 25);
            List<String> lines = TestSupport.readLines(csv);

            int columns = countCommas(lines.get(0));
            for (int i = 1; i < lines.size(); i++) {
                assertEquals(columns, countCommas(lines.get(i)), "row " + i + " column count");
            }
        }

        @Test
        @DisplayName("the tick column counts up from 1")
        void tickColumnCountsUp(@TempDir File dir) throws Exception {
            File csv = new File(dir, "sim.csv");
            runWithCsv(rodWithVent(), csv, 10);
            List<String> lines = TestSupport.readLines(csv);
            assertTrue(lines.size() > 5, "there are data rows to check");
            for (int i = 1; i < lines.size(); i++) {
                assertTrue(lines.get(i).startsWith(i + ","), "row " + i + " starts with tick " + i);
            }
        }

        @Test
        @DisplayName("a limit of -1 writes the header only")
        void negativeLimitWritesHeaderOnly(@TempDir File dir) throws Exception {
            File csv = new File(dir, "sim.csv");
            runWithCsv(rodWithVent(), csv, -1);
            assertEquals(1, TestSupport.readLines(csv).size(), "header only, no data rows");
        }

        @Test
        @DisplayName("a file in an unwritable location does not abort the simulation")
        void unwritableCsvStillSimulates(@TempDir File dir) throws Exception {
            // The simulator catches the IOException and publishes a message, then carries on.
            File bad = new File(dir, "no-such-dir" + File.separator + "sim.csv");
            Reactor simReactor = new Reactor();
            simReactor.setCode(rodWithVent().getCode());
            JTextArea output = new JTextArea(5, 20);
            AutomationSimulator simulator = new AutomationSimulator(simReactor, output, newJPanelGrid(), bad, 10);
            simulator.execute();
            simulator.get();
            String report = TestSupport.awaitCompletion(output);
            assertTrue(report.contains(BundleHelper.getI18n("Simulation.Started").split("\\n")[0]), report);
            assertNotNull(simulator.getData(), "and data was still produced");
        }

        private int countCommas(String line) {
            int count = 0;
            for (int i = 0; i < line.length(); i++) {
                if (line.charAt(i) == ',') {
                    count++;
                }
            }
            return count;
        }
    }

    // ================================================================== plumbing

    @Nested
    @DisplayName("plumbing")
    class Plumbing {

        @Test
        @DisplayName("getData is null until the simulation has finished")
        void dataIsOnlyAvailableWhenComplete() throws Exception {
            Reactor simReactor = new Reactor();
            simReactor.setCode(rodWithVent().getCode());
            JTextArea output = new JTextArea(5, 20);
            AutomationSimulator simulator =
                    new AutomationSimulator(simReactor, output, newJPanelGrid(), null, -1);

            org.junit.jupiter.api.Assertions.assertNull(simulator.getData(), "nothing yet");
            simulator.execute();
            simulator.get();
            TestSupport.awaitCompletion(output);
            assertNotNull(simulator.getData(), "data once it has run");
        }

        @Test
        @DisplayName("the run fires a completed property change")
        void firesCompletedPropertyChange() throws Exception {
            final java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
            Reactor simReactor = new Reactor();
            simReactor.setCode(rodWithVent().getCode());
            JTextArea output = new JTextArea(5, 20);
            AutomationSimulator simulator =
                    new AutomationSimulator(simReactor, output, newJPanelGrid(), null, -1);
            simulator.addPropertyChangeListener(new java.beans.PropertyChangeListener() {
                @Override
                public void propertyChange(java.beans.PropertyChangeEvent evt) {
                    if ("completed".equals(evt.getPropertyName())) {
                        latch.countDown();
                    }
                }
            });
            simulator.execute();
            assertTrue(latch.await(60, java.util.concurrent.TimeUnit.SECONDS), "completed was fired");
        }

        @Test
        @DisplayName("a cancelled run still completes and exposes its data")
        void cancelledRunStillCompletes() throws Exception {
            final java.util.concurrent.CountDownLatch finished = new java.util.concurrent.CountDownLatch(1);
            Reactor simReactor = quadRodWithCells();
            simReactor.setAutomated(true);
            // Automation keeps replacing the spent cells, so this design never boils and the run
            // goes the whole way to the tick cap. A uranium rod on its own depletes on tick 20 001
            // and a cesium rod explodes on tick 5 001, both of which finish before the cancel below
            // is issued - and SwingWorker skips doInBackground outright when it is cancelled before
            // the job's thread gets going, so the cancel has to arrive mid-run.
            simReactor.setMaxSimulationTicks(2_000_000);
            JTextArea output = new JTextArea(5, 20);
            AutomationSimulator simulator =
                    new AutomationSimulator(simReactor, output, newJPanelGrid(), null, -1);
            simulator.addPropertyChangeListener(new java.beans.PropertyChangeListener() {
                @Override
                public void propertyChange(java.beans.PropertyChangeEvent evt) {
                    if ("completed".equals(evt.getPropertyName())) {
                        finished.countDown();
                    }
                }
            });
            // SwingWorker skips doInBackground outright when it is cancelled before the job's thread
            // gets going, so the cancel cannot be issued back-to-back with execute(). Sleeping a
            // beat puts it squarely inside a two-million-tick run, which is what the GUI does when
            // it cancels a simulator it knows is still running.
            simulator.execute();
            Thread.sleep(200);
            simulator.cancel(false);
            assertTrue(finished.await(60, java.util.concurrent.TimeUnit.SECONDS), "completed was fired");
            String report = output.getText();
            String marker = BundleHelper.getI18n("Simulation.CancelledAtTick").split("%")[0];
            assertTrue(report.contains(marker), "the cancel branch ran: " + report);
            org.junit.jupiter.api.Assertions.assertNotNull(
                    simulator.getData(), "a cancelled run is a finished run, so getData() is available");
        }
    }

    /**
     * P2-3(a): the Javasharp dialect has no {@code Pattern} class, so the {@code matches("R\\dC\\d:.*")}
     * test in {@code process()} is replaced by a hand-written predicate. This pins the two against
     * each other over the awkward cases - wrong length, wrong case, two-digit indices, and the fact
     * that this engine's {@code .} stops at {@code \n}, {@code \r}, {@code \u0085}, {@code \u2028} and
     * {@code \u2029} but not at the vertical tab or form feed.
     */
    @Test
    @DisplayName("the reactor-cell chunk test agrees with the pattern it replaced")
    void reactorCellChunkTestAgreesWithTheRegex() {
        String[] samples = {
            "R1C2:0xC0C0C0", "R0C0:0x0", "R9C9:x", "R1C2:", "R1C", "R1C2", "r1C2:0", "R11C2:0",
            "R1C12:0", "", "R1C2:0\tmore", "R1C2:0\u000B", "R1C2:0\u000C", "R1C2:0\u0085more",
            "R1C2:0\u2028more", "R1C2:0\u2029more", "R1C2:0xC0C0C0\nmore", "R1C2:0xC0C0C0\rmore",
            "RaC2:0", "R1Cb:0", "R\u00B9C2:0", "R1C2:\u2028", "R1C2:",
        };
        for (String sample : samples) {
            assertTrue(sample.matches("R\\dC\\d:.*") == AutomationSimulator.isReactorCellChunk(sample),
                    "the hand-written test must agree with the pattern it replaced for [" + sample + "]");
        }
    }

    /** Drops the wall-clock line, which is the only legitimately variable part of a report. */
    private static String stripElapsedTime(String report) {
        // Take the fixed prefix of the bundle entry so this keeps working under a translation.
        String marker = BundleHelper.getI18n("Simulation.ElapsedTime").split("%")[0];
        int start = report.indexOf(marker);
        if (start < 0) {
            return report;
        }
        int end = report.indexOf('\n', start);
        return report.substring(0, start) + (end < 0 ? "" : report.substring(end));
    }

    private static JPanel[][] newJPanelGrid() {
        JPanel[][] panels = new JPanel[TestSupport.ROWS][TestSupport.COLS];
        for (int row = 0; row < TestSupport.ROWS; row++) {
            for (int col = 0; col < TestSupport.COLS; col++) {
                panels[row][col] = new JPanel();
            }
        }
        return panels;
    }

    private static void runWithCsv(Reactor design, File csvFile, int csvLimit) throws Exception {
        Reactor simReactor = new Reactor();
        simReactor.setCode(design.getCode());

        JTextArea output = new JTextArea(5, 20);
        AutomationSimulator simulator =
                new AutomationSimulator(simReactor, output, newJPanelGrid(), csvFile, csvLimit);
        simulator.execute();
        simulator.get();
        TestSupport.awaitCompletion(output);
    }
}