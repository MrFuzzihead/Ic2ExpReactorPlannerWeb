package Ic2ExpReactorPlanner;

import static Ic2ExpReactorPlanner.TestSupport.assertClose;
import static Ic2ExpReactorPlanner.TestSupport.place;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import Ic2ExpReactorPlanner.components.ReactorItem;
import Ic2ExpReactorPlanner.components.Vent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/** The 6x9 grid, the heat accumulator, and the materials/component summaries. */
class ReactorTest {

    @BeforeEach
    @AfterEach
    void resetGlobals() {
        TestSupport.resetGlobalConfig();
    }

    // ================================================================== grid access

    @Nested
    @DisplayName("grid access")
    class Grid {

        @Test
        @DisplayName("a fresh reactor is 6 rows by 9 columns and empty")
        void startsEmpty() {
            Reactor reactor = new Reactor();
            for (int[] cell : TestSupport.CELLS) {
                assertNull(reactor.getComponentAt(cell[0], cell[1]), "empty at " + cell[0] + "," + cell[1]);
            }
            assertEquals(6, TestSupport.ROWS);
            assertEquals(9, TestSupport.COLS);
        }

        @ParameterizedTest(name = "getComponentAt({0}, {1}) is out of bounds and yields null")
        @CsvSource({
            "-1, 0",
            "0, -1",
            "6, 0",
            "0, 9",
            "99, 99",
            "-5, -5",
        })
        @DisplayName("out-of-bounds reads yield null instead of throwing")
        void outOfBoundsReadsYieldNull(int row, int col) {
            assertNull(new Reactor().getComponentAt(row, col));
        }

        @ParameterizedTest(name = "setComponentAt({0}, {1}) is ignored")
        @CsvSource({
            "-1, 0",
            "0, -1",
            "6, 0",
            "0, 9",
            "99, 99",
        })
        @DisplayName("out-of-bounds writes are ignored instead of throwing")
        void outOfBoundsWritesAreIgnored(int row, int col) {
            Reactor reactor = new Reactor();
            reactor.setComponentAt(row, col, ComponentFactory.createComponent("fuelRodUranium"));
            assertEquals(
                    10000,
                    reactor.getMaxHeat(),
                    1e-9,
                    "nothing was placed, so no plating-style side effect occurred either");
        }

        @Test
        @DisplayName("setComponentAt stores and returns the same instance")
        void storesTheSameInstance() {
            Reactor reactor = new Reactor();
            ReactorItem rod = ComponentFactory.createComponent("fuelRodUranium");
            reactor.setComponentAt(2, 3, rod);
            assertSame(rod, reactor.getComponentAt(2, 3));
        }

        @Test
        @DisplayName("replacing a component detaches the old one")
        void replacingDetachesTheOldOne() {
            Reactor reactor = new Reactor();
            ReactorItem first = place(reactor, 2, 2, "reactorPlating");
            assertClose(11000, reactor.getMaxHeat(), 1e-9, "plating raises max heat");

            ReactorItem second = place(reactor, 2, 2, "heatCapacityReactorPlating");
            // the old plating's contribution was handed back before the new one was added
            assertClose(11700, reactor.getMaxHeat(), 1e-9, "swapped without leaking");
            assertSame(second, reactor.getComponentAt(2, 2));

            reactor.setComponentAt(2, 2, null);
            assertClose(10000, reactor.getMaxHeat(), 1e-9, "removed");
            assertClose(1, first.getMaxDamage(), 1e-9, "and the detached one is inert");
        }

        @Test
        @DisplayName("clearGrid empties the reactor and restores the base max heat")
        void clearGrid() {
            Reactor reactor = new Reactor();
            for (int[] cell : TestSupport.CELLS) {
                place(reactor, cell[0], cell[1], "heatCapacityReactorPlating");
            }
            reactor.clearGrid();
            assertTrue(TestSupport.componentsOf(reactor).isEmpty(), "no components left");
            assertClose(10000, reactor.getMaxHeat(), 1e-9, "base max heat restored");
        }

        @Test
        @DisplayName("clearGrid on an already empty reactor is a no-op")
        void clearEmptyGrid() {
            Reactor reactor = new Reactor();
            reactor.clearGrid();
            assertClose(10000, reactor.getMaxHeat(), 1e-9);
        }
    }

    // ================================================================== heat bookkeeping

    @Nested
    @DisplayName("heat bookkeeping")
    class Heat {

        @Test
        @DisplayName("a bare reactor holds 10 000 heat")
        void baseMaxHeat() {
            assertClose(10000, new Reactor().getMaxHeat(), 1e-9);
        }

        @Test
        @DisplayName("adjustMaxHeat accumulates")
        void adjustMaxHeatAccumulates() {
            Reactor reactor = new Reactor();
            reactor.adjustMaxHeat(500);
            reactor.adjustMaxHeat(250);
            assertClose(10750, reactor.getMaxHeat(), 1e-9);
            reactor.adjustMaxHeat(-250);
            assertClose(10500, reactor.getMaxHeat(), 1e-9);
        }

        @Test
        @DisplayName("adjustCurrentHeat never takes the reactor below zero")
        void currentHeatFloorsAtZero() {
            Reactor reactor = new Reactor();
            reactor.adjustCurrentHeat(-500);
            assertClose(0, reactor.getCurrentHeat(), 1e-9, "clamped at zero");
            reactor.adjustCurrentHeat(1000);
            assertClose(1000, reactor.getCurrentHeat(), 1e-9);
            reactor.adjustCurrentHeat(-2500);
            assertClose(0, reactor.getCurrentHeat(), 1e-9, "clamped again");
        }

        @Test
        @DisplayName("the reactor itself has no max-heat clamp; only components do")
        void reactorHeatIsUnclamped() {
            Reactor reactor = new Reactor();
            reactor.adjustCurrentHeat(999999);
            assertClose(999999, reactor.getCurrentHeat(), 1e-9, "setCurrentHeat/adjustCurrentHeat do not clamp high");
            reactor.setCurrentHeat(0);
            assertClose(0, reactor.getCurrentHeat(), 1e-9);
        }

        @Test
        @DisplayName("EU output and vented heat accumulate within a tick and reset with clear")
        void accumulatorsReset() {
            Reactor reactor = new Reactor();
            reactor.addEUOutput(100);
            reactor.addEUOutput(50);
            assertClose(150, reactor.getCurrentEUoutput(), 1e-9, "accumulated");
            reactor.clearEUOutput();
            assertClose(0, reactor.getCurrentEUoutput(), 1e-9);

            reactor.ventHeat(30);
            reactor.ventHeat(20);
            assertClose(50, reactor.getVentedHeat(), 1e-9);
            reactor.clearVentedHeat();
            assertClose(0, reactor.getVentedHeat(), 1e-9);
        }
    }

    // ================================================================== mode flags

    @Nested
    @DisplayName("mode flags")
    class Modes {

        @Test
        @DisplayName("defaults are EU mode, not pulsed, not automated, no injectors")
        void defaults() {
            Reactor reactor = new Reactor();
            assertFalse(reactor.isFluid(), "EU output by default");
            assertFalse(reactor.isPulsed(), "not pulsed by default");
            assertFalse(reactor.isAutomated(), "not automated by default");
            assertFalse(reactor.isUsingReactorCoolantInjectors(), "no injectors by default");
            assertClose(0, reactor.getCurrentHeat(), 1e-9);
            assertClose(10000, reactor.getMaxHeat(), 1e-9);
            assertEquals(5000000, reactor.getMaxSimulationTicks());
        }

        @Test
        @DisplayName("the pulse defaults are 5 000 000 on, 0 off, 120 000 suspend and resume")
        void pulseDefaults() {
            Reactor reactor = new Reactor();
            assertEquals(5000000, reactor.getOnPulse());
            assertEquals(0, reactor.getOffPulse());
            assertEquals(120000, reactor.getSuspendTemp());
            assertEquals(120000, reactor.getResumeTemp());
        }

        @Test
        @DisplayName("resetPulseConfig restores the defaults")
        void resetPulseConfig() {
            Reactor reactor = new Reactor();
            reactor.setOnPulse(1000);
            reactor.setOffPulse(2000);
            reactor.setSuspendTemp(3000);
            reactor.setResumeTemp(4000);
            reactor.resetPulseConfig();
            assertEquals(5000000, reactor.getOnPulse());
            assertEquals(0, reactor.getOffPulse());
            assertEquals(120000, reactor.getSuspendTemp());
            assertEquals(120000, reactor.getResumeTemp());
        }

        @Test
        @DisplayName("setters round-trip every mode flag")
        void settersRoundTrip() {
            Reactor reactor = new Reactor();
            reactor.setFluid(true);
            reactor.setPulsed(true);
            reactor.setAutomated(true);
            reactor.setUsingReactorCoolantInjectors(true);
            reactor.setMaxSimulationTicks(1234);
            assertTrue(reactor.isFluid());
            assertTrue(reactor.isPulsed());
            assertTrue(reactor.isAutomated());
            assertTrue(reactor.isUsingReactorCoolantInjectors());
            assertEquals(1234, reactor.getMaxSimulationTicks());
        }
    }

    // ================================================================== summaries

    @Nested
    @DisplayName("materials and component lists")
    class Summaries {

        @Test
        @DisplayName("an empty reactor needs nothing")
        void emptyReactor() {
            Reactor reactor = new Reactor();
            assertEquals("", reactor.getMaterials().toString());
            assertEquals("", reactor.getComponentList().toString());
        }

        @Test
        @DisplayName("the component list aggregates identical components into one counted line")
        void identicalComponentsAggregate() {
            Reactor reactor = new Reactor();
            place(reactor, 2, 2, "fuelRodUranium");
            place(reactor, 2, 3, "fuelRodUranium");
            java.util.Map<String, Double> counts =
                    TestSupport.parseMaterialList(reactor.getComponentList().toString());
            assertEquals(1, counts.size(), "one distinct component type");
            assertEquals(2.0, counts.values().iterator().next().doubleValue(), 1e-9, "counted twice");
        }

        @Test
        @DisplayName("different component types get their own lines")
        void differentComponentsGetOwnLines() {
            Reactor reactor = new Reactor();
            place(reactor, 0, 0, "fuelRodUranium");
            place(reactor, 2, 2, "neutronReflector");
            place(reactor, 4, 4, "coolantCell60k");
            java.util.Map<String, Double> counts =
                    TestSupport.parseMaterialList(reactor.getComponentList().toString());
            assertEquals(3, counts.size(), "three distinct component types");
            for (Double value : counts.values()) {
                assertEquals(1.0, value.doubleValue(), 1e-9, "each appears once");
            }
        }

        @Test
        @DisplayName("materials quantities aggregate across components")
        void materialsAggregate() {
            Reactor oneRod = new Reactor();
            place(oneRod, 2, 2, "fuelRodUranium");
            Reactor twoRods = new Reactor();
            place(twoRods, 2, 2, "fuelRodUranium");
            place(twoRods, 2, 3, "fuelRodUranium");

            java.util.Map<String, Double> one = TestSupport.parseMaterialList(oneRod.getMaterials().toString());
            java.util.Map<String, Double> two = TestSupport.parseMaterialList(twoRods.getMaterials().toString());

            assertEquals(one.size(), two.size(), "same distinct materials");
            for (java.util.Map.Entry<String, Double> entry : one.entrySet()) {
                assertEquals(
                        entry.getValue().doubleValue() * 2,
                        two.get(entry.getKey()).doubleValue(),
                        1e-9,
                        "double the quantity of " + entry.getKey());
            }
        }

        @Test
        @DisplayName("a rod, a reflector and a coolant cell together need more materials than any one")
        void mixedComponentsWidenTheList() {
            Reactor mixed = new Reactor();
            place(mixed, 0, 0, "fuelRodUranium");
            place(mixed, 2, 2, "neutronReflector");
            place(mixed, 4, 4, "coolantCell60k");

            Reactor single = new Reactor();
            place(single, 0, 0, "fuelRodUranium");

            assertTrue(
                    TestSupport.parseMaterialList(mixed.getMaterials().toString()).size()
                            > TestSupport.parseMaterialList(single.getMaterials().toString()).size(),
                    "three different components pull in more distinct materials than one rod");
            assertEquals(
                    2.0,
                    TestSupport.parseMaterialList(mixed.getMaterials().toString())
                            .get(MaterialsList.IRON),
                    1e-9,
                    "and the rod's iron requirement is still counted");
        }

        @Test
        @DisplayName("getMaterials tolerates every component in the factory")
        void everyComponentHasMaterials() {
            for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
                ReactorItem item = ComponentFactory.createComponent(id);
                assertNotNull(
                        MaterialsList.getMaterialsForComponent(item),
                        item.baseName + " has no recipe entry; getMaterials() would throw on it");
                Reactor reactor = new Reactor();
                reactor.setComponentAt(2, 2, item);
                assertNotNull(reactor.getMaterials(), item.baseName + " produced no materials list");
            }
        }

        /**
         * CODE_REVIEW.md P3-9: {@code getMaterialsForComponent} returns null for a baseName with
         * no recipe entry, and {@code MaterialsList.add} rejects a null element outright -- that
         * is the right error for a genuine misuse, but not for this call. {@code getMaterials()}
         * now skips the missing recipe, so an unbuildable component leaves nothing on the
         * shopping list rather than crashing the GUI. Every factory component has an entry, so
         * the guard is a trap rather than a live path, and the test has to build one by hand.
         */
        @Test
        @DisplayName("a component with no recipe entry is skipped rather than crashing")
        void unknownComponentIsSkipped() {
            Vent orphan = new Vent(99, "noSuchComponent", "Orphan", null, 1, 1, null, 0, 0, 4);
            assertNull(
                    MaterialsList.getMaterialsForComponent(orphan), "the recipe lookup misses");
            Reactor reactor = new Reactor();
            reactor.setComponentAt(2, 2, orphan);
            assertEquals(
                    new Reactor().getMaterials().toString(),
                    reactor.getMaterials().toString(),
                    "and the empty shopping list is unchanged");
        }
    }

    // ================================================================== constants

    /** Java 8 has no String.lines(); TestSupport.countLines is the equivalent. */
    @Test
    @DisplayName("MAX_COMPONENT_HEAT matches the largest coolant cell")
    void maxComponentHeatConstant() {
        assertEquals(1080000, Reactor.MAX_COMPONENT_HEAT);
        assertTrue(
                Reactor.MAX_COMPONENT_HEAT >= 360000,
                "must cover the 360k coolant cells and the GTNH 1080k space cell");
    }

    @ParameterizedTest
    @ValueSource(strings = {"fuelRodUranium", "coolantCell60k", "reactorPlating", "rshCondensator"})
    @DisplayName("components placed via the factory are independent instances")
    void factoryReturnsFreshInstances(String baseName) {
        ReactorItem a = ComponentFactory.createComponent(baseName);
        ReactorItem b = ComponentFactory.createComponent(baseName);
        assertNotNull(a);
        assertNotNull(b);
        assertTrue(a != b, "each createComponent call must return a new object");
        assertEquals(a.getClass(), b.getClass());
    }
}