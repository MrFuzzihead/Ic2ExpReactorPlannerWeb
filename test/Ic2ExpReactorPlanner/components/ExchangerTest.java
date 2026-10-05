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
import org.junit.jupiter.api.Disabled;
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
 * <p><b>Known bug (CODE_REVIEW.md P0-1).</b> The four cap lines in the reactor block read
 * {@code switchSide} instead of {@code switchReactor}. Because the two differ for three of the
 * four exchangers the cascade is wrong whenever {@code 0.25 <= sum < 1.0}. This class pins the
 * behaviour as it is today (so a refactor cannot silently move it) and carries a disabled
 * contract test describing the behaviour the code is supposed to have. Delete the
 * {@code @Disabled} annotations when the bug is fixed.
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

    // ------------------------------------------------------------------ characterisation

    @Nested
    @DisplayName("current behaviour: reactor-side cascade")
    class CurrentReactorCascade {

        @Test
        @DisplayName("coreHeatExchanger moves no heat at all for 0.25 <= sum < 1.0")
        void coreExchangerMovesNothing() {
            // switchSide is 0, so all four cap tiers evaluate to 0.
            assertClose(0, transferAtSum("coreHeatExchanger", 0.37), 1e-9, "sum ~ 0.37 -> tier <0.5");
            assertClose(0, transferAtSum("coreHeatExchanger", 0.62), 1e-9, "sum ~ 0.62 -> tier <0.75");
            assertClose(0, transferAtSum("coreHeatExchanger", 0.87), 1e-9, "sum ~ 0.87 -> tier <1.0");
        }

        @Test
        @DisplayName("coreHeatExchanger still uses the field-independent 1 for sum < 0.25")
        void coreExchangerVeryLowStillMovesOne() {
            // The last tier is a literal 1, so it is unaffected by the field mix-up.
            assertClose(1, transferAtSum("coreHeatExchanger", 0.10), 1e-9, "sum ~ 0.10");
        }

        @Test
        @DisplayName("heatExchanger over-transfers: uses switchSide where switchReactor was meant")
        void heatExchangerOverTransfers() {
            // switchSide 12, switchReactor 4. The ifs cascade, so the last matching tier wins:
            //   0.75 <= sum < 1.0 -> cap / 2
            //   0.50 <= sum < 0.75 -> cap / 4
            //   0.25 <= sum < 0.50 -> cap / 8
            assertClose(6, transferAtSum("heatExchanger", 0.87), 1e-9, "sum ~ 0.87 -> 12/2 = 6, should be 4/2 = 2");
            assertClose(3, transferAtSum("heatExchanger", 0.62), 1e-9, "sum ~ 0.62 -> 12/4 = 3, should be 4/4 = 1");
            assertClose(1, transferAtSum("heatExchanger", 0.37), 1e-9, "sum ~ 0.37 -> 12/8 = 1, should be 4/8 = 0");
        }

        @Test
        @DisplayName("advancedHeatExchanger over-transfers across the whole cascade")
        void advancedExchangerOverTransfers() {
            // switchSide 24, switchReactor 8: the code uses 24 where it should use 8.
            assertClose(12, transferAtSum("advancedHeatExchanger", 0.87), 1e-9, "sum ~ 0.87 -> 24/2 = 12");
            assertClose(6, transferAtSum("advancedHeatExchanger", 0.62), 1e-9, "sum ~ 0.62 -> 24/4 = 6");
            assertClose(3, transferAtSum("advancedHeatExchanger", 0.37), 1e-9, "sum ~ 0.37 -> 24/8 = 3");
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

    // ------------------------------------------------------------------ contract (P0-1)

    @Nested
    @Disabled("CODE_REVIEW.md P0-1: the reactor-side cascade must use switchReactor, not switchSide")
    @DisplayName("intended behaviour: reactor-side cascade uses switchReactor")
    class IntendedReactorCascade {

        @ParameterizedTest(name = "{0} sum ~{2} should move {3}")
        @CsvSource({
            // baseName,                 targetSum, expected move  (switchReactor-based cap tiers)
            "coreHeatExchanger,          0.37,     9",  // 72 / 8
            "coreHeatExchanger,          0.62,     18", // 72 / 4
            "coreHeatExchanger,          0.87,     36", // 72 / 2
            "heatExchanger,              0.37,     1",  // 4 / 4
            "heatExchanger,              0.62,     0",  // 4 / 8, integer division
            "heatExchanger,              0.87,     2",  // 4 / 2
            "advancedHeatExchanger,      0.37,     2",  // 8 / 4
            "advancedHeatExchanger,      0.62,     1",  // 8 / 8
            "advancedHeatExchanger,      0.87,     4",  // 8 / 2
        })
        void cascadeUsesSwitchReactor(String baseName, double targetSum, int expected) {
            assertClose(expected, transferAtSum(baseName, targetSum), 1e-9, baseName + " at sum ~" + targetSum);
        }

        @Test
        @DisplayName("sum < 0.25 stays 1 for every exchanger (field-independent literal)")
        void lowestTierIsOne() {
            for (String baseName : ALL) {
                assertClose(1, transferAtSum(baseName, 0.10), 1e-9, baseName + " sum ~0.10");
            }
        }
    }

    // ------------------------------------------------------------------ component side

    @Nested
    @DisplayName("component-side transfer")
    class ComponentSide {

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