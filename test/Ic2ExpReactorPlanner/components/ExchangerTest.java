package Ic2ExpReactorPlanner.components;

import static Ic2ExpReactorPlanner.TestSupport.assertClose;
import static Ic2ExpReactorPlanner.TestSupport.place;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import Ic2ExpReactorPlanner.ComponentFactory;
import Ic2ExpReactorPlanner.Reactor;

import Ic2ExpReactorPlanner.TestSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * {@link Exchanger} heat transfer — the reactor-side and component-side cascades.
 *
 * <p>The transfer is adapted from decompiled IC2 {@code ItemReactorHeatSwitch}:
 *
 * <pre>
 *   sum  = neighbourMed + myMed / 2        // both are percent-of-maxHeat
 *   add  = round(targetMaxHeat / 100 * sum), clamped to the switch capacity
 *   if (sum &lt; 1.00) add = cap / 2
 *   if (sum &lt; 0.75) add = cap / 4        // the ifs cascade: the last match wins
 *   if (sum &lt; 0.50) add = cap / 8
 *   if (sum &lt; 0.25) add = 1
 *   then the sign is decided by which side is hotter
 * </pre>
 *
 * <p>The reactor-side cascade used to scale by {@code switchSide} instead of
 * {@code switchReactor}, which is a different constant for three of the four exchangers, so the
 * table was wrong for {@code 0.25 <= sum < 1.0} (CODE_REVIEW.md P0-1, fixed). The table below
 * is the regression guard for that fix, together with the invariant the fix restores: no
 * reactor-side transfer may exceed {@code switchReactor}.
 */
class ExchangerTest {

    @BeforeEach
    @AfterEach
    void resetGlobals() {
        TestSupport.resetGlobalConfig();
    }

    // (baseName, switchSide, switchReactor, maxHeat)
    //   heatExchanger            12 /  4  / 2500
    //   advancedHeatExchanger    24 /  8  / 10000
    //   coreHeatExchanger         0 / 72  / 5000
    //   componentHeatExchanger   36 /  0  / 5000
    private static final String[] ALL = {
        "heatExchanger", "advancedHeatExchanger", "coreHeatExchanger", "componentHeatExchanger"
    };

    /**
     * Drives one reactor-side transfer with the reactor cold and the exchanger at
     * {@code exchangerHeat}, then returns how much heat actually moved into the reactor.
     */
    private static double reactorTransfer(String baseName, double exchangerHeat) {
        Reactor reactor = new Reactor();
        Exchanger exchanger = (Exchanger) place(reactor, 2, 2, baseName);
        exchanger.adjustCurrentHeat(exchangerHeat);
        reactor.setCurrentHeat(0);
        double before = reactor.getCurrentHeat();
        exchanger.transfer();
        return reactor.getCurrentHeat() - before;
    }

    /**
     * Runs a reactor-side transfer positioned at a specific {@code sum} band rather than at a
     * raw exchanger heat. With a cold reactor, {@code sum = exchangerHeat * 50 / maxHeat}, and the
     * four exchangers have different capacities (2500 / 10000 / 5000 / 5000), so driving the
     * tests by {@code sum} is what actually selects a cascade tier.
     */
    private static double transferAtSum(String baseName, double targetSum) {
        Exchanger probe = exchangerNamed(baseName);
        return reactorTransfer(baseName, targetSum * probe.getMaxHeat() / 50.0);
    }

    /**
     * The value {@code sum = Reactormed + mymed/2} takes for a given exchanger heat with a cold
     * reactor: {@code mymed = exchangerHeat * 100 / exchangerMaxHeat}, so
     * {@code sum = exchangerHeat * 50 / exchangerMaxHeat}.
     */
    private static double sumFor(ReactorItem exchanger, double exchangerHeat) {
        return exchanger.getCurrentHeat() * 50.0 / exchanger.getMaxHeat();
    }

    // ------------------------------------------------------------------ reactor side

    @Nested
    @DisplayName("reactor-side cascade")
    class ReactorSideCascade {

        /**
         * The tier table. The {@code if}s cascade, so the <em>last</em> matching tier wins:
         *
         * <pre>
         *   0.75 &lt;= sum &lt; 1.0  ->  switchReactor / 2
         *   0.50 &lt;= sum &lt; 0.75 ->  switchReactor / 4
         *   0.25 &lt;= sum &lt; 0.50 ->  switchReactor / 8
         *   sum &lt; 0.25           ->  1
         *   sum &gt;= 1.0           ->  no tier fires; the round-and-clamp value stands
         * </pre>
         *
         * The cap is {@code switchReactor} because that is the capacity of the transfer this
         * block performs. It used to read {@code switchSide}, which is a different constant for
         * three of the four exchangers, so the whole table below was wrong for the
         * {@code 0.25 <= sum < 1.0} range -- see CODE_REVIEW.md P0-1. Note the integer
         * division: {@code heatExchanger}'s cap of 4 gives 0 in the {@code /8} band.
         */
        @ParameterizedTest(name = "{0} at sum ~{1} moves {2}")
        @CsvSource({
            // baseName,                targetSum, expected move
            "coreHeatExchanger,          0.37,      9",  // 72 / 8
            "coreHeatExchanger,          0.62,      18", // 72 / 4
            "coreHeatExchanger,          0.87,      36", // 72 / 2
            "heatExchanger,              0.37,      0",  // 4 / 8, integer division
            "heatExchanger,              0.62,      1",  // 4 / 4
            "heatExchanger,              0.87,      2",  // 4 / 2
            "advancedHeatExchanger,      0.37,      1",  // 8 / 8
            "advancedHeatExchanger,      0.62,      2",  // 8 / 4
            "advancedHeatExchanger,      0.87,      4",  // 8 / 2
        })
        @DisplayName("each band scales by switchReactor")
        void cascadeScalesBySwitchReactor(String baseName, double targetSum, int expected) {
            assertClose(expected, transferAtSum(baseName, targetSum), 1e-9, baseName + " at sum ~" + targetSum);
        }

        @Test
        @DisplayName("sum < 0.25 is the field-independent literal 1 for every exchanger")
        void lowestTierIsOne() {
            for (String baseName : ALL) {
                if (exchangerNamed(baseName).getHullCoolingCapacity() == 0) {
                    continue; // componentHeatExchanger has no reactor side; see below
                }
                assertClose(1, transferAtSum(baseName, 0.10), 1e-9, baseName + " at sum ~0.10");
            }
        }

        /**
         * The invariant the fix restores. A reactor-side transfer must never move more than the
         * exchanger's own reactor capacity, in either direction; the cascade's whole job is to
         * taper that capacity as the two sides get colder.
         */
        @Test
        @DisplayName("no transfer ever exceeds switchReactor")
        void neverExceedsTheCapacity() {
            for (String baseName : ALL) {
                int capacity = (int) exchangerNamed(baseName).getHullCoolingCapacity();
                if (capacity == 0) {
                    continue; // componentHeatExchanger has no reactor side
                }
                for (double targetSum = 0.05; targetSum < 1.05; targetSum += 0.05) {
                    double moved = Math.abs(transferAtSum(baseName, targetSum));
                    assertTrue(
                            moved <= capacity + 1e-9,
                            baseName + " moved " + moved + " at sum ~" + targetSum + ", above its capacity of " + capacity);
                }
            }
        }

        /**
         * The part of P0-1 that provably must <em>not</em> have moved: for {@code sum >= 1.0} no
         * cascade tier fires, so neither {@code switchSide} nor {@code switchReactor} is read and
         * the transfer is just the round-and-clamp value. That is why the fix's blast radius is
         * confined to cold exchangers -- hot ones were already correct.
         */
        @Test
        @DisplayName("at sum >= 1.0 the transfer is the clamped value with no cascade")
        void hotPathIsUnchangedByTheFix() {
            for (String baseName : ALL) {
                int capacity = (int) exchangerNamed(baseName).getHullCoolingCapacity();
                if (capacity == 0) {
                    continue;
                }
                double targetSum = 2.0;
                double expected = Math.min(
                        Math.round(10000.0 / 100.0 * targetSum), // a bare reactor is 10 000
                        capacity);
                assertClose(
                        expected,
                        transferAtSum(baseName, targetSum),
                        1e-9,
                        baseName + " at sum ~2.0 should be the clamp, not a cascade tier");
            }
        }

        @Test
        @DisplayName("componentHeatExchanger has switchReactor 0, so it never touches the reactor")
        void componentExchangerNeverTouchesReactor() {
            assertClose(0, reactorTransfer("componentHeatExchanger", 10), 1e-9, "sum ~ 0.10");
            assertClose(0, reactorTransfer("componentHeatExchanger", 87), 1e-9, "sum ~ 0.87");
            assertClose(0, reactorTransfer("componentHeatExchanger", 4000), 1e-9, "hot");
        }

        @Test
        @DisplayName("the exchanger pays for every heat unit it gives away")
        void exchangerLosesWhatTheReactorGains() {
            Reactor reactor = new Reactor();
            Exchanger exchanger = (Exchanger) place(reactor, 2, 2, "heatExchanger");
            exchanger.adjustCurrentHeat(87);
            reactor.setCurrentHeat(0);
            exchanger.transfer();
            assertClose(
                    87 - reactor.getCurrentHeat(),
                    exchanger.getCurrentHeat(),
                    1e-9,
                    "heat is conserved between exchanger and reactor");
        }

        @Test
        @DisplayName("when the reactor is hotter than the exchanger the sign flips")
        void signFlipsWhenReactorIsHotter() {
            Reactor reactor = new Reactor();
            Exchanger exchanger = (Exchanger) place(reactor, 2, 2, "heatExchanger");
            exchanger.adjustCurrentHeat(100);
            reactor.setCurrentHeat(reactor.getMaxHeat() * 0.9);
            double before = reactor.getCurrentHeat();
            exchanger.transfer();
            assertTrue(
                    reactor.getCurrentHeat() < before,
                    "a hot reactor must pull heat out of a cooler exchanger");
        }

        @Test
        @DisplayName("equal percent heat on both sides transfers nothing")
        void equalHeatTransfersNothing() {
            Reactor reactor = new Reactor();
            Exchanger exchanger = (Exchanger) place(reactor, 2, 2, "heatExchanger");
            exchanger.adjustCurrentHeat(exchanger.getMaxHeat() * 0.5);
            reactor.setCurrentHeat(reactor.getMaxHeat() * 0.5);
            double before = reactor.getCurrentHeat();
            exchanger.transfer();
            assertClose(0, reactor.getCurrentHeat() - before, 1e-9, "no transfer at equal percent heat");
        }
    }
    // ------------------------------------------------------------------ component side

    @Nested
    @DisplayName("component-side transfer")
    class ComponentSide {

        /**
         * The side cascade, which scales by {@code switchSide} and was <em>always</em> correct.
         *
         * <p>This exists to guard against the over-correction of P0-1: someone "fixing" the
         * wrong block by switching the side cascade to {@code switchReactor} would break every
         * side-transfer value, and the behaviour tests in this class only assert
         * {@code > 0}, so they would not notice.
         *
         * <p>With the exchanger at 0 heat, {@code sum} is just the neighbour's percent-of-maxHeat.
         * Note that {@code heatablemed} is a <i>percentage</i> (0-100), so a neighbour "at 0.9%"
         * is charged to {@code maxHeat * 0.9 / 100}.
         */
        @ParameterizedTest(name = "{0} at neighbour {1}% of capacity moves {2}")
        @CsvSource({
            // baseName,                 neighbourPercent, expected move
            "heatExchanger,              0.90,             6",  // 12 / 2
            "heatExchanger,              0.60,             3",  // 12 / 4
            "heatExchanger,              0.37,             1",  // 12 / 8
            "heatExchanger,              0.10,             1",  // field-independent literal
            "componentHeatExchanger,     0.90,             18", // 36 / 2
            "componentHeatExchanger,     0.60,             9",  // 36 / 4
            "componentHeatExchanger,     0.37,             4",  // 36 / 8
            "componentHeatExchanger,     0.10,             1",  // field-independent literal
        })
        @DisplayName("each band scales by switchSide, not switchReactor")
        void sideCascadeScalesBySwitchSide(String baseName, double neighbourPercent, int expected) {
            Reactor reactor = new Reactor();
            Exchanger exchanger = (Exchanger) place(reactor, 2, 2, baseName);
            CoolantCell cell = (CoolantCell) place(reactor, 2, 1, "coolantCell60k");
            reactor.setCurrentHeat(0);
            cell.adjustCurrentHeat(cell.getMaxHeat() * neighbourPercent / 100.0);

            exchanger.transfer();
            assertClose(
                    expected,
                    cell.getMaxHeat() * neighbourPercent / 100.0 - cell.getCurrentHeat(),
                    1e-9,
                    baseName + " at neighbour " + neighbourPercent + "% of capacity");
        }

        @Test
        @DisplayName("moves heat into an adjacent coolant cell and takes it from the reactor hull")
        void movesHeatIntoNeighbour() {
            Reactor reactor = new Reactor();
            Exchanger exchanger = (Exchanger) place(reactor, 2, 2, "heatExchanger");
            place(reactor, 2, 1, "coolantCell60k");
            reactor.setCurrentHeat(0);
            exchanger.adjustCurrentHeat(exchanger.getMaxHeat() * 0.5); // mymed 50

            exchanger.transfer();
            assertTrue(
                    reactor.getComponentAt(2, 1).getCurrentHeat() > 0,
                    "the coolant cell should have absorbed heat");
            assertTrue(reactor.getCurrentHeat() > 0, "the remainder should have gone to the hull");
        }

        @Test
        @DisplayName("componentHeatExchanger spreads to all four neighbours")
        void spreadsToAllNeighbours() {
            Reactor reactor = new Reactor();
            Exchanger exchanger = (Exchanger) place(reactor, 2, 2, "componentHeatExchanger");
            place(reactor, 2, 1, "coolantCell60k");
            place(reactor, 2, 3, "coolantCell60k");
            place(reactor, 1, 2, "coolantCell60k");
            place(reactor, 3, 2, "coolantCell60k");
            reactor.setCurrentHeat(0);
            exchanger.adjustCurrentHeat(exchanger.getMaxHeat() * 0.9);

            exchanger.transfer();
            for (int[] cell : new int[][] {{2, 1}, {2, 3}, {1, 2}, {3, 2}}) {
                assertTrue(
                        reactor.getComponentAt(cell[0], cell[1]).getCurrentHeat() > 0,
                        "neighbour at " + cell[0] + "," + cell[1] + " should have received heat");
            }
        }

        @Test
        @DisplayName("with no heatable neighbours all component-side heat falls back to the hull")
        void fallsBackToHull() {
            Reactor reactor = new Reactor();
            Exchanger exchanger = (Exchanger) place(reactor, 2, 2, "heatExchanger");
            place(reactor, 2, 1, "neutronReflector"); // maxHeat 1, not an acceptor
            reactor.setCurrentHeat(0);
            exchanger.adjustCurrentHeat(500);
            exchanger.transfer();
            assertTrue(reactor.getCurrentHeat() > 0, "heat should have reached the hull");
        }
    }

    // ------------------------------------------------------------------ reported capacities

    @Test
    @DisplayName("getHullCoolingCapacity reports switchReactor")
    void hullCoolingCapacity() {
        assertEquals(4, exchangerNamed("heatExchanger").getHullCoolingCapacity(), 1e-9);
        assertEquals(8, exchangerNamed("advancedHeatExchanger").getHullCoolingCapacity(), 1e-9);
        assertEquals(72, exchangerNamed("coreHeatExchanger").getHullCoolingCapacity(), 1e-9);
        assertEquals(0, exchangerNamed("componentHeatExchanger").getHullCoolingCapacity(), 1e-9);
    }

    @Test
    @DisplayName("the tooltip lists maxHeat plus whichever capacities are non-zero")
    void tooltipContents() {
        assertEquals(2, exchangerNamed("coreHeatExchanger").formatTooltip().length, "maxHeat + switchReactor");
        assertEquals(3, exchangerNamed("heatExchanger").formatTooltip().length, "maxHeat + both");
        assertEquals(2, exchangerNamed("componentHeatExchanger").formatTooltip().length, "maxHeat + switchSide");
    }

    private static Exchanger exchangerNamed(String name) {
        return (Exchanger) ComponentFactory.createComponent(name);
    }

    @Test
    @DisplayName("the sum helper agrees with the implementation's own arithmetic")
    void sumHelperMatches() {
        Reactor reactor = new Reactor();
        Exchanger exchanger = (Exchanger) place(reactor, 2, 2, "coreHeatExchanger"); // maxHeat 5000
        exchanger.adjustCurrentHeat(50);
        reactor.setCurrentHeat(0);
        double mymed = exchanger.getCurrentHeat() * 100.0 / exchanger.getMaxHeat();
        assertClose(1.0, mymed, 1e-9, "50/5000 is 1% of maxHeat");
        assertClose(mymed / 2.0, sumFor(exchanger, 50), 1e-9, "sum with a cold reactor");
        // and that lands in the <0.5 band, which the current code maps to add = 0
        assertClose(0, reactor.getCurrentHeat(), 1e-9, "no heat moved yet");
    }
}