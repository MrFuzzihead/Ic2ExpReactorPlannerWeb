package Ic2ExpReactorPlanner.components;

import static Ic2ExpReactorPlanner.TestSupport.assertClose;
import static Ic2ExpReactorPlanner.TestSupport.place;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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
import org.junit.jupiter.params.provider.ValueSource;

/**
 * {@link Condensator} (RSH / LZH) absorption and Reactor Coolant Injector interaction.
 *
 * <p><b>Fixed (CODE_REVIEW.md P0-2, P3-18).</b> The absorption bound used to be
 * {@code min(heat, maxHeat - heat)}, which ignored {@code currentHeat}. The consequences were
 * that a partly-full condensator under-accepted, a packet larger than the capacity drove
 * {@code currentHeat} negative, and -- because {@code FuelRod.handleHeat} discards the return
 * value -- the rod's entire heat output was silently deleted from the reactor. The bound is now
 * {@code min(heat, maxHeat - currentHeat)}, and the reported cooling counts what was absorbed
 * rather than what was offered.
 *
 * <p>The table below is the spec. {@code refused} is the method's return value, which is
 * <i>positive</i> here, the opposite sign to the base class's convention; that asymmetry is
 * preserved deliberately and is noted in the implementation.
 */
class CondensatorTest {

    @BeforeEach
    @AfterEach
    void resetGlobals() {
        TestSupport.resetGlobalConfig();
    }

    private static Condensator condensator(String name) {
        return (Condensator) ComponentFactory.createComponent(name);
    }

    // ------------------------------------------------------------------ capacities

    @Test
    @DisplayName("RSH holds 20 000 and LZH holds 100 000")
    void capacities() {
        assertClose(20000, condensator("rshCondensator").getMaxHeat(), 1e-9, "rsh");
        assertClose(100000, condensator("lzhCondensator").getMaxHeat(), 1e-9, "lzh");
    }

    @Test
    @DisplayName("condensators are heat acceptors but never coolable")
    void acceptorButNotCoolable() {
        Condensator rsh = condensator("rshCondensator");
        assertTrue(rsh.isHeatAcceptor(), "accepts heat");
        assertFalse(rsh.isCoolable(), "must not be coolable, unlike a coolant cell");
    }

    // ------------------------------------------------------------------ the absorption table

    @Nested
    @DisplayName("absorption bound")
    class AbsorptionBound {

        /**
         * A fresh RSH (capacity 20 000) absorbing a single packet. The third and fourth rows are
         * the ones the old bound got wrong: it refused everything above half the capacity, and
         * returned a <i>negative</i> "accepted" amount for a packet over the capacity.
         */
        @ParameterizedTest(name = "packet {0}: accepts {1}, refuses {2}, stores {3}")
        @CsvSource({
            // packet, accepted, refused, currentHeat
            "4000,     4000,     0,      4000",
            "10000,    10000,    0,      10000",
            "20000,    20000,    0,      20000",  // exactly full
            "29568,    20000,    9568,   20000",  // over capacity: fills, refuses the excess
            "40000,    20000,    20000,  20000",
        })
        @DisplayName("a fresh RSH absorbs up to its remaining room")
        void freshRsh(double packet, double accepted, double refused, double expectedHeat) {
            Condensator c = condensator("rshCondensator");
            assertClose(refused, c.adjustCurrentHeat(packet), 1e-9, "refused for a packet of " + packet);
            assertClose(expectedHeat, c.getCurrentHeat(), 1e-9, "stored for a packet of " + packet);
        }

        @Test
        @DisplayName("a warm condensator absorbs exactly its remaining room")
        void warmAbsorbsRemainingRoom() {
            Condensator c = condensator("rshCondensator");
            assertClose(0, c.adjustCurrentHeat(15000), 1e-9, "precondition: nothing refused");
            assertClose(15000, c.getCurrentHeat(), 1e-9, "precondition: stored");

            assertClose(10000, c.adjustCurrentHeat(15000), 1e-9, "only 5 000 of room was left");
            assertClose(20000, c.getCurrentHeat(), 1e-9, "filled to capacity, never above");
        }

        @Test
        @DisplayName("a full condensator refuses everything further and stores nothing")
        void fullCondensatorRefusesEverything() {
            Condensator c = condensator("rshCondensator");
            c.adjustCurrentHeat(20000);
            assertClose(20000, c.getCurrentHeat(), 1e-9, "precondition: full");

            for (double packet : new double[] {100, 4000, 29568}) {
                assertClose(packet, c.adjustCurrentHeat(packet), 1e-9, "all of " + packet + " refused");
                assertClose(20000, c.getCurrentHeat(), 1e-9, "still exactly at capacity");
            }
        }

        @Test
        @DisplayName("currentHeat stays within [0, maxHeat] under repeated over-capacity packets")
        void neverGoesNegativeOrOverCapacity() {
            Condensator c = condensator("rshCondensator");
            for (int i = 0; i < 5; i++) {
                c.adjustCurrentHeat(29568);
                assertTrue(c.getCurrentHeat() >= 0, "never negative: " + c.getCurrentHeat());
                assertTrue(
                        c.getCurrentHeat() <= c.getMaxHeat(),
                        "never over capacity: " + c.getCurrentHeat() + " > " + c.getMaxHeat());
            }
            assertClose(20000, c.getCurrentHeat(), 1e-9, "sits exactly at capacity");
        }

        /**
         * The old bound was only ever wrong for a packet above half the capacity, so the LZH
         * (capacity 100 000) was immune to it in practice: the largest packet any rod emits is
         * 29 568 (pinned in FuelRodTest.maximumSinglePacketHeat).
         */
        @Test
        @DisplayName("the LZH absorbs every packet the game can produce")
        void lzhAbsorbsEveryReachablePacket() {
            Condensator c = condensator("lzhCondensator");
            for (int i = 0; i < 3; i++) {
                assertClose(0, c.adjustCurrentHeat(29568), 1e-9, "nothing refused");
            }
            assertClose(3 * 29568.0, c.getCurrentHeat(), 1e-9, "all of it stored");
        }

        @Test
        @DisplayName("negative heat is always refused outright and never stored")
        void coolingIsAlwaysRefused() {
            Condensator c = condensator("rshCondensator");
            c.adjustCurrentHeat(5000);
            assertClose(5000, c.getCurrentCondensatorCooling(), 1e-9, "precondition: 5 000 absorbed");

            assertClose(-1000, c.adjustCurrentHeat(-1000), 1e-9, "the -1000 is passed straight back");
            assertClose(5000, c.getCurrentHeat(), 1e-9, "a condensator cannot be cooled");
            assertClose(
                    5000,
                    c.getCurrentCondensatorCooling(),
                    1e-9,
                    "and the refused cooling did not raise the absorbed-heat counter");
        }

        @Test
        @DisplayName("small packets accumulate without loss up to capacity")
        void smallPacketsAccumulate() {
            Condensator c = condensator("rshCondensator");
            for (int i = 0; i < 5; i++) {
                assertClose(0, c.adjustCurrentHeat(4000), 1e-9, "packet " + i + " refused nothing");
            }
            assertClose(20000, c.getCurrentHeat(), 1e-9, "all 5 x 4 000 stored, exactly full");
            assertTrue(c.isBroken(), "which means it is now broken");
            assertClose(4000, c.adjustCurrentHeat(4000), 1e-9, "and the next packet is fully refused");
        }
    }

    // ------------------------------------------------------------------ reported cooling

    @Nested
    @DisplayName("reported cooling")
    class ReportedCooling {

        @Test
        @DisplayName("bestCondensatorCooling tracks the peak heat absorbed within a tick")
        void bestTracksThePeak() {
            Reactor reactor = new Reactor();
            Condensator c = (Condensator) place(reactor, 2, 2, "rshCondensator");
            c.preReactorTick();
            c.adjustCurrentHeat(300);
            c.adjustCurrentHeat(900);
            assertClose(1200, c.getCurrentCondensatorCooling(), 1e-9, "this tick so far");
            assertClose(1200, c.getBestCondensatorCooling(), 1e-9, "and that is the peak");

            c.preReactorTick();
            assertClose(0, c.getCurrentCondensatorCooling(), 1e-9, "reset each tick");
            c.adjustCurrentHeat(100);
            assertClose(1200, c.getBestCondensatorCooling(), 1e-9, "peak unchanged");
        }

        /**
         * P3-18. The old code added the <i>offered</i> heat to the counter, so a nearly-full
         * condensator reported full credit for heat it then refused. The counter now tracks what
         * was actually absorbed, so it can never exceed the heat the condensator really took.
         */
        @Test
        @DisplayName("the reported cooling never exceeds the heat actually stored")
        void coolingNeverExceedsWhatWasStored() {
            Condensator c = condensator("rshCondensator");
            c.preReactorTick();
            c.adjustCurrentHeat(10000); // stored in full
            c.adjustCurrentHeat(19000); // only 10 000 of room left
            assertClose(20000, c.getCurrentHeat(), 1e-9, "20 000 was stored in total");
            assertClose(
                    20000,
                    c.getCurrentCondensatorCooling(),
                    1e-9,
                    "and the reported cooling matches it, not the 29 000 offered");
        }
    }

    // ------------------------------------------------------------------ RCI

    @Nested
    @DisplayName("reactor coolant injectors")
    class CoolantInjectors {

        /**
         * Two 10 000 packets fill an RSH exactly, which is also the point at which it trips the
         * injector threshold.
         */
        private Condensator fullRsh() {
            Condensator c = condensator("rshCondensator");
            c.adjustCurrentHeat(10000);
            c.adjustCurrentHeat(10000);
            assertClose(20000, c.getCurrentHeat(), 1e-9, "precondition: filled");
            return c;
        }

        @Test
        @DisplayName("needsCoolantInjected is false below 85% of capacity and true above it")
        void thresholdIsEightyFivePercent() {
            Condensator c = condensator("rshCondensator");
            c.adjustCurrentHeat(10000); // 50% of 20 000
            assertFalse(c.needsCoolantInjected(), "50% is well below the threshold");
            c.adjustCurrentHeat(10000); // 100%
            assertTrue(c.needsCoolantInjected(), "100% is past the 85% threshold");
        }

        @Test
        @DisplayName("injectCoolant empties the condensator")
        void injectCoolantEmpties() {
            Condensator c = fullRsh();
            assertTrue(c.needsCoolantInjected(), "precondition");
            c.injectCoolant();
            assertClose(0, c.getCurrentHeat(), 1e-9, "emptied");
            assertFalse(c.needsCoolantInjected(), "no longer needs coolant");
        }

        @Test
        @DisplayName("an emptied condensator can absorb again")
        void emptiedCondensatorCanAbsorbAgain() {
            Condensator c = fullRsh();
            c.injectCoolant();
            assertClose(0, c.adjustCurrentHeat(5000), 1e-9, "nothing refused after emptying");
            assertClose(5000, c.getCurrentHeat(), 1e-9, "and it stores again");
        }

        @Test
        @DisplayName("maxReachedHeat remembers the high-water mark across an injection")
        void maxReachedHeatSurvivesInjection() {
            Condensator c = fullRsh();
            c.injectCoolant();
            assertClose(20000, c.getMaxReachedHeat(), 1e-9, "high-water mark retained");
        }
    }

    @Test
    @DisplayName("the tooltip reports the capacity")
    void tooltipReportsCapacity() {
        assertEquals(1, condensator("rshCondensator").formatTooltip().length, "rsh");
        assertEquals(1, condensator("lzhCondensator").formatTooltip().length, "lzh");
    }
}
