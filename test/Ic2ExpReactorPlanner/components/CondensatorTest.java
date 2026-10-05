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
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * {@link Condensator} (RSH / LZH) absorption and Reactor Coolant Injector interaction.
 *
 * <p><b>Known bug (CODE_REVIEW.md P0-2).</b> The absorption bound is
 * {@code min(heat, maxHeat - heat)} where it should be {@code min(heat, maxHeat - currentHeat)}.
 * The two agree only while {@code currentHeat == heat}; once a single packet exceeds half the
 * condensator's capacity the bound goes <i>negative</i> and {@code currentHeat} is driven below
 * zero. The largest packet any fuel rod can emit is 29 568 heat (pinned in {@code FuelRodTest}),
 * which overflows the 20 000 RSH but not the 100 000 LZH.
 *
 * <p>The characterisation tests pin today's behaviour so a refactor cannot silently move it; the
 * disabled contract test states the behaviour the code is supposed to have.
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

    @Test
    @DisplayName("accepts a normal packet in full")
    void acceptsNormalPacket() {
        Condensator c = condensator("rshCondensator");
        double rejected = c.adjustCurrentHeat(4000);
        assertClose(0, rejected, 1e-9, "nothing rejected");
        assertClose(4000, c.getCurrentHeat(), 1e-9, "stored");
    }

    @Test
    @DisplayName("repeated small packets all land, well past the point where heat > maxHeat/2")
    void repeatedSmallPacketsAreAllAccepted() {
        Condensator c = condensator("rshCondensator");
        for (int i = 0; i < 10; i++) {
            assertClose(0, c.adjustCurrentHeat(4000), 1e-9, "packet " + i + " rejected nothing");
        }
        assertClose(40000, c.getCurrentHeat(), 1e-9, "all 40 000 stored");
    }

    // ------------------------------------------------------------------ current behaviour

    @Nested
    @DisplayName("current behaviour of the absorption bound")
    class CurrentBound {

        @Test
        @DisplayName("a packet of exactly half the capacity is accepted in full")
        void halfCapacityAccepted() {
            Condensator c = condensator("rshCondensator");
            assertClose(0, c.adjustCurrentHeat(10000), 1e-9, "nothing rejected");
            assertClose(10000, c.getCurrentHeat(), 1e-9, "stored");
        }

        @Test
        @DisplayName("a packet equal to the whole capacity stores nothing")
        void fullCapacityStoresNothing() {
            // min(20000, 20000 - 20000) = 0. The correct bound would accept all 20 000.
            Condensator c = condensator("rshCondensator");
            assertClose(20000, c.adjustCurrentHeat(20000), 1e-9, "everything rejected");
            assertClose(0, c.getCurrentHeat(), 1e-9, "nothing stored");
        }

        @Test
        @DisplayName("a packet above the capacity drives currentHeat NEGATIVE")
        void oversizedPacketGoesNegative() {
            // 29 568 is the largest packet any rod emits; min(29568, 20000 - 29568) = -9568.
            Condensator c = condensator("rshCondensator");
            double rejected = c.adjustCurrentHeat(29568);
            assertClose(-9568, c.getCurrentHeat(), 1e-9, "heat went negative");
            assertClose(29568 - (-9568), rejected, 1e-9, "the caller is charged 39 136 for a 29 568 packet");
        }

        @Test
        @DisplayName("the LZH is large enough that no rod packet can trigger the bad branch")
        void lzhIsUnaffected() {
            // half of 100 000 is 50 000, above the 29 568 maximum packet, so the bound is
            // always the non-negative maxHeat - heat.
            Condensator c = condensator("lzhCondensator");
            assertClose(0, c.adjustCurrentHeat(29568), 1e-9, "nothing rejected");
            assertClose(29568, c.getCurrentHeat(), 1e-9, "stored in full");
        }

        @Test
        @DisplayName("negative heat is always refused outright")
        void refusesCooling() {
            Condensator c = condensator("rshCondensator");
            c.adjustCurrentHeat(5000);
            assertClose(-1000, c.adjustCurrentHeat(-1000), 1e-9, "the -1000 is passed straight back");
            assertClose(5000, c.getCurrentHeat(), 1e-9, "unchanged");
        }
    }

    // ------------------------------------------------------------------ contract (P0-2)

    @Nested
    @Disabled("CODE_REVIEW.md P0-2: the absorption bound must be maxHeat - currentHeat, not maxHeat - heat")
    @DisplayName("intended behaviour of the absorption bound")
    class IntendedBound {

        @ParameterizedTest(name = "a fresh RSH accepts a {0} heat packet in full")
        @ValueSource(doubles = {4000, 10000, 20000, 29568})
        void freshCondensatorAcceptsUpToCapacity(double packet) {
            Condensator c = condensator("rshCondensator");
            assertClose(0, c.adjustCurrentHeat(packet), 1e-9, "nothing rejected while empty");
            assertClose(packet, c.getCurrentHeat(), 1e-9, "stored in full");
        }

        @Test
        @DisplayName("a warm condensator accepts exactly its remaining room")
        void warmCondensatorAcceptsRemainingRoom() {
            Condensator c = condensator("rshCondensator");
            c.adjustCurrentHeat(15000);
            assertClose(15000, c.getCurrentHeat(), 1e-9, "precondition");
            assertClose(5000, c.adjustCurrentHeat(15000), 1e-9, "only 5 000 of room left");
            assertClose(20000, c.getCurrentHeat(), 1e-9, "filled to capacity, never above");
        }

        @Test
        @DisplayName("currentHeat never goes negative")
        void neverGoesNegative() {
            Condensator c = condensator("rshCondensator");
            for (double packet : new double[] {29568, 29568, 29568, 29568, 29568}) {
                c.adjustCurrentHeat(packet);
                assertTrue(c.getCurrentHeat() >= 0, "heat stayed non-negative: " + c.getCurrentHeat());
                assertTrue(c.getCurrentHeat() <= c.getMaxHeat(), "heat stayed within capacity");
            }
        }

        @Test
        @DisplayName("an over-capacity packet is charged as rejected, not as a negative transfer")
        void overCapacityIsRejectedNotNegative() {
            Condensator c = condensator("rshCondensator");
            double rejected = c.adjustCurrentHeat(29568);
            assertClose(29568, rejected, 1e-9, "the whole packet is rejected");
            assertClose(0, c.getCurrentHeat(), 1e-9, "nothing stored");
        }
    }

    // ------------------------------------------------------------------ RCI behaviour

    @Nested
    @DisplayName("reactor coolant injectors")
    class CoolantInjectors {

        /**
         * Two 10 000 packets fill an RSH exactly, because 10 000 is the largest packet the
         * current bound stores whole (at that size {@code maxHeat - heat == heat}).
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
        @DisplayName("maxReachedHeat remembers the high-water mark across an injection")
        void maxReachedHeatSurvivesInjection() {
            Condensator c = fullRsh();
            c.injectCoolant();
            assertClose(20000, c.getMaxReachedHeat(), 1e-9, "high-water mark retained");
        }
    }

    // ------------------------------------------------------------------ reporting

    @Test
    @DisplayName("bestCondensatorCooling accumulates the heat offered during a tick")
    void bestCondensatorCooling() {
        Reactor reactor = new Reactor();
        Condensator c = (Condensator) place(reactor, 2, 2, "rshCondensator");
        c.preReactorTick();
        c.adjustCurrentHeat(300);
        c.adjustCurrentHeat(900);
        // 300 and 900 are both under half the capacity, so both are stored whole and the
        // offered total happens to equal the stored total.
        assertClose(1200, c.getCurrentCondensatorCooling(), 1e-9, "offered this tick");
        assertClose(1200, c.getBestCondensatorCooling(), 1e-9, "and that is the peak");

        c.preReactorTick();
        assertClose(0, c.getCurrentCondensatorCooling(), 1e-9, "reset each tick");
        c.adjustCurrentHeat(100);
        assertClose(1200, c.getBestCondensatorCooling(), 1e-9, "peak unchanged");
    }

    @Test
    @DisplayName("currentCondensatorCooling counts heat OFFERED, not heat accepted")
    void coolingMetricCountsOfferedHeat() {
        // A second consequence of the P0-2 bound: the reported "received heat" is the amount
        // pushed at the condensator, so a nearly-full condensator still reports full credit for
        // heat it then refuses. Pin it so the fix has to be a conscious decision.
        Condensator c = condensator("rshCondensator");
        c.preReactorTick();
        c.adjustCurrentHeat(10000); // stored 10 000
        c.adjustCurrentHeat(19000); // min(19000, 20000-19000) = 1000 stored, 18 000 refused
        assertClose(29000, c.getCurrentCondensatorCooling(), 1e-9, "reported cooling is the offered total");
        assertClose(11000, c.getCurrentHeat(), 1e-9, "but only 11 000 was actually stored");
    }

    @ParameterizedTest(name = "{0} tooltip reports its capacity")
    @CsvSource({"rshCondensator", "lzhCondensator"})
    @DisplayName("tooltip reports the capacity")
    void tooltip(String name) {
        assertEquals(1, condensator(name).formatTooltip().length, name);
    }
}