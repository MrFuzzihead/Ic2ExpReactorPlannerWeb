package Ic2ExpReactorPlanner.corpus;

import Ic2ExpReactorPlanner.ComponentFactory;
import Ic2ExpReactorPlanner.Reactor;
import Ic2ExpReactorPlanner.components.Condensator;
import Ic2ExpReactorPlanner.components.CoolantCell;
import Ic2ExpReactorPlanner.components.Exchanger;
import Ic2ExpReactorPlanner.components.FuelRod;
import Ic2ExpReactorPlanner.components.Plating;
import Ic2ExpReactorPlanner.components.ReactorItem;
import Ic2ExpReactorPlanner.components.Reflector;
import Ic2ExpReactorPlanner.components.Vent;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;

/**
 * A deterministic corpus of reactor designs, used as the regression baseline.
 *
 * <p>The corpus exists so a change to the calculation logic can be answered with a number
 * instead of an opinion: run every design, diff the whole metric fingerprint against the
 * committed baseline, and see exactly which designs moved and by how much. Each finding in
 * {@code CODE_REVIEW.md} that changes simulation output (P0-1 exchanger, P0-2 condensator,
 * P1-4 heat units) should ship with a <em>prediction</em> of which designs may move; this
 * corpus is what tests that prediction.
 *
 * <p><b>Determinism is the whole point.</b> Everything is generated from a fixed seed, in a fixed
 * order, with no reliance on hash iteration order or wall-clock time. The generator deliberately
 * uses {@link java.util.Random} (whose algorithm is specified) and {@link LinkedHashSet} rather
 * than {@code HashSet}, because an unstable corpus makes the baseline worthless.
 *
 * <p><b>GT modes are process-wide.</b> {@code FuelRod.GT509Behavior} and
 * {@code FuelRod.GTNHbehavior} are statics, so they cannot be per-design state. Each
 * {@link Design} instead <em>declares</em> which mode it wants and {@link CorpusRunner} sets
 * the statics immediately before that design's run and clears them immediately after. Runs are
 * strictly sequential, so this is safe.
 */
public final class Corpus {

    private Corpus() {}

    public static final int ROWS = 6;
    public static final int COLS = 9;

    /**
     * Hard cap on simulated ticks per design.
     *
     * <p>Without it, a design that never explodes would run the full 5,000,000-tick default and
     * the corpus would take hours. 4,000 ticks is comfortably past the point where every design
     * here has either exploded, run out of rods, or reached steady state, and it keeps a full
     * pass in the low seconds.
     */
    public static final int TICK_CAP = 4000;

    /** The seed for the generated designs. Changing it invalidates the entire baseline. */
    public static final long SEED = 0x5EED_1C2E_1057L;

    private static final int GENERATED_COUNT = 200;

    // ------------------------------------------------------------------ one design

    /** A single corpus entry. */
    public static final class Design {
        public final String id;
        public final String note;
        public final Reactor reactor;
        public final int tickCap;
        /** Comma-separated flags, e.g. {@code exchanger,condensator} — used to group a diff. */
        public final String tags;
        /** Which global GT mode this design wants, applied by the runner. */
        public final boolean gt509;
        public final boolean gtnh;

        Design(String id, String note, Reactor reactor, int tickCap, boolean gt509, boolean gtnh) {
            this.id = id;
            this.note = note;
            this.reactor = reactor;
            this.tickCap = tickCap;
            this.gt509 = gt509;
            this.gtnh = gtnh;
            this.tags = tag(reactor, gt509, gtnh);
        }

        Design(String id, String note, Reactor reactor) {
            this(id, note, reactor, TICK_CAP, false, false);
        }

        @Override
        public String toString() {
            return id + (note.isEmpty() ? "" : " (" + note + ")");
        }

        private static String tag(Reactor reactor, boolean gt509, boolean gtnh) {
            Set<String> tags = new LinkedHashSet<>();
            int componentCount = 0;
            for (int row = 0; row < ROWS; row++) {
                for (int col = 0; col < COLS; col++) {
                    ReactorItem component = reactor.getComponentAt(row, col);
                    if (component == null) {
                        continue;
                    }
                    componentCount++;
                    if (component instanceof Exchanger) {
                        tags.add("exchanger");
                    }
                    if (component instanceof Condensator) {
                        tags.add("condensator");
                    }
                    if (component instanceof FuelRod) {
                        tags.add("rod");
                    }
                    if (component instanceof Vent) {
                        tags.add("vent");
                    }
                    if (component instanceof CoolantCell) {
                        tags.add("cell");
                    }
                    if (component instanceof Plating) {
                        tags.add("plating");
                    }
                    if (component instanceof Reflector) {
                        tags.add("reflector");
                    }
                }
            }
            if (reactor.isFluid()) {
                tags.add("fluid");
            }
            if (reactor.isPulsed()) {
                tags.add("pulsed");
            }
            if (reactor.isAutomated()) {
                tags.add("automated");
            }
            if (reactor.isUsingReactorCoolantInjectors()) {
                tags.add("rci");
            }
            if (gt509) {
                tags.add("gt509");
            }
            if (gtnh) {
                tags.add("gtnh");
            }
            if (tags.isEmpty()) {
                // A design with components but none of the interesting types (a lone breeder
                // cell, say) is "other", not "empty" — the distinction matters when a diff is
                // grouped by tag.
                tags.add(componentCount == 0 ? "empty" : "other");
            }
            return String.join(",", tags);
        }
    }

    // ------------------------------------------------------------------ the corpus

    /** Every design, in a fixed order: single components, then named cases, then generated. */
    public static List<Design> all() {
        List<Design> designs = new ArrayList<>();
        addSingleComponentDesigns(designs);
        addNamedDesigns(designs);
        addGeneratedDesigns(designs);
        return designs;
    }

    /**
     * Each of the 72 components on its own, centred. Cheap (one component each) and catches any
     * change to an individual component's arithmetic.
     */
    private static void addSingleComponentDesigns(List<Design> designs) {
        for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
            Reactor reactor = new Reactor();
            reactor.setComponentAt(2, 2, ComponentFactory.createComponent(id));
            String name = ComponentFactory.getDefaultComponent(id).baseName;
            designs.add(new Design("single-" + name, "one component alone", reactor));
        }
    }

    /** Hand-built cases, each with a specific reason to exist. */
    private static void addNamedDesigns(List<Design> designs) {
        // --- shapes shared with AutomationSimulatorTest, so the two agree
        designs.add(new Design("named-empty", "no components at all", new Reactor()));
        designs.add(new Design("named-single-rod", "1 uranium rod, 4 heat/tick, explodes at 2500", bareRod()));
        designs.add(new Design(
                "named-single-rod-preheated", "same, starting at 4000 heat", preheatedBareRod(4000)));
        designs.add(new Design(
                "named-reflected-rod", "4 reflectors, 60 heat/tick, explodes at 167", reflectedRod()));
        designs.add(new Design(
                "named-quad-cells", "quad rod into four 10k cells, cells break at 417", quadRodWithCells()));
        designs.add(new Design(
                "named-rod-vent", "runs to rod depletion, the EU workhorse", rodWithVent()));

        // --- P0-1 (Exchanger): one structurally distinct design per exchanger type, so all four
        // are represented without wasting corpus entries.
        //
        // Note these are *representative designs containing exchangers*, not cascade-band
        // cases. An exchanger's band is a per-tick property, and pinning it in an end-to-end
        // design does not work: the exchanger is fed by the adjacent rod and reaches
        // equilibrium within a couple of ticks, so an initial charge is a transient that
        // washes out. (Five designs differing only in initial charge were tried and produced
        // byte-identical results.) The band table itself is pinned by
        // ExchangerTest.exchangerCasesSitInTheIntendedBands and
        // ExchangerTest.IntendedReactorCascade, which is where it belongs.
        designs.add(exchangerDesign("named-core-exchanger", "coreHeatExchanger beside a bare rod",
                "coreHeatExchanger", 0));
        designs.add(exchangerDesign("named-core-exchanger-quad", "coreHeatExchanger between two rods",
                "coreHeatExchanger", 1));
        designs.add(exchangerDesign("named-side-exchanger", "heatExchanger beside a bare rod",
                "heatExchanger", 0));
        designs.add(exchangerDesign("named-advanced-exchanger", "advancedHeatExchanger beside a quad rod",
                "advancedHeatExchanger", 2));
        designs.add(exchangerDesign("named-spread-exchanger", "componentHeatExchanger, switchReactor 0",
                "componentHeatExchanger", 3));

        // --- P0-2 (Condensator): one design per failure regime, all of them reachable.
        // A condensator is a heat acceptor, so a rod feeding only a condensator hands it the
        // rod's entire heat output. Three reflectors is the most that fit beside it.
        designs.add(condensatorCase("named-condensator-small", "4 heat packets, plain accumulation", "rshCondensator", "fuelRodUranium", 0));
        designs.add(condensatorCase("named-condensator-overfill", "336 heat packets, overshoots 20000", "rshCondensator", "quadFuelRodUranium", 3));
        designs.add(condensatorCase("named-condensator-overfill-big", "5376 heat packets, overshoots", "rshCondensator", "quadFuelRodLiquidUranium", 3));
        designs.add(condensatorCase("named-condensator-over-capacity", "26880 heat packets exceed the 20000 RSH", "rshCondensator", "fuelRodTheCore", 3));
        designs.add(condensatorCase("named-lzh-overfill", "LZH also overshoots on big packets", "lzhCondensator", "quadFuelRodLiquidUranium", 3));
        designs.add(condensatorCase("named-lzh-small", "LZH immune to the over-capacity mode", "lzhCondensator", "fuelRodUranium", 0));

        // --- the exotic rods, which is where the largest packets come from
        designs.add(new Design("named-the-core", "largest packet in the game",
                rodBeside("fuelRodTheCore", "neutronReflector")));
        designs.add(new Design("named-liquid-uranium-quad", "5376 heat packets",
                rodBeside("quadFuelRodLiquidUranium", "neutronReflector")));
        designs.add(new Design("named-compressed-plutonium", "mox GG rod",
                rodBeside("quadFuelRodCompressedPlutonium", "neutronReflector")));
        designs.add(new Design("named-coaxium", "heat-free rod",
                rodBeside("quadFuelRodCoaxium", "neutronReflector")));
        designs.add(new Design("named-cesium", "very heat-heavy rod",
                rodBeside("quadFuelRodCesium", "neutronReflector")));
        designs.add(new Design("named-thorium-quad", "heat-light rod",
                rodBeside("quadFuelRodThorium", "neutronReflector")));

        // --- mode coverage on a design that runs long enough to be interesting
        Reactor vent = rodWithVent();
        designs.add(tweaked("named-rod-vent-fluid", "fluid mode", vent, r -> r.setFluid(true)));
        designs.add(tweaked("named-rod-vent-pulsed", "2s on / 2s off", vent, r -> {
            r.setPulsed(true);
            r.setOnPulse(2000);
            r.setOffPulse(2000);
        }));
        designs.add(tweaked("named-rod-vent-preheated", "starting at 3000 heat", vent, r -> r.setCurrentHeat(3000)));

        // --- plating changes maxHeat, which moves every timing threshold
        Reactor plated = quadRodWithCells();
        plated.setComponentAt(5, 8, ComponentFactory.createComponent("heatCapacityReactorPlating"));
        designs.add(new Design("named-quad-cells-plating", "plating raises maxHeat to 11700", plated));

        // --- automation with a threshold low enough to actually fire
        Reactor automated = quadRodWithCells();
        automated.setAutomated(true);
        for (int[] cell : new int[][] {{1, 2}, {3, 2}, {2, 1}, {2, 3}}) {
            automated.getComponentAt(cell[0], cell[1]).setAutomationThreshold(2000);
        }
        designs.add(new Design("named-quad-cells-automated", "cells replaced, never boils", automated));

        // --- coolant injectors
        Reactor rci = bareRod();
        rci.setComponentAt(2, 1, ComponentFactory.createComponent("rshCondensator"));
        rci.setUsingReactorCoolantInjectors(true);
        designs.add(new Design("named-condensator-rci", "RSH condensator with injectors", rci));

        // --- the GT modes change FuelRod behaviour globally, so they need their own designs
        designs.add(new Design(
                "named-gt509-quad", "GT5.09 mode, doubled EU", rodWithVent(), TICK_CAP, true, false));
        designs.add(new Design(
                "named-gtnh-quad", "GTNH mode, different energy formula", rodWithVent(), TICK_CAP, false, true));
        designs.add(new Design(
                "named-gtnh-mox", "GTNH mox rod, 1.5 heat bonus",
                rodBesideReactor("quadFuelRodTiberium"), TICK_CAP, false, true));
    }

    /**
     * Pseudo-random designs from a fixed seed, reaching combinations the hand-written cases do
     * not think of. The seed is a constant, so the list is byte-for-byte reproducible.
     */
    private static void addGeneratedDesigns(List<Design> designs) {
        Random random = new Random(SEED);
        int componentCount = ComponentFactory.getComponentCount() - 1;
        for (int i = 0; i < GENERATED_COUNT; i++) {
            Reactor reactor = new Reactor();
            int slots = 1 + random.nextInt(20);
            for (int s = 0; s < slots; s++) {
                reactor.setComponentAt(
                        random.nextInt(ROWS), random.nextInt(COLS), ComponentFactory.createComponent(1 + random.nextInt(componentCount)));
            }
            reactor.setFluid(random.nextInt(6) == 0);
            reactor.setPulsed(random.nextInt(6) == 0);
            if (reactor.isPulsed()) {
                reactor.setOnPulse(1 + random.nextInt(4000));
                reactor.setOffPulse(random.nextInt(4000));
                reactor.setSuspendTemp(50_000 + random.nextInt(70_000));
                reactor.setResumeTemp(50_000 + random.nextInt(70_000));
            }
            reactor.setAutomated(random.nextInt(5) == 0);
            reactor.setUsingReactorCoolantInjectors(random.nextInt(5) == 0);
            reactor.setCurrentHeat(random.nextInt(3) == 0 ? random.nextInt(10_000) : 0);
            reactor.setMaxSimulationTicks(TICK_CAP);

            // A few designs get a per-component threshold, which changes replacement timing.
            if (reactor.isAutomated()) {
                for (int row = 0; row < ROWS; row++) {
                    for (int col = 0; col < COLS; col++) {
                        ReactorItem component = reactor.getComponentAt(row, col);
                        if (component != null && random.nextInt(3) == 0) {
                            component.setAutomationThreshold(random.nextInt(60_000));
                        }
                    }
                }
            }
            // Occasionally pre-heat one component, which changes where a condensator starts.
            if (random.nextInt(4) == 0) {
                for (int row = 0; row < ROWS; row++) {
                    for (int col = 0; col < COLS; col++) {
                        ReactorItem component = reactor.getComponentAt(row, col);
                        if (component != null && component.isHeatAcceptor()) {
                            component.setInitialHeat(random.nextInt(5_000));
                            break;
                        }
                    }
                }
            }
            // A tenth of the designs run in a GT mode, so the mode-specific formulas are covered.
            boolean gt509 = random.nextInt(20) == 0;
            boolean gtnh = !gt509 && random.nextInt(20) == 0;
            designs.add(new Design(String.format("gen-%03d", i), "seeded random design", reactor, TICK_CAP, gt509, gtnh));
        }
    }

    // ------------------------------------------------------------------ builders

    private static Reactor bareRod() {
        Reactor reactor = new Reactor();
        reactor.setComponentAt(2, 2, ComponentFactory.createComponent("fuelRodUranium"));
        return reactor;
    }

    private static Reactor preheatedBareRod(double heat) {
        Reactor reactor = bareRod();
        reactor.setCurrentHeat(heat);
        return reactor;
    }

    private static Reactor reflectedRod() {
        Reactor reactor = bareRod();
        placeNeighbours(reactor, "neutronReflector", true);
        return reactor;
    }

    private static Reactor quadRodWithCells() {
        Reactor reactor = new Reactor();
        reactor.setComponentAt(2, 2, ComponentFactory.createComponent("quadFuelRodUranium"));
        placeNeighbours(reactor, "coolantCell10k", false);
        return reactor;
    }

    private static Reactor rodWithVent() {
        Reactor reactor = bareRod();
        reactor.setComponentAt(2, 3, ComponentFactory.createComponent("heatVent"));
        return reactor;
    }

    private static Reactor rodBesideReactor(String rod) {
        Reactor reactor = new Reactor();
        reactor.setComponentAt(2, 2, ComponentFactory.createComponent(rod));
        reactor.setComponentAt(2, 3, ComponentFactory.createComponent("heatVent"));
        return reactor;
    }


    /** A rod at (2,2) with a single component beside it at (2,3). */
    private static Reactor rodBeside(String rod, String neighbour) {
        Reactor reactor = new Reactor();
        reactor.setComponentAt(2, 2, ComponentFactory.createComponent(rod));
        reactor.setComponentAt(2, 3, ComponentFactory.createComponent(neighbour));
        return reactor;
    }

    /** Places the same component in all four orthogonal neighbours of (2,2). */
    private static void placeNeighbours(Reactor reactor, String baseName, boolean allFour) {
        int[][] around = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        int count = allFour ? 4 : 4;
        for (int i = 0; i < count; i++) {
            reactor.setComponentAt(2 + around[i][0], 2 + around[i][1], ComponentFactory.createComponent(baseName));
        }
    }

    /**
     * A rod whose only heat acceptor is a condensator, so the condensator receives the rod's
     * entire heat output. Three reflectors is the most that fit beside the condensator, which
     * fixes the packet size for a given rod.
     */
    private static Design condensatorCase(String id, String note, String condensator, String rod, int reflectors) {
        Reactor reactor = new Reactor();
        reactor.setComponentAt(2, 2, ComponentFactory.createComponent(rod));
        reactor.setComponentAt(2, 1, ComponentFactory.createComponent(condensator));
        int[][] free = {{1, 0}, {-1, 0}, {0, 1}};
        for (int i = 0; i < reflectors && i < free.length; i++) {
            reactor.setComponentAt(2 + free[i][0], 2 + free[i][1], ComponentFactory.createComponent("neutronReflector"));
        }
        return new Design(id, note, reactor);
    }

    /**
     * An exchanger in a structurally distinct layout. {@code shape} selects how much machinery
     * surrounds it, so each entry exercises a different amount of the transfer code rather than
     * the same shape five times:
     *
     * <pre>
     *   0  a bare rod beside the exchanger
     *   1  the same, with a second rod so the exchanger has two sources
     *   2  a quad rod, so far more heat flows through it
     *   3  four coolant cells, so the side spread has somewhere to go
     * </pre>
     */
    private static Design exchangerDesign(String id, String note, String exchanger, int shape) {
        Reactor reactor = new Reactor();
        reactor.setComponentAt(2, 2, ComponentFactory.createComponent(shape >= 2 ? "quadFuelRodUranium" : "fuelRodUranium"));
        reactor.setComponentAt(2, 3, ComponentFactory.createComponent(exchanger));
        if (shape == 1) {
            reactor.setComponentAt(1, 2, ComponentFactory.createComponent("fuelRodUranium"));
        } else if (shape == 3) {
            placeNeighbours(reactor, "coolantCell10k", true);
        }
        return new Design(id, note, reactor);
    }

    /** Copies a design's code, then applies a tweak — the same round trip the simulator does. */
    private static Design tweaked(String id, String note, Reactor source, java.util.function.Consumer<Reactor> tweak) {
        Reactor reactor = new Reactor();
        reactor.setCode(source.getCode());
        tweak.accept(reactor);
        return new Design(id, note, reactor);
    }
}
