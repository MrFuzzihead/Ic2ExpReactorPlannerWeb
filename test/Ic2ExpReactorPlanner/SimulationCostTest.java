package Ic2ExpReactorPlanner;

import static Ic2ExpReactorPlanner.TestSupport.place;
import static org.junit.jupiter.api.Assertions.assertTrue;

import Ic2ExpReactorPlanner.AutomationSimulator;
import Ic2ExpReactorPlanner.Reactor;
import Ic2ExpReactorPlanner.TestSupport;
import javax.swing.JPanel;
import javax.swing.JTextArea;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * A bound on the cost of a simulated tick, not a benchmark.
 *
 * P2-1, P2-2 and P2-3 were measured with a throwaway harness, so the suite had nothing that could
 * fail against them being slow. Absolute speed cannot be asserted here - the same JVM on a loaded
 * CI box spans an order of magnitude - but two *relative* invariants survive that spread, and each
 * one fails for a specific regression:
 *
 *  - the per-tick cost does not grow with the tick cap, which is what fails if a loop turns
 *    quadratic in the tick count (the usual outcome of a "make it faster" edit);
 *  - a five-component design costs far less per tick than the same design with the other 49 cells
 *    filled with plating, which is what fails if the flat `ReactorItem[]` snapshot in the tick
 *    loop is dropped and the seven grid walks go back to charging every cell.
 *
 * The factors are calibrated on this machine, with the measured numbers recorded in CODE_REVIEW.md
 * next to the test. Inside the suite the JVM is colder than the standalone harness the review
 * measured with: the five-component design runs at 839 ns/tick and the plated one at 4 040, a gap
 * of 4.8x, and the test asks for 3x; the same design costs 311 ns/tick at 150 000 ticks and 332 at
 * 600 000, a ratio of 1.07, and the test asks for 2. The standalone harness measured 244-273 and
 * 1 347-1 743, the same 5.5-6.3x gap at a third of the absolute cost.
 */
public class SimulationCostTest {

    @BeforeEach
    @AfterEach
    void resetGlobals() {
        TestSupport.resetGlobalConfig();
    }

    /** The P2-2 measurement design: an automated quad rod with four 10 k coolant cells. */
    private static Reactor sparseDesign() {
        Reactor design = new Reactor();
        place(design, 2, 2, "quadFuelRodUranium");
        place(design, 1, 2, "coolantCell10k");
        place(design, 3, 2, "coolantCell10k");
        place(design, 2, 1, "coolantCell10k");
        place(design, 2, 3, "coolantCell10k");
        design.setAutomated(true);
        return design;
    }

    /** The same five components with every other cell filled, so the grid walks are all work. */
    private static Reactor platedDesign() {
        Reactor design = sparseDesign();
        for (int row = 0; row < TestSupport.ROWS; row++) {
            for (int col = 0; col < TestSupport.COLS; col++) {
                if (design.getComponentAt(row, col) == null) {
                    place(design, row, col, "reactorPlating");
                }
            }
        }
        return design;
    }

    /**
     * One simulated run of a copy of `design`, capped at `ticks`, reported in nanoseconds per
     * tick. The run is timed around `execute`, `get` and the report drain, so the measurement
     * covers the whole job rather than the moment the worker is started.
     */
    private static long nanosPerTick(Reactor design, int ticks) throws Exception {
        Reactor simReactor = new Reactor();
        simReactor.setCode(design.getCode());
        simReactor.setMaxSimulationTicks(ticks);

        JTextArea output = new JTextArea(5, 20);
        AutomationSimulator simulator =
                new AutomationSimulator(simReactor, output, newJPanelGrid(), null, -1);

        long start = System.nanoTime();
        simulator.execute();
        simulator.get();
        TestSupport.awaitCompletion(output);
        long elapsed = System.nanoTime() - start;
        return elapsed / ticks;
    }

    /** The better of two runs. A min, not a mean: a GC pause or a busy box inflates a run, it does not deflate one. */
    private static long bestNanosPerTick(Reactor design, int ticks) throws Exception {
        long best = -1L;
        for (int attempt = 0; attempt < 2; attempt++) {
            long cost = nanosPerTick(design, ticks);
            if (best < 0 || cost < best) {
                best = cost;
            }
        }
        return best;
    }

    private static JPanel[][] newJPanelGrid() {
        JPanel[][] panels = new JPanel[TestSupport.ROWS][TestSupport.COLS];
        for (int row = 0; row < TestSupport.ROWS; row++) {
            for (int col = 0; col < TestSupport.COLS; col++) {
                panels[row][col] = new JPanel();
            }
        }
        return panels;
    }

    @Test
    @DisplayName("doubling the tick cap does not change the cost of a tick")
    public void theTickLoopIsLinearInTheTicksItRuns() throws Exception {
        Reactor design = sparseDesign();
        // A short run first, so the JIT has seen the hot loops before either measurement.
        bestNanosPerTick(design, 20_000);

        long shortRun = bestNanosPerTick(design, 150_000);
        long longRun = bestNanosPerTick(design, 600_000);

        assertTrue(shortRun > 0, "a measured run has to report a cost: " + shortRun + " ns/tick");
        assertTrue(longRun <= 2L * shortRun,
                "600 000 ticks cost " + longRun + " ns/tick against " + shortRun + " ns/tick for 150 000, "
                        + "so a tick got more than twice as expensive when the run quadrupled: "
                        + "the loop is no longer linear in the ticks it runs");
    }

    @Test
    @DisplayName("the tick loop is not charged for cells the design does not have")
    public void theSparseGridCostsFarLessPerTickThanThePlatedOne() throws Exception {
        long sparse = bestNanosPerTick(sparseDesign(), 200_000);
        long plated = bestNanosPerTick(platedDesign(), 200_000);

        assertTrue(sparse > 0, "a measured run has to report a cost: " + sparse + " ns/tick");
        assertTrue(3L * sparse < plated,
                "the five-component design costs " + sparse + " ns/tick and the same design with 49 more "
                        + "components costs " + plated + " ns/tick, a gap under the 3x the flat snapshot is "
                        + "supposed to leave (measured 5.5-6.3x here, 2.4x with the snapshot dropped)");
    }
}
