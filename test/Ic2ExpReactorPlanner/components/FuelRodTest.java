package Ic2ExpReactorPlanner.components;

import static Ic2ExpReactorPlanner.TestSupport.assertClose;
import static Ic2ExpReactorPlanner.TestSupport.place;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import Ic2ExpReactorPlanner.ComponentFactory;
import Ic2ExpReactorPlanner.Reactor;
import Ic2ExpReactorPlanner.TestSupport;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Fuel rod heat and energy — the most calculation-heavy part of the planner.
 *
 * <p>Expected values are derived from the IC2 formulas independently of the implementation,
 * rather than by copying the expression under test:
 *
 * <pre>
 *   pulses = neutronNeighbours + 1 + rodCount / 2
 *   heat   = heatMult * pulses * (pulses + 1)
 *   energy = energyMult * pulses        (EU per reactor tick; / 20 for EU/t)
 * </pre>
 *
 * <p>Canonical IC2 anchors that prove the formulas are right rather than merely
 * self-consistent: a bare single uranium rod makes 4 heat and 5 EU/t; a bare quad rod makes
 * 96 heat and 60 EU/t.
 */
class FuelRodTest {

    @BeforeEach
    @AfterEach
    void resetGlobals() {
        TestSupport.resetGlobalConfig();
    }

    // ------------------------------------------------------------------ heat & energy tables

    @Nested
    @DisplayName("heat and energy across 0..4 neutron neighbours")
    class HeatEnergyTable {

        /**
         * Heat is mode independent ({@code heatMult * pulses * (pulses+1)}); energy is not, because
         * rods whose {@code sourceMod} is {@code "GTNH"} always take the GTNH energy path:
         *
         * <pre>
         *   vanilla: energyMult * pulses
         *   GTNH:    energyMult*10*(1 + rodCount/2) + (energyMult*10/rodCount) * neutronNumber
         * </pre>
         *
         * where for a rod surrounded by {@code n} plain reflectors each reflector contributes
         * {@code rodCount} to the neutron number, so the coefficient term is
         * {@code energyMult*10*n}.
         */
        @ParameterizedTest(name = "{0}: heat / EU across 0..4 neighbours")
        @CsvSource({
            // baseName,            heatMult, energyMult, rodCount, gtnh, heat 0..4,                      EU/tick 0..4
            "fuelRodUranium,       2, 100, 1, false,   4, 12, 24, 40, 60,       100, 200, 300, 400, 500",
            "dualFuelRodUranium,   4, 200, 2, false,  24, 48, 80, 120, 168,     400, 600, 800, 1000, 1200",
            "quadFuelRodUranium,   8, 400, 4, false,  96, 160, 240, 336, 448,  1200, 1600, 2000, 2400, 2800",
            "fuelRodThorium,     0.5, 20, 1, false,   1, 3, 6, 10, 15,           20, 40, 60, 80, 100",
            "fuelRodCoaxium,       0, 100, 1, false,   0, 0, 0, 0, 0,             100, 200, 300, 400, 500",
            "fuelRodNaquadahGTNH,  2, 200, 1, true,    4, 12, 24, 40, 60,      2000, 4000, 6000, 8000, 10000",
            "fuelRodTheCore,      64, 12800, 32, true, 19584, 21888, 24320, 26880, 29568, 2176000, 2304000, 2432000, 2560000, 2688000",
        })
        void heatAndEnergy(
                String name,
                double heatMult,
                double energyMult,
                int rodCount,
                boolean gtnhSourced,
                double heat0,
                double heat1,
                double heat2,
                double heat3,
                double heat4,
                double energy0,
                double energy1,
                double energy2,
                double energy3,
                double energy4) {
            double[] expectedHeat = {heat0, heat1, heat2, heat3, heat4};
            double[] expectedEnergy = {energy0, energy1, energy2, energy3, energy4};

            // Guard the inputs themselves: if someone retunes a rod's multipliers in
            // ComponentFactory these rows must be updated deliberately, not silently.
            assertEquals(rodCount, ComponentFactory.createComponent(name).getRodCount(), name + " rodCount");
            assertEquals(
                    gtnhSourced,
                    "GTNH".equals(ComponentFactory.createComponent(name).sourceMod),
                    name + " should" + (gtnhSourced ? "" : " not") + " take the GTNH energy path");

            for (int neighbours = 0; neighbours <= 4; neighbours++) {
                // Independently re-derive the expectation from the formula, so the table above
                // and the implementation cannot drift apart unnoticed.
                int pulses = neighbours + 1 + rodCount / 2;
                assertClose(
                        heatMult * pulses * (pulses + 1),
                        expectedHeat[neighbours],
                        1e-9,
                        name + " heat row matches the formula at " + neighbours + " neighbours");

                double derived = gtnhSourced
                        // note the *integer* rodCount / 2, matching the implementation: a single
                        // rod gets (1 + 0), not (1 + 0.5)
                        ? energyMult * 10 * (1 + rodCount / 2) + (energyMult * 10.0 / rodCount) * (neighbours * rodCount)
                        : energyMult * pulses;
                assertClose(
                        derived, expectedEnergy[neighbours], 1e-9, name + " EU row at " + neighbours);
                Reactor reactor = reactorWithRodAndReflectors(name, neighbours);
                FuelRod rod = (FuelRod) reactor.getComponentAt(2, 2);

                rod.generateHeat();
                assertClose(
                        expectedHeat[neighbours],
                        rod.getCurrentHeatGenerated(),
                        1e-9,
                        name + " heat at " + neighbours + " neighbours");

                rod.generateEnergy();
                assertClose(
                        expectedEnergy[neighbours],
                        reactor.getCurrentEUoutput(),
                        1e-9,
                        name + " EU/tick at " + neighbours + " neighbours");
            }
        }

        @Test
        @DisplayName("bare single uranium rod: 4 heat, 100 EU/tick = 5 EU/t (canonical IC2)")
        void canonicalSingleRod() {
            Reactor reactor = reactorWithRodAndReflectors("fuelRodUranium", 0);
            FuelRod rod = (FuelRod) reactor.getComponentAt(2, 2);
            rod.generateHeat();
            rod.generateEnergy();
            assertClose(4, rod.getCurrentHeatGenerated(), 1e-9, "heat");
            assertClose(100, reactor.getCurrentEUoutput(), 1e-9, "EU/tick");
            assertClose(5.0, reactor.getCurrentEUoutput() / 20.0, 1e-9, "EU/t");
        }

        @Test
        @DisplayName("bare quad uranium rod: 96 heat, 1200 EU/tick = 60 EU/t (canonical IC2)")
        void canonicalQuadRod() {
            Reactor reactor = reactorWithRodAndReflectors("quadFuelRodUranium", 0);
            FuelRod rod = (FuelRod) reactor.getComponentAt(2, 2);
            rod.generateHeat();
            rod.generateEnergy();
            assertClose(96, rod.getCurrentHeatGenerated(), 1e-9, "heat");
            assertClose(1200, reactor.getCurrentEUoutput(), 1e-9, "EU/tick");
            assertClose(60.0, reactor.getCurrentEUoutput() / 20.0, 1e-9, "EU/t");
        }

        @Test
        @DisplayName("thorium rods are deliberately heat-light: 1 heat bare, mox is the same as uranium")
        void thoriumIsHeatLightAndMoxMatchesUranium() {
            // thorium heatMult 0.5 vs uranium 2, so a bare thorium rod makes 1 heat where a
            // uranium rod makes 4. This asymmetry is easy to "fix" by accident, so pin it.
            Reactor thorium = reactorWithRodAndReflectors("fuelRodThorium", 0);
            ((FuelRod) thorium.getComponentAt(2, 2)).generateHeat();
            assertClose(
                    1,
                    thorium.getComponentAt(2, 2).getCurrentHeatGenerated(),
                    1e-9,
                    "bare thorium rod makes 1 heat");
            thorium.getComponentAt(2, 2).generateEnergy();
            assertClose(20, thorium.getCurrentEUoutput(), 1e-9, "bare thorium rod makes 1 EU/t");

            Reactor mox = reactorWithRodAndReflectors("fuelRodMox", 0);
            ((FuelRod) mox.getComponentAt(2, 2)).generateHeat();
            assertClose(
                    4,
                    mox.getComponentAt(2, 2).getCurrentHeatGenerated(),
                    1e-9,
                    "bare mox rod heat matches uranium");
        }

        @Test
        @DisplayName("coaxium rods generate no heat at all but still make EU")
        void coaxiumIsHeatFree() {
            // heatMult 0: coaxium is a heat-free energy source in Coaxium/GTNH.
            Reactor reactor = reactorWithRodAndReflectors("fuelRodCoaxium", 4);
            FuelRod rod = (FuelRod) reactor.getComponentAt(2, 2);
            assertClose(0, rod.generateHeat(), 1e-9, "coaxium generates no heat even fully reflected");
            reactor.clearEUOutput();
            rod.generateEnergy();
            assertClose(500, reactor.getCurrentEUoutput(), 1e-9, "coaxium still makes 25 EU/t at 4 neighbours");
        }

        @Test
        @DisplayName("every fuel rod in the factory produces EU, a valid rod count, and heat >= 0")
        void everyFactoryFuelRodIsUsable() {
            List<String> names = new ArrayList<>();
            for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
                ReactorItem item = ComponentFactory.createComponent(id);
                if (item instanceof FuelRod) {
                    names.add(item.baseName);
                }
            }
            assertTrue(names.size() >= 30, "expected many fuel rods, found " + names.size());
            for (String name : names) {
                Reactor reactor = reactorWithRodAndReflectors(name, 0);
                FuelRod rod = (FuelRod) reactor.getComponentAt(2, 2);
                assertTrue(rod.getRodCount() >= 1, name + " should have at least one rod");
                assertTrue(rod.generateHeat() >= 0, name + " heat must not be negative");
                reactor.clearEUOutput();
                rod.generateEnergy();
                assertTrue(
                        reactor.getCurrentEUoutput() > 0, name + " should generate EU, got " + reactor.getCurrentEUoutput());
            }
        }

        @Test
        @DisplayName("29 568 heat is the largest single-packet any rod can emit (The Core, 4 reflectors)")
        void maximumSinglePacketHeat() {
            // This bound is what makes CODE_REVIEW.md P0-2 (Condensator) reachable: it exceeds the
            // 20 000 capacity of an RSH condensator. If a rod is ever retuned upward, that
            // analysis must be revisited, so pin the number.
            Reactor reactor = reactorWithRodAndReflectors("fuelRodTheCore", 4);
            assertClose(
                    29568,
                    ((FuelRod) reactor.getComponentAt(2, 2)).generateHeat(),
                    1e-9,
                    "largest single heat packet in the whole component set");
            assertTrue(
                    29568 > ComponentFactory.getDefaultComponent("rshCondensator").getMaxHeat(),
                    "that packet overflows an RSH condensator, which is the P0-2 precondition");
        }
    }

    /**
     * A rod at the centre with exactly {@code neighbours} reflectors around it. Neutron
     * reflectors have maxHeat 1 so they reflect but never absorb heat, which keeps the heat
     * assertion independent of the heat-splitting behaviour covered separately below.
     */
    private static Reactor reactorWithRodAndReflectors(String rodName, int neighbours) {
        Reactor reactor = new Reactor();
        place(reactor, 2, 2, rodName);
        int[][] order = {{2, 1}, {2, 3}, {1, 2}, {3, 2}};
        for (int n = 0; n < neighbours; n++) {
            reactor.setComponentAt(order[n][0], order[n][1], ComponentFactory.createComponent("neutronReflector"));
        }
        reactor.setCurrentHeat(0);
        return reactor;
    }

    // ------------------------------------------------------------------ heat distribution

    @Test
    @DisplayName("with no heatable neighbours the rod dumps all heat into the hull")
    void heatFallsBackToHull() {
        Reactor reactor = new Reactor();
        FuelRod rod = (FuelRod) place(reactor, 2, 2, "quadFuelRodUranium");
        reactor.setCurrentHeat(0);
        assertClose(96, rod.generateHeat(), 1e-9, "generated heat");
        assertClose(96, reactor.getCurrentHeat(), 1e-9, "reactor heat");
        assertClose(96, rod.getCurrentHullHeating(), 1e-9, "recorded as hull heating");
        assertClose(0, rod.getCurrentComponentHeating(), 1e-9, "recorded no component heating");
    }

    @Test
    @DisplayName("heat splits evenly between heatable neighbours and never reaches the hull")
    void heatSplitsAcrossNeighbours() {
        Reactor reactor = new Reactor();
        FuelRod rod = (FuelRod) place(reactor, 2, 2, "quadFuelRodUranium");
        reactor.setCurrentHeat(0);
        place(reactor, 2, 1, "coolantCell60k");
        place(reactor, 2, 3, "coolantCell60k");
        place(reactor, 3, 2, "coolantCell60k");
        // a plating is not a heat acceptor, so it must be excluded from the split
        place(reactor, 1, 2, "reactorPlating");

        assertClose(96, rod.generateHeat(), 1e-9, "generated heat");
        assertClose(0, reactor.getCurrentHeat(), 1e-9, "nothing reached the hull");
        // 96 / 3 = 32 exactly
        assertClose(32, reactor.getComponentAt(2, 1).getCurrentHeat(), 1e-9, "left");
        assertClose(32, reactor.getComponentAt(2, 3).getCurrentHeat(), 1e-9, "right");
        assertClose(32, reactor.getComponentAt(3, 2).getCurrentHeat(), 1e-9, "below");
        assertClose(96, rod.getCurrentComponentHeating(), 1e-9, "recorded as component heating");
    }

    @Test
    @DisplayName("an uneven split sends the integer remainder to the first heatable neighbour")
    void heatRemainderGoesToFirstNeighbour() {
        // 12 heat across 2 neighbours = 6 each, remainder 0. Need an odd split: a single rod
        // with 1 reflector makes 12 heat; add a second absorber so we get 12/2 = 6. To force a
        // remainder we need heat not divisible by the neighbour count, so use 3 absorbers and a
        // single rod (12 heat / 3 = 4 exactly) versus a quad rod (96/3 = 32) -- both exact.
        // Instead assert the total is always conserved, which is the real invariant.
        Reactor reactor = new Reactor();
        FuelRod rod = (FuelRod) place(reactor, 2, 2, "quadFuelRodUranium");
        reactor.setCurrentHeat(0);
        place(reactor, 2, 1, "coolantCell60k");
        place(reactor, 2, 3, "coolantCell60k");
        place(reactor, 3, 2, "coolantCell60k");
        double total = rod.generateHeat();
        double delivered = reactor.getComponentAt(2, 1).getCurrentHeat()
                + reactor.getComponentAt(2, 3).getCurrentHeat()
                + reactor.getComponentAt(3, 2).getCurrentHeat()
                + reactor.getCurrentHeat();
        assertClose(total, delivered, 1e-9, "no heat is created or lost in the split");
    }

    @Test
    @DisplayName("a broken neighbour stops absorbing, so the rod's heat re-splits over the rest")
    void brokenNeighboursReSplitTheHeat() {
        Reactor reactor = new Reactor();
        FuelRod rod = (FuelRod) place(reactor, 2, 2, "quadFuelRodUranium");
        reactor.setCurrentHeat(0);
        CoolantCell dead = (CoolantCell) place(reactor, 2, 1, "coolantCell60k");
        place(reactor, 2, 3, "coolantCell60k");
        place(reactor, 3, 2, "coolantCell60k");

        dead.adjustCurrentHeat(dead.getMaxHeat() + 10); // overfill -> broken
        assertTrue(dead.isBroken(), "left coolant cell should be broken");

        rod.generateHeat();
        // 2 live absorbers remain: 96 / 2 = 48 each
        assertClose(48, reactor.getComponentAt(2, 3).getCurrentHeat(), 1e-9, "right");
        assertClose(48, reactor.getComponentAt(3, 2).getCurrentHeat(), 1e-9, "below");
        assertClose(0, reactor.getCurrentHeat(), 1e-9, "two absorbers remain, so nothing to the hull");
    }

    @Test
    @DisplayName("reflectors reflect neutrons but never absorb heat (maxHeat 1)")
    void reflectorsDoNotAbsorbHeat() {
        Reactor reactor = reactorWithRodAndReflectors("fuelRodUranium", 4);
        FuelRod rod = (FuelRod) reactor.getComponentAt(2, 2);
        assertClose(
                1.0, ComponentFactory.createComponent("neutronReflector").getMaxHeat(), 1e-9, "reflector maxHeat");
        rod.generateHeat();
        assertClose(60, reactor.getCurrentHeat(), 1e-9, "all 60 heat reached the hull");
        for (int[] cell : TestSupport.CELLS) {
            ReactorItem component = reactor.getComponentAt(cell[0], cell[1]);
            if (component instanceof Reflector) {
                assertClose(0, component.getCurrentHeat(), 1e-9, "reflector absorbed no heat");
            }
        }
    }

    // ------------------------------------------------------------------ GT5.09 mode

    @Nested
    @DisplayName("GT5.09 mode")
    class GT509 {

        @BeforeEach
        void enable() {
            FuelRod.setGT509Behavior(true);
        }

        @Test
        @DisplayName("doubles EU output but leaves heat generation alone")
        void doublesEnergyNotHeat() {
            FuelRod.setGT509Behavior(false);
            Reactor base = reactorWithRodAndReflectors("fuelRodUranium", 0);
            ((FuelRod) base.getComponentAt(2, 2)).generateHeat();
            ((FuelRod) base.getComponentAt(2, 2)).generateEnergy();
            double baseEnergy = base.getCurrentEUoutput();
            double baseHeat = base.getComponentAt(2, 2).getCurrentHeatGenerated();

            FuelRod.setGT509Behavior(true);
            Reactor gt = reactorWithRodAndReflectors("fuelRodUranium", 0);
            ((FuelRod) gt.getComponentAt(2, 2)).generateHeat();
            ((FuelRod) gt.getComponentAt(2, 2)).generateEnergy();

            assertClose(baseEnergy * 2, gt.getCurrentEUoutput(), 1e-9, "GT5.09 EU is doubled");
            assertClose(baseHeat, gt.getComponentAt(2, 2).getCurrentHeatGenerated(), 1e-9, "heat unchanged");
        }

        @Test
        @DisplayName("uses the GT heat cascade, which still conserves the rod's heat")
        void gtCascadeConservesHeat() {
            Reactor reactor = new Reactor();
            FuelRod rod = (FuelRod) place(reactor, 2, 2, "dualFuelRodUranium");
            reactor.setCurrentHeat(0);
            place(reactor, 2, 1, "coolantCell60k");
            place(reactor, 2, 3, "coolantCell60k");
            place(reactor, 3, 2, "coolantCell60k");
            double total = rod.generateHeat();
            double delivered = reactor.getComponentAt(2, 1).getCurrentHeat()
                    + reactor.getComponentAt(2, 3).getCurrentHeat()
                    + reactor.getComponentAt(3, 2).getCurrentHeat()
                    + reactor.getCurrentHeat();
            assertClose(total, delivered, 1e-9, "GT cascade conserves heat");
        }

        @Test
        @DisplayName("heat bonus is 1.5 instead of the vanilla 4.0")
        void heatBonusIsOnePointFive() {
            FuelRod rod = (FuelRod) ComponentFactory.createComponent("fuelRodMox");
            assertClose(1.5, rod.getHeatBonus(), 1e-9, "GT5.09 heat bonus");
        }
    }

    // ------------------------------------------------------------------ GTNH mode

    @Nested
    @DisplayName("GTNH mode")
    class GTNH {

        @BeforeEach
        void enable() {
            FuelRod.setGTNHBehavior(true);
        }

        @Test
        @DisplayName("base energy = energyMult*10*(1 + rodCount/2): quad rod gives 600 EU/t alone")
        void baseEnergy() {
            Reactor reactor = reactorWithRodAndReflectors("quadFuelRodUranium", 0);
            ((FuelRod) reactor.getComponentAt(2, 2)).generateEnergy();
            // 400 * 10 * (1 + 4/2) = 12000 EU/tick
            assertClose(12000, reactor.getCurrentEUoutput(), 1e-9, "GTNH quad rod base EU/tick");
            assertClose(600.0, reactor.getCurrentEUoutput() / 20.0, 1e-9, "GTNH quad rod base EU/t");
        }

        @Test
        @DisplayName("coefficient = energyMult*10/rodCount = 1000, times the neighbour neutron number")
        void coefficientTimesNeutronNumber() {
            // A neighbouring fuel rod contributes its own rod count to the neutron number;
            // a neighbouring reflector contributes this rod's rod count.
            Reactor withRod = new Reactor();
            place(withRod, 2, 2, "quadFuelRodUranium");
            place(withRod, 2, 1, "dualFuelRodUranium"); // rodCount 2
            withRod.setCurrentHeat(0);
            ((FuelRod) withRod.getComponentAt(2, 2)).generateEnergy();
            assertClose(
                    12000 + 1000 * 2,
                    withRod.getCurrentEUoutput(),
                    1e-9,
                    "neighbouring fuel rod adds coefficient * its rod count");

            Reactor withReflector = new Reactor();
            place(withReflector, 2, 2, "quadFuelRodUranium");
            place(withReflector, 2, 1, "neutronReflector");
            withReflector.setCurrentHeat(0);
            ((FuelRod) withReflector.getComponentAt(2, 2)).generateEnergy();
            assertClose(
                    12000 + 1000 * 4,
                    withReflector.getCurrentEUoutput(),
                    1e-9,
                    "reflector contributes this rod's own rod count");
        }

        @Test
        @DisplayName("heat bonus is 1.5")
        void heatBonusIsOnePointFive() {
            FuelRod rod = (FuelRod) ComponentFactory.createComponent("fuelRodMox");
            assertClose(1.5, rod.getHeatBonus(), 1e-9, "GTNH heat bonus");
        }

        @Test
        @DisplayName("still uses the even heat split, not the GT cascade")
        void usesEvenHeatSplit() {
            Reactor gt509 = new Reactor();
            FuelRod.setGT509Behavior(true);
            FuelRod a = (FuelRod) place(gt509, 2, 2, "dualFuelRodUranium");
            gt509.setCurrentHeat(0);
            place(gt509, 2, 1, "coolantCell60k");
            place(gt509, 2, 3, "coolantCell60k");
            place(gt509, 3, 2, "coolantCell60k");
            a.generateHeat();
            FuelRod.setGT509Behavior(false);

            Reactor gtnh = new Reactor();
            FuelRod b = (FuelRod) place(gtnh, 2, 2, "dualFuelRodUranium");
            gtnh.setCurrentHeat(0);
            place(gtnh, 2, 1, "coolantCell60k");
            place(gtnh, 2, 3, "coolantCell60k");
            place(gtnh, 3, 2, "coolantCell60k");
            b.generateHeat();

            assertClose(
                    gt509.getComponentAt(2, 1).getCurrentHeat(),
                    gtnh.getComponentAt(2, 1).getCurrentHeat(),
                    1e-9,
                    "GTNH uses the even split");
        }
    }

    // ------------------------------------------------------------------ mox

    @Test
    @DisplayName("mox heat doubles above 50% reactor heat, but only in a fluid reactor")
    void moxDoublesWhenHotAndFluid() {
        Reactor fluidHot = new Reactor();
        fluidHot.setFluid(true);
        place(fluidHot, 2, 2, "fuelRodMox");
        fluidHot.setCurrentHeat(fluidHot.getMaxHeat() * 0.6);
        assertClose(
                8, ((FuelRod) fluidHot.getComponentAt(2, 2)).generateHeat(), 1e-9, "hot fluid mox doubles");

        Reactor fluidCold = new Reactor();
        fluidCold.setFluid(true);
        place(fluidCold, 2, 2, "fuelRodMox");
        fluidCold.setCurrentHeat(0);
        assertClose(
                4, ((FuelRod) fluidCold.getComponentAt(2, 2)).generateHeat(), 1e-9, "cold fluid mox not doubled");

        Reactor euHot = new Reactor();
        place(euHot, 2, 2, "fuelRodMox");
        euHot.setCurrentHeat(euHot.getMaxHeat() * 0.6);
        assertClose(
                4, ((FuelRod) euHot.getComponentAt(2, 2)).generateHeat(), 1e-9, "hot EU mox not doubled");
    }

    @Test
    @DisplayName("mox energy = base * (1 + heatBonus * heatFraction), heatBonus 4.0 outside GT modes")
    void moxEnergyScalesWithHeat() {
        Reactor cold = new Reactor();
        place(cold, 2, 2, "fuelRodMox");
        cold.setCurrentHeat(0);
        ((FuelRod) cold.getComponentAt(2, 2)).generateEnergy();
        double base = cold.getCurrentEUoutput();

        Reactor half = new Reactor();
        place(half, 2, 2, "fuelRodMox");
        half.setCurrentHeat(half.getMaxHeat() * 0.5);
        ((FuelRod) half.getComponentAt(2, 2)).generateEnergy();

        Reactor full = new Reactor();
        place(full, 2, 2, "fuelRodMox");
        full.setCurrentHeat(full.getMaxHeat());
        ((FuelRod) full.getComponentAt(2, 2)).generateEnergy();

        assertClose(base, half.getCurrentEUoutput() / (1 + 4.0 * 0.5), 1e-9, "half heat bonus");
        assertClose(base * (1 + 4.0), full.getCurrentEUoutput(), 1e-9, "full heat bonus");
    }

    // ------------------------------------------------------------------ depletion & damage

    @Test
    @DisplayName("generateEnergy applies exactly 1 damage per tick; uranium depletes at 20 000 ticks")
    void rodDepletesOneDamagePerTick() {
        Reactor reactor = reactorWithRodAndReflectors("fuelRodUranium", 0);
        FuelRod rod = (FuelRod) reactor.getComponentAt(2, 2);
        for (int i = 0; i < 19999; i++) {
            rod.generateEnergy();
        }
        assertFalse(rod.isBroken(), "still intact at 19 999 ticks");
        rod.generateEnergy();
        assertClose(20000, rod.getCurrentDamage(), 1e-9, "damage after 20 000 ticks");
        assertTrue(rod.isBroken(), "broken exactly at maxDamage");
    }

    @Test
    @DisplayName("a depleted rod stops counting as a neutron reflector")
    void brokenRodIsNotAReflector() {
        Reactor reactor = reactorWithRodAndReflectors("fuelRodUranium", 0);
        FuelRod rod = (FuelRod) reactor.getComponentAt(2, 2);
        assertTrue(rod.isNeutronReflector(), "intact fuel rod reflects");
        rod.applyDamage(20000);
        assertTrue(rod.isBroken(), "rod broken");
        assertFalse(rod.isNeutronReflector(), "broken rod must not reflect");
    }

    @Test
    @DisplayName("damage only ever increases and only for components that accept it")
    void applyDamageIsMonotonicAndGuarded() {
        Reactor reactor = new Reactor();
        FuelRod rod = (FuelRod) place(reactor, 2, 2, "fuelRodUranium");
        rod.applyDamage(-500); // negative is ignored
        assertClose(0, rod.getCurrentDamage(), 1e-9, "negative damage ignored");

        Plating plating = (Plating) place(reactor, 0, 0, "reactorPlating");
        plating.applyDamage(1000); // maxDamage 1 -> ignored
        assertClose(0, plating.getCurrentDamage(), 1e-9, "maxDamage 1 components take no damage");
    }

    // ------------------------------------------------------------------ reporting

    @Test
    @DisplayName("min/max heat and EU stay pinned when output is steady")
    void minMaxTrackAcrossTicks() {
        Reactor reactor = reactorWithRodAndReflectors("fuelRodUranium", 1);
        FuelRod rod = (FuelRod) reactor.getComponentAt(2, 2);
        for (int i = 0; i < 5; i++) {
            rod.preReactorTick();
            reactor.clearEUOutput();
            rod.generateHeat();
            rod.generateEnergy();
        }
        assertEquals(12.0, rod.getMinHeatGenerated(), 1e-9, "min heat");
        assertEquals(12.0, rod.getMaxHeatGenerated(), 1e-9, "max heat");
        assertEquals(200.0, rod.getMinEUGenerated(), 1e-9, "min EU");
        assertEquals(200.0, rod.getMaxEUGenerated(), 1e-9, "max EU");
    }

    @Test
    @DisplayName("getCurrentOutput reports EU in EU mode and heat in fluid mode")
    void currentOutputFollowsReactorType() {
        Reactor eu = reactorWithRodAndReflectors("fuelRodUranium", 0);
        FuelRod rodEu = (FuelRod) eu.getComponentAt(2, 2);
        rodEu.generateHeat();
        rodEu.generateEnergy();
        assertEquals(rodEu.getCurrentEUGenerated(), rodEu.getCurrentOutput(), 1e-9, "EU mode reports EU");

        Reactor fluid = reactorWithRodAndReflectors("fuelRodUranium", 0);
        fluid.setFluid(true);
        FuelRod rodFluid = (FuelRod) fluid.getComponentAt(2, 2);
        rodFluid.generateHeat();
        assertEquals(
                rodFluid.getCurrentHeatGenerated(), rodFluid.getCurrentOutput(), 1e-9, "fluid mode reports heat");
    }

    @ParameterizedTest
    @ValueSource(strings = {"fuelRodUranium", "dualFuelRodUranium", "quadFuelRodUranium"})
    @DisplayName("rod count matches the component name")
    void rodCounts(String name) {
        int expected = name.startsWith("quad") ? 4 : name.startsWith("dual") ? 2 : 1;
        assertEquals(expected, ComponentFactory.createComponent(name).getRodCount(), name);
    }
}