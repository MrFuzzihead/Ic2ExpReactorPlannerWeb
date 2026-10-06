package Ic2ExpReactorPlanner.components;

import static Ic2ExpReactorPlanner.TestSupport.assertClose;
import static Ic2ExpReactorPlanner.TestSupport.place;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
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
 * {@link Vent} dissipation: hull draw, self venting, and the component-side spread.
 *
 * <p>Factory values under test:
 *
 * <pre>
 *   heatVent                 maxHeat 1000  selfVent  6  hullDraw  0  sideVent 0
 *   advancedHeatVent         maxHeat 1000  selfVent 12  hullDraw  0  sideVent 0
 *   reactorHeatVent          maxHeat 1000  selfVent  5  hullDraw  5  sideVent 0
 *   componentHeatVent        maxHeat    1  selfVent  0  hullDraw  0  sideVent 4
 *   overclockedHeatVent      maxHeat 1000  selfVent 20  hullDraw 36  sideVent 0
 * </pre>
 */
class VentTest {

    @BeforeEach
    @AfterEach
    void resetGlobals() {
        TestSupport.resetGlobalConfig();
    }

    private static Vent vent(String name) {
        return (Vent) ComponentFactory.createComponent(name);
    }

    // ------------------------------------------------------------------ self venting

    @Nested
    @DisplayName("self venting")
    class SelfVenting {

        @ParameterizedTest(name = "{0} vents {1} from itself and passes it on as reactor heat")
        @CsvSource({
            "heatVent, 6",
            "advancedHeatVent, 12",
            "reactorHeatVent, 5",
            "overclockedHeatVent, 20",
        })
        @DisplayName("a charged vent passes selfVent straight to the reactor")
        void selfVentIsHandedToTheReactor(String name, int selfVent) {
            Reactor reactor = new Reactor();
            Vent v = (Vent) place(reactor, 2, 2, name);
            reactor.setCurrentHeat(0);
            v.adjustCurrentHeat(selfVent);

            double dissipated = v.dissipate();
            assertClose(selfVent, dissipated, 1e-9, name + " self venting");
            assertClose(selfVent, reactor.getVentedHeat(), 1e-9, "reported as vented heat");
            assertClose(0, v.getCurrentHeat(), 1e-9, "vent is empty afterwards");
        }

        @Test
        @DisplayName("a vent cannot vent more than it holds")
        void cannotVentMoreThanHeld() {
            Reactor reactor = new Reactor();
            Vent v = (Vent) place(reactor, 2, 2, "overclockedHeatVent"); // selfVent 20
            reactor.setCurrentHeat(0);
            v.adjustCurrentHeat(7);
            assertClose(7, v.dissipate(), 1e-9, "only what it had");
            assertClose(7, reactor.getVentedHeat(), 1e-9, "and only that much is reported");
            assertClose(0, v.getCurrentHeat(), 1e-9, "emptied");
        }

        @Test
        @DisplayName("an empty vent dissipates nothing")
        void emptyVentDoesNothing() {
            Reactor reactor = new Reactor();
            Vent v = (Vent) place(reactor, 2, 2, "advancedHeatVent");
            reactor.setCurrentHeat(0);
            assertClose(0, v.dissipate(), 1e-9, "nothing to vent");
            assertClose(0, reactor.getVentedHeat(), 1e-9, "no output");
        }

        @Test
        @DisplayName("a vent breaks once it reaches maxHeat, and stops accepting heat")
        void ventBreaksAtMaxHeat() {
            Reactor reactor = new Reactor();
            Vent v = (Vent) place(reactor, 2, 2, "heatVent"); // maxHeat 1000
            v.adjustCurrentHeat(1000);
            assertTrue(v.isBroken(), "broken at maxHeat");
            assertFalse(v.isHeatAcceptor(), "a broken vent accepts nothing");
        }
    }

    // ------------------------------------------------------------------ hull draw

    @Nested
    @DisplayName("hull draw")
    class HullDraw {

        @Test
        @DisplayName("reactorHeatVent pulls 5 heat out of the hull and into itself")
        void pullsFromHull() {
            Reactor reactor = new Reactor();
            Vent v = (Vent) place(reactor, 2, 2, "reactorHeatVent"); // hullDraw 5, selfVent 5
            reactor.setCurrentHeat(1000);

            v.dissipate();
            assertClose(995, reactor.getCurrentHeat(), 1e-9, "hull lost 5 heat");
            assertClose(5, v.getCurrentHullCooling(), 1e-9, "recorded as hull cooling");
            // it then vents its own 5 straight back out again, netting zero on the hull
            assertClose(5, reactor.getVentedHeat(), 1e-9, "and re-emitted as vented heat");
        }

        @Test
        @DisplayName("overclockedHeatVent pulls 36 heat out of the hull")
        void overclockedPullsMore() {
            Reactor reactor = new Reactor();
            Vent v = (Vent) place(reactor, 2, 2, "overclockedHeatVent"); // hullDraw 36, selfVent 20
            reactor.setCurrentHeat(1000);
            v.dissipate();
            assertClose(36, v.getCurrentHullCooling(), 1e-9, "hull cooling");
            assertClose(964, reactor.getCurrentHeat(), 1e-9, "1000 - 36, with no re-emission beyond selfVent");
        }

        @Test
        @DisplayName("hull draw never exceeds the hull's actual heat")
        void hullDrawIsClampedToAvailableHeat() {
            Reactor reactor = new Reactor();
            Vent v = (Vent) place(reactor, 2, 2, "overclockedHeatVent"); // hullDraw 36
            reactor.setCurrentHeat(10);
            v.dissipate();
            assertClose(10, v.getCurrentHullCooling(), 1e-9, "only what the hull had");
            assertClose(0, reactor.getCurrentHeat(), 1e-9, "hull emptied");
            assertTrue(reactor.getCurrentHeat() >= 0, "hull never goes negative");
        }

        @Test
        @DisplayName("componentHeatVent has hullDraw 0 and never touches the hull")
        void componentVentDoesNotTouchHull() {
            Reactor reactor = new Reactor();
            Vent v = (Vent) place(reactor, 2, 2, "componentHeatVent");
            reactor.setCurrentHeat(500);
            v.dissipate();
            assertClose(500, reactor.getCurrentHeat(), 1e-9, "hull untouched");
            assertClose(0, v.getCurrentHullCooling(), 1e-9, "no hull cooling");
        }
    }

    // ------------------------------------------------------------------ side venting

    @Nested
    @DisplayName("component-side venting")
    class SideVenting {

        @Test
        @DisplayName("componentHeatVent spreads 4 heat out of each adjacent charged coolant cell")
        void spreadsToCoolableNeighbours() {
            Reactor reactor = new Reactor();
            Vent v = (Vent) place(reactor, 2, 2, "componentHeatVent"); // sideVent 4
            CoolantCell left = (CoolantCell) place(reactor, 2, 1, "coolantCell60k");
            CoolantCell right = (CoolantCell) place(reactor, 2, 3, "coolantCell60k");
            // A cell has to be charged first: you cannot extract heat that is not there.
            left.adjustCurrentHeat(1000);
            right.adjustCurrentHeat(1000);
            reactor.setCurrentHeat(0);

            v.dissipate();
            assertClose(996, left.getCurrentHeat(), 1e-9, "left cell lost 4");
            assertClose(996, right.getCurrentHeat(), 1e-9, "right cell lost 4");
            assertClose(8, reactor.getVentedHeat(), 1e-9, "both counted as vented heat");
        }

        @Test
        @DisplayName("an uncharged coolant cell refuses the vent, so nothing is vented through it")
        void unchargedNeighbourRefusesTheVent() {
            // adjustCurrentHeat(-4) on an empty cell returns -4 (all of it refused), so
            // sideVent + rejectedCooling == 0. This is correct IC2 behaviour, not a bug.
            Reactor reactor = new Reactor();
            Vent v = (Vent) place(reactor, 2, 2, "componentHeatVent");
            CoolantCell empty = (CoolantCell) place(reactor, 2, 1, "coolantCell60k");
            reactor.setCurrentHeat(0);

            v.dissipate();
            assertClose(0, empty.getCurrentHeat(), 1e-9, "still empty");
            assertClose(0, reactor.getVentedHeat(), 1e-9, "nothing vented");
        }

        @Test
        @DisplayName("neighbours that are not coolable are skipped")
        void skipsNonCoolableNeighbours() {
            Reactor reactor = new Reactor();
            Vent v = (Vent) place(reactor, 2, 2, "componentHeatVent");
            place(reactor, 2, 1, "neutronReflector"); // maxHeat 1 -> not coolable
            CoolantCell right = (CoolantCell) place(reactor, 2, 3, "coolantCell60k");
            right.adjustCurrentHeat(1000);
            reactor.setCurrentHeat(0);

            v.dissipate();
            assertClose(996, right.getCurrentHeat(), 1e-9, "only the coolant cell was touched");
            assertClose(4, reactor.getVentedHeat(), 1e-9, "one neighbour worth of venting");
        }

        @Test
        @DisplayName("a condensator neighbour is not coolable, so the spread passes over it")
        void condensatorsAreNotCoolable() {
            Reactor reactor = new Reactor();
            Vent v = (Vent) place(reactor, 2, 2, "componentHeatVent");
            place(reactor, 2, 1, "rshCondensator");
            reactor.setCurrentHeat(0);
            v.dissipate();
            assertClose(0, reactor.getVentedHeat(), 1e-9, "nothing vented, the condensator refused");
        }

        @Test
        @DisplayName("a partially filled neighbour gives up the full 4")
        void partialNeighbourGivesUpFullSideVent() {
            Reactor reactor = new Reactor();
            Vent v = (Vent) place(reactor, 2, 2, "componentHeatVent"); // sideVent 4
            CoolantCell nearlyFull = (CoolantCell) place(reactor, 2, 1, "coolantCell10k");
            nearlyFull.adjustCurrentHeat(nearlyFull.getMaxHeat() - 2); // 9 998 of 10 000
            reactor.setCurrentHeat(0);

            v.dissipate();
            assertClose(9994, nearlyFull.getCurrentHeat(), 1e-9, "cell gave up all 4");
            assertClose(4, reactor.getVentedHeat(), 1e-9, "the full 4 counts as vented");
        }

        @Test
        @DisplayName("a broken neighbour refuses the vent even though isCoolable() is still true")
        void fullNeighbourContributesNothing() {
            // isCoolable() only checks maxHeat and type, not isBroken(), so a full cell is
            // still selected -- but adjustCurrentHeat refuses everything, so nothing is vented.
            Reactor reactor = new Reactor();
            Vent v = (Vent) place(reactor, 2, 2, "componentHeatVent");
            CoolantCell full = (CoolantCell) place(reactor, 2, 1, "coolantCell10k");
            full.adjustCurrentHeat(full.getMaxHeat());
            assertTrue(full.isBroken(), "precondition");
            assertTrue(full.isCoolable(), "isCoolable ignores isBroken");
            reactor.setCurrentHeat(0);

            v.dissipate();
            assertClose(0, reactor.getVentedHeat(), 1e-9, "nothing to vent anywhere");
        }
    }

    // ------------------------------------------------------------------ reported capacities

    @Test
    @DisplayName("getHullCoolingCapacity reports hullDraw")
    void hullCoolingCapacity() {
        assertClose(5, vent("reactorHeatVent").getHullCoolingCapacity(), 1e-9, "reactorHeatVent");
        assertClose(36, vent("overclockedHeatVent").getHullCoolingCapacity(), 1e-9, "overclockedHeatVent");
        assertClose(0, vent("heatVent").getHullCoolingCapacity(), 1e-9, "heatVent");
    }

    @Test
    @DisplayName("getVentCoolingCapacity is selfVent plus sideVent per coolable neighbour")
    void ventCoolingCapacity() {
        Reactor bare = new Reactor();
        place(bare, 2, 2, "componentHeatVent"); // selfVent 0, sideVent 4
        assertClose(0, bare.getComponentAt(2, 2).getVentCoolingCapacity(), 1e-9, "no coolable neighbours");

        Reactor oneNeighbour = new Reactor();
        place(oneNeighbour, 2, 2, "componentHeatVent");
        place(oneNeighbour, 2, 1, "coolantCell60k");
        assertClose(4, oneNeighbour.getComponentAt(2, 2).getVentCoolingCapacity(), 1e-9, "one coolable neighbour");

        Reactor fourNeighbours = new Reactor();
        place(fourNeighbours, 2, 2, "componentHeatVent");
        place(fourNeighbours, 2, 1, "coolantCell60k");
        place(fourNeighbours, 2, 3, "coolantCell60k");
        place(fourNeighbours, 1, 2, "coolantCell60k");
        place(fourNeighbours, 3, 2, "coolantCell60k");
        assertClose(16, fourNeighbours.getComponentAt(2, 2).getVentCoolingCapacity(), 1e-9, "four coolable neighbours");

        Reactor selfVenting = new Reactor();
        place(selfVenting, 2, 2, "overclockedHeatVent"); // selfVent 20, sideVent 0
        assertClose(
                20, selfVenting.getComponentAt(2, 2).getVentCoolingCapacity(), 1e-9, "self venting only");
    }

    @Test
    @DisplayName("bestVentCooling keeps the peak across ticks")
    void bestVentCooling() {
        Reactor reactor = new Reactor();
        // advancedHeatVent has hullDraw 0, so the vent only vents what it was handed.
        Vent v = (Vent) place(reactor, 2, 2, "advancedHeatVent"); // selfVent 12
        reactor.setCurrentHeat(10000);

        v.preReactorTick();
        v.adjustCurrentHeat(12);
        v.dissipate();
        assertClose(12, v.getBestVentCooling(), 1e-9, "first tick peak");

        v.preReactorTick();
        v.adjustCurrentHeat(5);
        v.dissipate();
        assertClose(5, v.getCurrentVentCooling(), 1e-9, "this tick is smaller");
        assertClose(12, v.getBestVentCooling(), 1e-9, "peak retained");
    }

    @Test
    @DisplayName("a hull-drawing vent is refilled from the hull every tick")
    void hullDrawRefillsTheVent() {
        Reactor reactor = new Reactor();
        Vent v = (Vent) place(reactor, 2, 2, "overclockedHeatVent"); // hullDraw 36, selfVent 20
        reactor.setCurrentHeat(10000);

        v.preReactorTick();
        v.dissipate();
        assertClose(20, v.getCurrentVentCooling(), 1e-9, "handed 36 by the hull, vented its selfVent of 20");
        assertClose(36, v.getCurrentHullCooling(), 1e-9, "and drew all 36 from the hull");
    }

    @Test
    @DisplayName("getCurrentOutput reports the per-tick vent cooling")
    void currentOutput() {
        Reactor reactor = new Reactor();
        Vent v = (Vent) place(reactor, 2, 2, "advancedHeatVent"); // selfVent 12
        reactor.setCurrentHeat(0);
        v.adjustCurrentHeat(12);
        v.dissipate();
        assertClose(v.getCurrentVentCooling(), v.getCurrentOutput(), 1e-9, "output mirrors vent cooling");
        assertClose(12, v.getCurrentOutput(), 1e-9, "which was 12 this tick");
    }

    @Test
    @DisplayName("only components that can move heat report producesOutput")
    void producesOutput() {
        Reactor reactor = new Reactor();
        ReactorItem selfVenting = place(reactor, 2, 2, "heatVent");
        assertTrue(selfVenting.producesOutput(), "a self-venting vent produces output");

        Reactor side = new Reactor();
        place(side, 2, 2, "componentHeatVent");
        place(side, 2, 1, "coolantCell60k"); // needed, or its vent capacity is 0 and it reports no output
        assertTrue(
                side.getComponentAt(2, 2).producesOutput(), "a side-venting vent with a neighbour produces output");

        Reactor isolated = new Reactor();
        place(isolated, 2, 2, "componentHeatVent");
        assertFalse(
                isolated.getComponentAt(2, 2).producesOutput(),
                "with no coolable neighbour its vent capacity is 0");

        ReactorItem plating = ComponentFactory.createComponent("reactorPlating");
        assertFalse(plating.producesOutput(), "plating produces nothing");

        ReactorItem rod = ComponentFactory.createComponent("fuelRodUranium");
        assertFalse(rod.getVentCoolingCapacity() > 0, "a fuel rod has no vent capacity");
        assertTrue(rod.producesOutput(), "but it does produce output through its rod count");
    }

    /**
     * P3-13: {@code Vent.getVentCoolingCapacity()} used to dereference {@code parent} whenever
     * {@code sideVent > 0}, so an <i>unplaced</i> componentHeatVent (the only vent with a
     * non-zero sideVent) threw from {@code producesOutput()} as well, because that method calls
     * the capacity. An unplaced vent has no neighbours to cool, so its side-vent contribution is
     * 0 and the capacity is just {@code selfVent}. {@code dissipate()} deliberately still
     * dereferences {@code parent}: that is an action on the reactor, not a query, and it has no
     * meaning outside one.
     */
    @Test
    @DisplayName("an unplaced side-venting vent is queryable but not runnable")
    void unplacedSideVentIsQueryable() {
        Vent unplaced = vent("componentHeatVent");
        assertClose(0, unplaced.getVentCoolingCapacity(), 1e-9, "no neighbours, so no side venting");
        assertFalse(unplaced.producesOutput(), "and it produces nothing while unplaced");
        assertThrows(NullPointerException.class, unplaced::dissipate, "but running it still needs a reactor");
    }

    /** Vents with sideVent 0 never touch {@code parent}, so they are safe to query unplaced. */
    @Test
    @DisplayName("an unplaced self-venting vent reports its capacity without touching a reactor")
    void unplacedSelfVentIsSafe() {
        assertClose(6, vent("heatVent").getVentCoolingCapacity(), 1e-9, "heatVent");
        assertTrue(vent("heatVent").producesOutput(), "heatVent");
        assertClose(0, vent("componentHeatVent").getHullCoolingCapacity(), 1e-9, "componentHeatVent hullDraw");
    }
}