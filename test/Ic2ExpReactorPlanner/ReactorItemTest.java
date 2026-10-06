package Ic2ExpReactorPlanner;

import static Ic2ExpReactorPlanner.TestSupport.assertClose;
import static Ic2ExpReactorPlanner.TestSupport.place;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import Ic2ExpReactorPlanner.components.Condensator;
import Ic2ExpReactorPlanner.components.CoolantCell;
import Ic2ExpReactorPlanner.components.FuelRod;
import Ic2ExpReactorPlanner.components.Plating;
import Ic2ExpReactorPlanner.components.ReactorItem;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/** The shared {@link ReactorItem} behaviour that every component type inherits. */
class ReactorItemTest {

    @BeforeEach
    @AfterEach
    void resetGlobals() {
        TestSupport.resetGlobalConfig();
    }

    // ================================================================== default settings

    @Nested
    @DisplayName("automation defaults")
    class Defaults {

        @Test
        @DisplayName("a heat-holding component defaults its threshold to 90% of capacity")
        void heatThresholdIsNinetyPercent() {
            // coolantCell60k holds 60 000, so 0.9 * 60 000 = 54 000.
            ReactorItem cell = ComponentFactory.createComponent("coolantCell60k");
            assertEquals(54000, cell.getAutomationThreshold(), "coolantCell60k");
            assertEquals((int) (cell.getMaxHeat() * 0.9), cell.getAutomationThreshold(), "exactly 90%");
        }

        @Test
        @DisplayName("a damage-only component defaults its threshold to 110% of durability")
        void damageThresholdIsOneHundredTenPercent() {
            // fuelRodUranium has maxHeat 1, so the damage rule applies: 1.1 * 20 000 = 22 000.
            ReactorItem rod = ComponentFactory.createComponent("fuelRodUranium");
            assertEquals(1.0, rod.getMaxHeat(), 1e-9, "rods do not hold heat");
            assertEquals(22000, rod.getAutomationThreshold(), "20 000 x 1.1");
        }

        @Test
        @DisplayName("a component that neither holds heat nor takes damage keeps the 9 000 default")
        void inertComponentKeepsTheDefault() {
            ReactorItem plating = ComponentFactory.createComponent("reactorPlating");
            assertEquals(1.0, plating.getMaxHeat(), 1e-9, "maxHeat 1");
            assertEquals(1.0, plating.getMaxDamage(), 1e-9, "maxDamage 1");
            assertEquals(9000, plating.getAutomationThreshold(), "the plain default");
        }

        @Test
        @DisplayName("the reactor pause starts at zero")
        void pauseStartsAtZero() {
            assertEquals(0, ComponentFactory.createComponent("fuelRodUranium").getReactorPause());
            assertEquals(0, ComponentFactory.createComponent("coolantCell60k").getReactorPause());
        }

        @Test
        @DisplayName("the initial heat starts at zero")
        void initialHeatStartsAtZero() {
            assertEquals(0.0, ComponentFactory.createComponent("coolantCell60k").getInitialHeat(), 1e-9);
        }
    }

    // ================================================================== setters

    @Nested
    @DisplayName("settings are guarded by what the component can physically do")
    class Guards {

        @Test
        @DisplayName("only heat holders can take an initial heat")
        void initialHeatRequiresAHeatHolder() {
            Reactor reactor = new Reactor();
            CoolantCell cell = (CoolantCell) place(reactor, 2, 2, "coolantCell60k");
            cell.setInitialHeat(1000);
            assertClose(1000, cell.getInitialHeat(), 1e-9, "a coolant cell accepts heat");

            ReactorItem rod = place(reactor, 2, 3, "fuelRodUranium");
            rod.setInitialHeat(500);
            assertClose(0.0, rod.getInitialHeat(), 1e-9, "a fuel rod does not hold heat");
        }

        @Test
        @DisplayName("an initial heat at or above capacity is refused outright, not clamped")
        void initialHeatIsRefusedNotClamped() {
            Reactor reactor = new Reactor();
            ReactorItem cell = place(reactor, 2, 2, "coolantCell60k");
            cell.setInitialHeat(1000);
            cell.setInitialHeat(cell.getMaxHeat()); // == capacity
            assertClose(1000, cell.getInitialHeat(), 1e-9, "silently ignored, the old value survives");
            cell.setInitialHeat(cell.getMaxHeat() - 1);
            assertClose(59999, cell.getInitialHeat(), 1e-9, "just under capacity is accepted");
        }

        @Test
        @DisplayName("a broken component refuses an initial heat")
        void brokenComponentRefusesInitialHeat() {
            Reactor reactor = new Reactor();
            ReactorItem cell = place(reactor, 2, 2, "coolantCell10k");
            cell.adjustCurrentHeat(cell.getMaxHeat()); // break it
            assertTrue(cell.isBroken(), "precondition");
            cell.setInitialHeat(500);
            assertClose(0.0, cell.getInitialHeat(), 1e-9, "isHeatAcceptor() is false once broken");
        }

        @ParameterizedTest(name = "{0} accepts a threshold and a pause")
        @ValueSource(
                strings = {
                    "fuelRodUranium",
                    "neutronReflector",
                    "coolantCell60k",
                    "heatVent",
                    "rshCondensator",
                    "reactorPlating",
                    "iridiumNeutronReflector",
                })
        @DisplayName("threshold and pause are settable on anything that can hold heat or take damage")
        void settingsAreAccepted(String baseName) {
            ReactorItem item = ComponentFactory.createComponent(baseName);
            int before = item.getAutomationThreshold();
            item.setAutomationThreshold(12345);
            item.setReactorPause(67);
            if (item.getMaxHeat() > 1 || item.getMaxDamage() > 1) {
                assertEquals(12345, item.getAutomationThreshold(), baseName + " threshold");
                assertEquals(67, item.getReactorPause(), baseName + " pause");
            } else {
                assertEquals(before, item.getAutomationThreshold(), baseName + " is inert");
                assertEquals(0, item.getReactorPause(), baseName + " is inert");
            }
        }
    }

    // ================================================================== heat clamping

    @Nested
    @DisplayName("adjustCurrentHeat")
    class AdjustCurrentHeat {

        @Test
        @DisplayName("heat is clamped to [0, maxHeat]")
        void clampsToTheCapacityRange() {
            Reactor reactor = new Reactor();
            ReactorItem cell = place(reactor, 2, 2, "coolantCell60k");

            assertClose(0, cell.adjustCurrentHeat(1000), 1e-9, "nothing refused");
            assertClose(1000, cell.getCurrentHeat(), 1e-9);

            // Overfill is reported as a negative return, and the amount is exact: tempHeat =
            // 1 000 + 100 000 = 101 000 against a 60 000 capacity accepts 59 000 and refuses 41 000,
            // so the return is 60 000 - 101 000 = -41 000 (CODE_REVIEW.md P3-15; the old "+ 1"
            // reported an overflow of N as -(N - 1)).
            assertClose(-41000, cell.adjustCurrentHeat(100000), 1e-9, "capacity is reported as a refusal");
            assertClose(60000, cell.getCurrentHeat(), 1e-9, "clamped at the top");
        }

        /**
         * A component at or above its capacity is <i>broken</i>, which makes {@code isHeatAcceptor()}
         * false, which turns {@code adjustCurrentHeat} into a pass-through that returns the
         * adjustment untouched instead of clamping it. That is deliberate, not an accident of the
         * guard: broken means "accepts nothing", and a coolant cell that reaches capacity is broken
         * in game and cannot be drained by cooling it. Relaxing the guard to {@code maxHeat > 1}
         * would let the simulation drain a full cell and would report an overheating design as safe
         * (4 of 304 corpus designs stop exploding), so this test is the thing that keeps it honest.
         * See CODE_REVIEW.md P3-16.
         */
        @Test
        @DisplayName("a full (broken) component passes adjustments straight through")
        void brokenComponentPassesAdjustmentsThrough() {
            Reactor reactor = new Reactor();
            ReactorItem cell = place(reactor, 2, 2, "coolantCell60k");
            cell.adjustCurrentHeat(cell.getMaxHeat());
            assertTrue(cell.isBroken(), "at capacity");
            assertFalse(cell.isHeatAcceptor(), "so it accepts nothing");
            assertClose(-61000, cell.adjustCurrentHeat(-61000), 1e-9, "the whole adjustment comes back out");
            assertClose(60000, cell.getCurrentHeat(), 1e-9, "and the stored heat does not move");
        }

        @Test
        @DisplayName("underflow is refused exactly and clamps at zero")
        void underflowIsRefused() {
            Reactor reactor = new Reactor();
            ReactorItem cell = place(reactor, 2, 2, "coolantCell60k");
            cell.adjustCurrentHeat(500);
            // tempHeat = 500 - 1 000 = -500, and the whole -500 is returned as refused
            assertClose(-500, cell.adjustCurrentHeat(-1000), 1e-9, "underflow is reported as a refusal");
            assertClose(0, cell.getCurrentHeat(), 1e-9, "clamped at the bottom, never below");
        }

        @Test
        @DisplayName("maxReachedHeat is a high-water mark that cooling cannot undo")
        void maxReachedHeatIsMonotonic() {
            Reactor reactor = new Reactor();
            ReactorItem cell = place(reactor, 2, 2, "coolantCell60k");
            cell.adjustCurrentHeat(40000);
            assertClose(40000, cell.getMaxReachedHeat(), 1e-9);
            cell.adjustCurrentHeat(-40000);
            assertClose(0, cell.getCurrentHeat(), 1e-9, "cooled");
            assertClose(40000, cell.getMaxReachedHeat(), 1e-9, "but the peak is remembered");
        }

        @Test
        @DisplayName("a component that cannot hold heat returns the adjustment untouched")
        void inertComponentPassesHeatThrough() {
            Reactor reactor = new Reactor();
            ReactorItem plating = place(reactor, 2, 2, "reactorPlating");
            assertClose(500, plating.adjustCurrentHeat(500), 1e-9, "all of it refused");
            assertClose(0, plating.getCurrentHeat(), 1e-9, "and none stored");
        }

        @Test
        @DisplayName("clearCurrentHeat restores the initial heat and wipes the statistics")
        void clearCurrentHeatResetsEverything() {
            Reactor reactor = new Reactor();
            ReactorItem cell = place(reactor, 2, 2, "coolantCell60k");
            cell.setInitialHeat(500);
            cell.adjustCurrentHeat(30000);
            cell.preReactorTick();
            cell.adjustCurrentHeat(1000);

            cell.clearCurrentHeat();
            assertClose(500, cell.getCurrentHeat(), 1e-9, "back to the initial heat");
            assertClose(500, cell.getMaxReachedHeat(), 1e-9, "and the peak is the initial heat too");
            // The minimums reset to Double.MAX_VALUE, not to zero, so that the next real value
            // automatically becomes the new minimum.
            assertEquals(Double.MAX_VALUE, cell.getMinEUGenerated(), 1e-9, "EU minimum is re-armed");
            assertEquals(Double.MAX_VALUE, cell.getMinHeatGenerated(), 1e-9, "heat minimum is re-armed");
            assertEquals(0.0, cell.getMaxEUGenerated(), 1e-9, "maximums reset to zero");
            assertEquals(0.0, cell.getMaxHeatGenerated(), 1e-9);
            assertEquals(0.0, cell.getBestVentCooling(), 1e-9);
            assertEquals(0.0, cell.getBestCellCooling(), 1e-9);
            assertEquals(0.0, cell.getBestCondensatorCooling(), 1e-9);
        }

        @Test
        @DisplayName("clearDamage wipes damage but leaves heat alone")
        void clearDamageOnlyResetsDamage() {
            Reactor reactor = new Reactor();
            ReactorItem rod = place(reactor, 2, 2, "fuelRodUranium");
            rod.applyDamage(5000);
            rod.adjustCurrentHeat(0);
            rod.clearDamage();
            assertEquals(0.0, rod.getCurrentDamage(), 1e-9);
        }
    }

    // ================================================================== classification

    @Nested
    @DisplayName("classification")
    class Classification {

        @Test
        @DisplayName("isHeatAcceptor requires capacity and an unbroken component")
        void heatAcceptor() {
            Reactor reactor = new Reactor();
            ReactorItem cell = place(reactor, 2, 2, "coolantCell60k");
            assertTrue(cell.isHeatAcceptor(), "a cool coolant cell accepts heat");
            cell.adjustCurrentHeat(cell.getMaxHeat());
            assertFalse(cell.isHeatAcceptor(), "a broken one does not");
        }

        @Test
        @DisplayName("isCoolable excludes condensators")
        void coolable() {
            Reactor reactor = new Reactor();
            assertTrue(place(reactor, 2, 2, "coolantCell60k").isCoolable(), "a coolant cell is coolable");
            assertFalse(place(reactor, 2, 3, "rshCondensator").isCoolable(), "a condensator is not");
            assertFalse(place(reactor, 2, 4, "reactorPlating").isCoolable(), "nor is plating");
        }

        @Test
        @DisplayName("isBroken is true at maxHeat or at maxDamage")
        void isBroken() {
            Reactor reactor = new Reactor();
            ReactorItem cell = place(reactor, 2, 2, "coolantCell10k");
            assertFalse(cell.isBroken(), "fresh");
            cell.adjustCurrentHeat(9999);
            assertFalse(cell.isBroken(), "one short");
            cell.adjustCurrentHeat(1);
            assertTrue(cell.isBroken(), "exactly at capacity");

            ReactorItem rod = place(reactor, 2, 3, "fuelRodUranium");
            rod.applyDamage(19999);
            assertFalse(rod.isBroken(), "one short of maxDamage");
            rod.applyDamage(1);
            assertTrue(rod.isBroken(), "exactly at maxDamage");
        }

        @Test
        @DisplayName("applyDamage is ignored by components with maxDamage 1")
        void applyDamageIsGuarded() {
            Reactor reactor = new Reactor();
            ReactorItem plating = place(reactor, 2, 2, "reactorPlating");
            plating.applyDamage(999999);
            assertEquals(0.0, plating.getCurrentDamage(), 1e-9, "maxDamage 1 means immune");
        }

        @Test
        @DisplayName("isNeutronReflector is false for everything except rods and reflectors")
        void neutronReflector() {
            Reactor reactor = new Reactor();
            assertFalse(place(reactor, 2, 2, "reactorPlating").isNeutronReflector(), "plating");
            assertFalse(place(reactor, 2, 3, "coolantCell60k").isNeutronReflector(), "coolant cell");
            assertFalse(place(reactor, 2, 4, "heatVent").isNeutronReflector(), "vent");
            assertTrue(place(reactor, 2, 5, "neutronReflector").isNeutronReflector(), "reflector");
            assertTrue(place(reactor, 2, 6, "fuelRodUranium").isNeutronReflector(), "fuel rod");
        }
    }

    // ================================================================== explosion contribution

    @Nested
    @DisplayName("explosion power contribution")
    class ExplosionContribution {

        @Test
        @DisplayName("a fuel rod contributes 2 per rod")
        void rodOffset() {
            Reactor reactor = new Reactor();
            assertEquals(2, place(reactor, 2, 2, "fuelRodUranium").getExplosionPowerOffset(), 1e-9, "single");
            assertEquals(
                    4, place(reactor, 2, 3, "dualFuelRodUranium").getExplosionPowerOffset(), 1e-9, "dual");
            assertEquals(
                    8, place(reactor, 2, 4, "quadFuelRodUranium").getExplosionPowerOffset(), 1e-9, "quad");
        }

        @Test
        @DisplayName("a reflector subtracts 1")
        void reflectorOffset() {
            Reactor reactor = new Reactor();
            assertEquals(
                    -1, place(reactor, 2, 2, "neutronReflector").getExplosionPowerOffset(), 1e-9, "reflector");
        }

        @Test
        @DisplayName("everything else contributes nothing")
        void otherOffsets() {
            Reactor reactor = new Reactor();
            for (String name :
                    new String[] {"reactorPlating", "coolantCell60k", "heatVent", "rshCondensator", "fuelRodGlowstone"}) {
                assertEquals(0, place(reactor, 2, 2, name).getExplosionPowerOffset(), 1e-9, name);
            }
        }

        @Test
        @DisplayName("a broken component stops contributing")
        void brokenStopsContributing() {
            Reactor reactor = new Reactor();
            ReactorItem rod = place(reactor, 2, 2, "quadFuelRodUranium");
            assertEquals(8, rod.getExplosionPowerOffset(), 1e-9, "intact");
            rod.applyDamage(20000);
            assertEquals(0, rod.getExplosionPowerOffset(), 1e-9, "broken");
        }

        @Test
        @DisplayName("only plating has a multiplier, and it is below 1")
        void multipliers() {
            Reactor reactor = new Reactor();
            assertEquals(
                    1.0, place(reactor, 2, 2, "fuelRodUranium").getExplosionPowerMultiplier(), 1e-9, "rods: 1");
            assertEquals(
                    1.0, place(reactor, 2, 3, "coolantCell60k").getExplosionPowerMultiplier(), 1e-9, "cells: 1");
            Plating plating = (Plating) place(reactor, 2, 4, "reactorPlating");
            assertEquals(0.9025, plating.getExplosionPowerMultiplier(), 1e-9, "reactor plating");
        }

        @ParameterizedTest(name = "{0} contributes a multiplier of {1}")
        @CsvSource({
            "reactorPlating, 0.9025",
            "heatCapacityReactorPlating, 0.9801",
            "containmentReactorPlating, 0.81",
        })
        @DisplayName("plating multipliers")
        void platingMultipliers(String baseName, double expected) {
            ReactorItem plating = ComponentFactory.createComponent(baseName);
            assertClose(expected, plating.getExplosionPowerMultiplier(), 1e-9, baseName);
        }
    }

    // ================================================================== per-tick state

    @Nested
    @DisplayName("preReactorTick")
    class PreReactorTick {

        @Test
        @DisplayName("resets the per-tick counters but keeps the accumulated peaks")
        void resetsPerTickCounters() {
            Reactor reactor = new Reactor();
            ReactorItem cell = place(reactor, 2, 2, "coolantCell60k");
            // currentCellCooling accumulates within a tick, so two packets sum to 6 000.
            cell.adjustCurrentHeat(5000);
            cell.adjustCurrentHeat(1000);
            assertClose(6000, cell.getCurrentCellCooling(), 1e-9, "precondition");

            cell.preReactorTick();
            assertClose(0, cell.getCurrentHullHeating(), 1e-9);
            assertClose(0, cell.getCurrentComponentHeating(), 1e-9);
            assertClose(0, cell.getCurrentHullCooling(), 1e-9);
            assertClose(0, cell.getCurrentVentCooling(), 1e-9);
            assertClose(0, cell.getCurrentCellCooling(), 1e-9);
            assertClose(0, cell.getCurrentCondensatorCooling(), 1e-9);
            assertClose(0, cell.getCurrentEUGenerated(), 1e-9);
            assertClose(0, cell.getCurrentHeatGenerated(), 1e-9);
            // but the peak survives
            assertClose(6000, cell.getBestCellCooling(), 1e-9, "the peak is not a per-tick value");
        }

        @Test
        @DisplayName("does not touch heat, damage or min/max output")
        void leavesPersistentState() {
            Reactor reactor = new Reactor();
            ReactorItem rod = place(reactor, 2, 2, "fuelRodUranium");
            rod.adjustCurrentHeat(0);
            rod.generateEnergy();
            rod.preReactorTick();
            assertTrue(rod.getCurrentDamage() > 0, "damage survives the tick boundary");
            assertTrue(rod.getMaxEUGenerated() > 0, "and so does the EU peak");
        }
    }

    // ================================================================== defaults of the hooks

    @Nested
    @DisplayName("default no-op behaviour")
    class DefaultHooks {

        /**
         * A component that overrides nothing must behave inertly, which is what makes it safe for
         * the simulator to call every hook on every component unconditionally.
         */
        @Test
        @DisplayName("an unoverridden component generates nothing and does nothing")
        void unoverriddenComponentIsInert() {
            Reactor reactor = new Reactor();
            Plating plating = (Plating) place(reactor, 2, 2, "reactorPlating");

            plating.preReactorTick();
            assertClose(0, plating.generateHeat(), 1e-9, "no heat");
            assertClose(0, plating.generateEnergy(), 1e-9, "no energy");
            assertClose(0, plating.dissipate(), 1e-9, "no dissipation");
            plating.transfer(); // must not throw
            assertClose(0, plating.getCurrentHeat(), 1e-9);
        }

        @Test
        @DisplayName("getCurrentOutput and getRodCount default to zero")
        void defaultOutputs() {
            ReactorItem plating = ComponentFactory.createComponent("reactorPlating");
            assertEquals(0, plating.getRodCount(), "not a rod");
            assertEquals(0.0, plating.getCurrentOutput(), 1e-9, "no output");
            assertFalse(plating.needsCoolantInjected(), "not a condensator");
            plating.injectCoolant(); // must not throw
            assertClose(0.0, plating.getCurrentHeat(), 1e-9, "and must not change heat");
        }
    }

    @Test
    @DisplayName("the info buffer survives being appended to from two threads")
    void infoBufferIsSynchronised() throws Exception {
        // ReactorItem documents that info is a StringBuffer precisely because both the simulation
        // thread and the event dispatch thread touch it.
        final ReactorItem cell = ComponentFactory.createComponent("coolantCell60k");
        final int writers = 4;
        final int writesPerThread = 2000;
        Thread[] threads = new Thread[writers];
        for (int i = 0; i < writers; i++) {
            threads[i] = new Thread(new Runnable() {
                @Override
                public void run() {
                    for (int j = 0; j < writesPerThread; j++) {
                        cell.info.append("x");
                    }
                }
            });
            threads[i].start();
        }
        for (Thread thread : threads) {
            thread.join();
        }
        assertEquals(writers * writesPerThread, cell.info.length(), "no appends were lost");
    }

    @Test
    @DisplayName("a condensator is a heat acceptor but reports zero rod count")
    void condensatorShape() {
        Condensator condensator = (Condensator) ComponentFactory.createComponent("rshCondensator");
        assertTrue(condensator.isHeatAcceptor(), "accepts heat");
        assertEquals(0, condensator.getRodCount(), "no rods");
        assertEquals(0.0, condensator.getExplosionPowerOffset(), 1e-9, "no explosion contribution");
        assertEquals(1.0, condensator.getExplosionPowerMultiplier(), 1e-9, "no multiplier");
    }

    @Test
    @DisplayName("a fuel rod is a heat acceptor only while it has no heat capacity")
    void fuelRodShape() {
        FuelRod rod = (FuelRod) ComponentFactory.createComponent("fuelRodUranium");
        assertFalse(rod.isHeatAcceptor(), "maxHeat 1");
        assertTrue(rod.isNeutronReflector(), "but it does reflect");
        assertEquals(0.0, rod.getVentCoolingCapacity(), 1e-9, "and it cannot cool anything");
        assertEquals(0.0, rod.getHullCoolingCapacity(), 1e-9);
    }
}