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

/** Coolant cells, neutron reflectors, breeder cells, plating and the GoodGenerator fuel rods. */
class PassiveComponentsTest {

    @BeforeEach
    @AfterEach
    void resetGlobals() {
        TestSupport.resetGlobalConfig();
    }

    // ================================================================== coolant cells

    @Nested
    @DisplayName("coolant cells")
    class CoolantCells {

        @ParameterizedTest(name = "{0} stores up to its rated capacity")
        @CsvSource({
            "coolantCell10k, 10000",
            "coolantCell30k, 30000",
            "coolantCell60k, 60000",
            "coolantCellHelium60k, 60000",
            "coolantCellHelium180k, 180000",
            "coolantCellHelium360k, 360000",
            "coolantCellNak60k, 60000",
            "coolantCellNak180k, 180000",
            "coolantCellNak360k, 360000",
        })
        @DisplayName("capacity")
        void capacity(String name, double expected) {
            assertClose(expected, ComponentFactory.createComponent(name).getMaxHeat(), 1e-9, name);
        }

        @Test
        @DisplayName("a coolant cell absorbs heat up to capacity")
        void absorbsUpToCapacity() {
            Reactor reactor = new Reactor();
            CoolantCell cell = (CoolantCell) place(reactor, 2, 2, "coolantCell60k");
            assertClose(0, cell.adjustCurrentHeat(50000), 1e-9, "all accepted");
            assertClose(50000, cell.getCurrentHeat(), 1e-9, "stored");
            assertClose(0, cell.adjustCurrentHeat(10000), 1e-9, "the last 10 000 still fit exactly");
            assertClose(60000, cell.getCurrentHeat(), 1e-9, "at capacity, never above");
            assertTrue(cell.isBroken(), "a full cell is broken");
        }

        /**
         * {@code adjustCurrentHeat} reports refusal as a <i>negative</i> return:
         * {@code result = maxHeat - tempHeat + 1}. Overfilling a 60k cell by 20 000 therefore
         * returns -9 999, and callers such as {@code FuelRod.handleHeat} read that as "9 999
         * refused" and push the remainder elsewhere.
         */
        @Test
        @DisplayName("overfilling reports the refusal as a negative return")
        void overfillReportsNegativeRefusal() {
            Reactor reactor = new Reactor();
            CoolantCell cell = (CoolantCell) place(reactor, 2, 2, "coolantCell60k");
            assertClose(0, cell.adjustCurrentHeat(50000), 1e-9, "all accepted");
            // 50 000 + 20 000 = 70 000, so 60 000 - 70 000 + 1 = -9 999 was refused
            assertClose(-9999, cell.adjustCurrentHeat(20000), 1e-9, "9 999 refused");
            assertClose(60000, cell.getCurrentHeat(), 1e-9, "clamped to capacity, never above");
        }

        @Test
        @DisplayName("cooling a cell succeeds silently; over-cooling is refused")
        void coolingSemantics() {
            Reactor reactor = new Reactor();
            CoolantCell cell = (CoolantCell) place(reactor, 2, 2, "coolantCell60k");
            cell.adjustCurrentHeat(1000);
            assertClose(0, cell.adjustCurrentHeat(-500), 1e-9, "cooling within capacity refuses nothing");
            assertClose(500, cell.getCurrentHeat(), 1e-9, "and really was cooled");

            cell.adjustCurrentHeat(-100); // now 400
            // tempHeat = 400 - 500 = -100, so the whole -100 is reported as refused
            assertClose(-100, cell.adjustCurrentHeat(-500), 1e-9, "the 100 that was there, and no more");
            assertClose(0, cell.getCurrentHeat(), 1e-9, "clamped at zero, never below");
        }

        @Test
        @DisplayName("is a heat acceptor, is coolable, and never takes damage")
        void classification() {
            Reactor reactor = new Reactor();
            CoolantCell cell = (CoolantCell) place(reactor, 2, 2, "coolantCell60k");
            assertTrue(cell.isHeatAcceptor(), "absorbs heat from rods");
            assertTrue(cell.isCoolable(), "component heat vents can cool it");
            assertFalse(cell.isNeutronReflector(), "does not reflect");
            cell.applyDamage(10000);
            assertClose(0, cell.getCurrentDamage(), 1e-9, "maxDamage 1 means immune to damage");
        }

        /**
         * CODE_REVIEW.md P3-6: {@code currentCellCooling} accumulates negative heat too, unlike
         * {@link Condensator} which early-returns. Only the peak is ever reported, and the peak is
         * maintained with {@code Math.max}, so this is invisible in the UI -- but it is a real
         * asymmetry between the two cell types.
         */
        @Test
        @DisplayName("currentCellCooling is decremented by cooling, though the peak is not")
        void currentCellCoolingIsNotSignGuarded() {
            Reactor reactor = new Reactor();
            CoolantCell cell = (CoolantCell) place(reactor, 2, 2, "coolantCell60k");
            cell.preReactorTick();
            cell.adjustCurrentHeat(500);
            assertClose(500, cell.getCurrentCellCooling(), 1e-9, "absorbed 500");
            assertClose(500, cell.getBestCellCooling(), 1e-9, "peak 500");

            cell.adjustCurrentHeat(-200);
            assertClose(300, cell.getCurrentCellCooling(), 1e-9, "current drops with cooling");
            assertClose(500, cell.getBestCellCooling(), 1e-9, "peak is unaffected, which is what gets reported");
        }

        @Test
        @DisplayName("every coolant cell in the factory has a positive, tooltip-able capacity")
        void everyCellIsSane() {
            for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
                ReactorItem item = ComponentFactory.createComponent(id);
                if (!(item instanceof CoolantCell)) {
                    continue;
                }
                assertTrue(item.getMaxHeat() > 1, item.baseName + " should hold heat");
                assertEquals(1, item.formatTooltip().length, item.baseName + " tooltip");
            }
        }
    }

    // ================================================================== neutron reflectors

    @Nested
    @DisplayName("neutron reflectors")
    class Reflectors {

        @Test
        @DisplayName("takes 1 damage per adjacent fuel rod, scaled by that rod's rod count")
        void damageFromAdjacentRods() {
            Reactor reactor = new Reactor();
            Reflector reflector = (Reflector) place(reactor, 2, 2, "neutronReflector");
            place(reactor, 2, 1, "fuelRodUranium"); // rodCount 1
            place(reactor, 2, 3, "quadFuelRodUranium"); // rodCount 4
            place(reactor, 1, 2, "dualFuelRodUranium"); // rodCount 2
            reactor.setComponentAt(3, 2, ComponentFactory.createComponent("coolantCell60k")); // 0 rods

            assertClose(0, reflector.generateHeat(), 1e-9, "reflectors generate no heat");
            // 1 + 4 + 2 + 0 = 7
            assertClose(7, reflector.getCurrentDamage(), 1e-9, "damage from the three rods");
        }

        @Test
        @DisplayName("MC 1.7.10 divides reflector durability by three")
        void mcVersionScaling() {
            Reflector reflector;
            reflector = (Reflector) ComponentFactory.createComponent("neutronReflector");
            assertClose(30000, reflector.getMaxDamage(), 1e-9, "1.12.2 durability");

            Reflector.setMcVersion("1.7.10");
            assertClose(10000, reflector.getMaxDamage(), 1e-9, "1.7.10 durability is a third");

            Reflector.setMcVersion("1.12.2");
            assertClose(30000, reflector.getMaxDamage(), 1e-9, "and it goes back");
        }

        @Test
        @DisplayName("the iridium reflector is indestructible and keeps maxDamage 1 under 1.7.10")
        void iridiumIsIndestructible() {
            Reflector.setMcVersion("1.7.10");
            Reflector iridium = (Reflector) ComponentFactory.createComponent("iridiumNeutronReflector");
            assertClose(1, iridium.getMaxDamage(), 1e-9, "maxDamage 1 is not divided");
            iridium.applyDamage(100000);
            assertClose(0, iridium.getCurrentDamage(), 1e-9, "immune to damage");
            assertTrue(iridium.isNeutronReflector(), "and reflects forever");
        }

        @Test
        @DisplayName("a reflector counts as a -1 explosion power offset while intact")
        void explosionPowerOffset() {
            Reactor reactor = new Reactor();
            Reflector reflector = (Reflector) place(reactor, 2, 2, "neutronReflector");
            assertClose(-1, reflector.getExplosionPowerOffset(), 1e-9, "intact reflector");
            reflector.applyDamage(30000);
            assertTrue(reflector.isBroken(), "broken");
            assertClose(0, reflector.getExplosionPowerOffset(), 1e-9, "broken reflector contributes nothing");
        }
    }

    // ================================================================== breeder cell

    @Nested
    @DisplayName("breeder cell (fuelRodGlowstone)")
    class BreederCells {

        @Test
        @DisplayName("damage per tick is 1 + reactorHeat / 3000, scaled by adjacent rod counts")
        void damageScalesWithReactorHeatAndRodCount() {
            Reactor reactor = new Reactor();
            BreederCell breeder = (BreederCell) place(reactor, 2, 2, "fuelRodGlowstone");
            place(reactor, 2, 1, "fuelRodUranium"); // rodCount 1
            place(reactor, 2, 3, "fuelRodUranium"); // rodCount 1

            reactor.setCurrentHeat(0);
            breeder.generateHeat();
            // targetDamage = 1 + 0/3000 = 1, applied once per adjacent rod
            assertClose(2, breeder.getCurrentDamage(), 1e-9, "two single rods -> 2 damage");

            breeder.clearDamage();
            reactor.setCurrentHeat(3000);
            breeder.generateHeat();
            // targetDamage = 1 + 3000/3000 = 2, twice
            assertClose(4, breeder.getCurrentDamage(), 1e-9, "at 3 000 heat the rate doubles");

            breeder.clearDamage();
            reactor.setCurrentHeat(9000);
            breeder.generateHeat();
            // targetDamage = 1 + 9000/3000 = 4, twice
            assertClose(8, breeder.getCurrentDamage(), 1e-9, "at 9 000 heat the rate is 4 per rod");
        }

        @Test
        @DisplayName("a quad rod counts four times")
        void quadRodCountsFourTimes() {
            Reactor reactor = new Reactor();
            BreederCell breeder = (BreederCell) place(reactor, 2, 2, "fuelRodGlowstone");
            place(reactor, 2, 1, "quadFuelRodUranium");
            reactor.setCurrentHeat(0);
            breeder.generateHeat();
            assertClose(4, breeder.getCurrentDamage(), 1e-9, "one quad rod -> 4 damage");
        }

        @Test
        @DisplayName("breaks at 10 000 damage and generates no heat")
        void breaksAtTenThousand() {
            Reactor reactor = new Reactor();
            BreederCell breeder = (BreederCell) place(reactor, 2, 2, "fuelRodGlowstone");
            place(reactor, 2, 1, "quadFuelRodUranium");
            reactor.setCurrentHeat(9000);
            // targetDamage = 1 + 9000/3000 = 4, applied once per rod in the quad -> 16 per tick
            for (int i = 0; i < 624; i++) {
                breeder.generateHeat();
            }
            assertClose(624 * 16, breeder.getCurrentDamage(), 1e-9, "just short of the limit");
            assertFalse(breeder.isBroken(), "still alive at 9 984");

            breeder.generateHeat();
            assertClose(10000, breeder.getCurrentDamage(), 1e-9, "exactly 10 000");
            assertTrue(breeder.isBroken(), "broken");
            assertClose(0, breeder.getMaxHeatGenerated(), 1e-9, "breeder cells never report generated heat");
        }

        @Test
        @DisplayName("is not a heat acceptor: maxHeat 1")
        void notAHeatAcceptor() {
            Reactor reactor = new Reactor();
            BreederCell breeder = (BreederCell) place(reactor, 2, 2, "fuelRodGlowstone");
            assertFalse(breeder.isHeatAcceptor(), "cannot be heated");
            assertFalse(breeder.isCoolable(), "cannot be cooled");
            assertEquals(0, breeder.getRodCount(), "not a fuel rod");
            assertEquals(0, breeder.getExplosionPowerOffset(), 1e-9, "no explosion contribution");
        }
    }

    // ================================================================== plating

    @Nested
    @DisplayName("reactor plating")
    class Platings {

        @ParameterizedTest(name = "{0} adds {1} to the reactor's maximum heat")
        @CsvSource({
            "reactorPlating, 1000",
            "heatCapacityReactorPlating, 1700",
            "containmentReactorPlating, 500",
        })
        @DisplayName("raises the reactor's maximum heat while placed")
        void raisesMaxHeat(String name, double expected) {
            Reactor reactor = new Reactor();
            assertClose(10000, reactor.getMaxHeat(), 1e-9, "bare reactor");
            place(reactor, 2, 2, name);
            assertClose(10000 + expected, reactor.getMaxHeat(), 1e-9, name);
        }

        @ParameterizedTest(name = "{0} reduces explosion power by {1}")
        @CsvSource({
            "reactorPlating, 0.9025",
            "heatCapacityReactorPlating, 0.9801",
            "containmentReactorPlating, 0.81",
        })
        @DisplayName("multiplies explosion power down")
        void explosionMultiplier(String name, double expected) {
            Reactor reactor = new Reactor();
            Plating plating = (Plating) place(reactor, 2, 2, name);
            assertClose(expected, plating.getExplosionPowerMultiplier(), 1e-9, name);
        }

        @Test
        @DisplayName("removing the plating gives the heat back")
        void removingGivesHeatBack() {
            Reactor reactor = new Reactor();
            place(reactor, 2, 2, "heatCapacityReactorPlating");
            assertClose(11700, reactor.getMaxHeat(), 1e-9, "raised");
            reactor.setComponentAt(2, 2, null);
            assertClose(10000, reactor.getMaxHeat(), 1e-9, "restored");
        }

        @Test
        @DisplayName("clearGrid restores the base 10 000 exactly, with no accumulated drift")
        void clearGridDoesNotLeak() {
            Reactor reactor = new Reactor();
            for (int[] cell : TestSupport.CELLS) {
                place(reactor, cell[0], cell[1], "heatCapacityReactorPlating");
            }
            assertClose(10000 + 54 * 1700, reactor.getMaxHeat(), 1e-9, "fully plated");
            reactor.clearGrid();
            assertClose(10000, reactor.getMaxHeat(), 1e-9, "back to bare");
        }

        @Test
        @DisplayName("placing the same Plating instance in two cells still counts it once")
        void sameInstanceIsNotDoubleCounted() {
            Reactor reactor = new Reactor();
            Plating plating = (Plating) ComponentFactory.createComponent("heatCapacityReactorPlating");
            reactor.setComponentAt(0, 0, plating);
            assertClose(11700, reactor.getMaxHeat(), 1e-9, "one plating");
            reactor.setComponentAt(1, 1, plating); // same instance, second cell
            assertClose(11700, reactor.getMaxHeat(), 1e-9, "still counted once");
        }

        @Test
        @DisplayName("moving a plating between cells does not double-count")
        void movingPlatingDoesNotDoubleCount() {
            Reactor reactor = new Reactor();
            Plating plating = (Plating) place(reactor, 0, 0, "reactorPlating");
            assertClose(11000, reactor.getMaxHeat(), 1e-9, "raised");
            reactor.setComponentAt(5, 8, plating);
            assertClose(11000, reactor.getMaxHeat(), 1e-9, "moved, still once");
            assertClose(5, platingRow(plating), "row is updated to the new position");
        }

        /** row/col are protected on ReactorItem; this reads them from the same package. */
        private int platingRow(Plating plating) {
            return plating.row;
        }

        @Test
        @DisplayName("54 heat-capacity platings reach 101 800, below the 120 000 code limit")
        void maximumReachableMaxHeat() {
            Reactor reactor = new Reactor();
            for (int[] cell : TestSupport.CELLS) {
                place(reactor, cell[0], cell[1], "heatCapacityReactorPlating");
            }
            assertClose(101800, reactor.getMaxHeat(), 1e-9, "fully plated");
            assertTrue(
                    reactor.getMaxHeat() - 1 < 120000,
                    "the heat spinner stays under the reactor-code storage bound");
        }
    }

    // ================================================================== GoodGenerator rods

    @Nested
    @DisplayName("GoodGenerator fuel rods")
    class GGFuelRods {

        /**
         * {@code GGFuelRod.getHeatBonus()} returns a per-rod value that is only consulted for
         * mox rods, so the non-mox variants all carry 0. Mox variants carry 6 (compressed
         * plutonium) or 2 (liquid plutonium).
         */
        @ParameterizedTest(name = "{0} heat bonus is {1}")
        @CsvSource({
            "fuelRodCompressedUranium, 0",
            "dualFuelRodCompressedUranium, 0",
            "quadFuelRodCompressedUranium, 0",
            "fuelRodLiquidUranium, 0",
            "fuelRodCompressedPlutonium, 6",
            "quadFuelRodCompressedPlutonium, 6",
            "fuelRodLiquidPlutonium, 2",
            "quadFuelRodLiquidPlutonium, 2",
        })
        @DisplayName("each GG rod carries its own mox heat bonus")
        void perRodHeatBonus(String name, double expected) {
            FuelRod gg = (FuelRod) ComponentFactory.createComponent(name);
            assertTrue(gg instanceof GGFuelRod, name + " should be a GGFuelRod");
            assertClose(expected, gg.getHeatBonus(), 1e-9, name);
        }

        @Test
        @DisplayName("non-mox GG rods take no heat bonus at all")
        void nonMoxRodsTakeNoBonus() {
            Reactor cold = new Reactor();
            place(cold, 2, 2, "fuelRodLiquidUranium");
            cold.setCurrentHeat(0);
            ((FuelRod) cold.getComponentAt(2, 2)).generateEnergy();
            double coldEnergy = cold.getCurrentEUoutput();

            Reactor hot = new Reactor();
            place(hot, 2, 2, "fuelRodLiquidUranium");
            hot.setCurrentHeat(hot.getMaxHeat());
            ((FuelRod) hot.getComponentAt(2, 2)).generateEnergy();
            assertClose(coldEnergy, hot.getCurrentEUoutput(), 1e-9, "no reactor-heat bonus for a non-mox rod");
        }

        @Test
        @DisplayName("mox GG rods scale with their own bonus, not with the global 1.5")
        void moxRodsUseTheirOwnBonus() {
            // The override replaces FuelRod.getHeatBonus() wholesale, so the GT5.09/GTNH 1.5
            // never reaches a GG rod. Worth pinning: flipping the GT version does not change a
            // compressed-plutonium rod's output the way it changes a vanilla mox rod's.
            FuelRod.setGTNHBehavior(true);
            FuelRod ggMox = (FuelRod) ComponentFactory.createComponent("fuelRodCompressedPlutonium");
            assertClose(6, ggMox.getHeatBonus(), 1e-9, "GG mox keeps its own bonus even in GTNH mode");

            FuelRod plainMox = (FuelRod) ComponentFactory.createComponent("fuelRodMox");
            assertClose(1.5, plainMox.getHeatBonus(), 1e-9, "a vanilla mox rod does get 1.5");
            FuelRod.setGTNHBehavior(false);
        }

        @Test
        @DisplayName("GG rods still use the ordinary fuel rod formulas")
        void useOrdinaryFormulas() {
            Reactor reactor = new Reactor();
            place(reactor, 2, 2, "quadFuelRodCompressedUranium"); // energyMult 800, heatMult 8, rodCount 4
            reactor.setCurrentHeat(0);
            FuelRod rod = (FuelRod) reactor.getComponentAt(2, 2);
            // pulses = 0 + 1 + 4/2 = 3; heat = 8 * 3 * 4 = 96
            assertClose(96, rod.generateHeat(), 1e-9, "heat");
            // GTNH-sourced, so energy = 800 * 10 * (1 + 4/2) = 24 000
            rod.generateEnergy();
            assertClose(24000, reactor.getCurrentEUoutput(), 1e-9, "EU/tick");
        }

        @Test
        @DisplayName("the copied instance keeps its per-rod bonus")
        void copyKeepsBonus() {
            GGFuelRod original = (GGFuelRod) ComponentFactory.createComponent("fuelRodLiquidPlutonium");
            FuelRod copy = (FuelRod) ComponentFactory.createComponent("fuelRodLiquidPlutonium");
            assertClose(original.getHeatBonus(), copy.getHeatBonus(), 1e-9, "copy has the same bonus");
            assertTrue(copy != original, "and really is a distinct instance");
        }
    }
}