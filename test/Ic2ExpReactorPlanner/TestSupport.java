package Ic2ExpReactorPlanner;

import Ic2ExpReactorPlanner.components.ReactorItem;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import javax.swing.JPanel;
import javax.swing.JTextArea;
import javax.swing.SwingUtilities;

/**
 * Shared fixtures for the regression suite.
 *
 * <p>Two things every test in this suite has to worry about:
 *
 * <ol>
 *   <li><b>Global mutable configuration.</b> {@code FuelRod.GT509behavior},
 *       {@code FuelRod.GTNHbehavior}, {@code Reflector.mcVersion} and the {@code MaterialsList}
 *       version/flag statics are process-wide, are mutated by the GUI's version combo boxes,
 *       and are read by the calculation logic. If a test leaks one of them the suite becomes
 *       order-dependent, so {@link #resetGlobalConfig()} runs before and after every test.
 *   <li><b>Headless simulation.</b> {@link AutomationSimulator} is a {@code SwingWorker} that
 *       takes a {@code JTextArea} and a {@code JPanel[][]}. {@code JComponent} subclasses
 *       construct fine without a display, so the whole simulation can be driven headless.
 * </ol>
 */
public final class TestSupport {

    private TestSupport() {}

    public static final int ROWS = 6;
    public static final int COLS = 9;

    /** Every grid offset, in the row-major order the simulator uses. */
    public static final int[][] CELLS = cells();

    private static int[][] cells() {
        List<int[]> out = new ArrayList<>(ROWS * COLS);
        for (int row = 0; row < ROWS; row++) {
            for (int col = 0; col < COLS; col++) {
                out.add(new int[] {row, col});
            }
        }
        return out.toArray(new int[0][]);
    }

    /** Restores every process-wide configuration flag to the GUI's default state. */
    public static void resetGlobalConfig() {
        FuelRodBridge.setGT509(false);
        FuelRodBridge.setGTNH(false);
        ReflectorBridge.setMcVersion("1.12.2");
        MaterialsList.setUseUfcForCoolantCells(false);
        MaterialsList.setExpandAdvancedAlloy(false);
        MaterialsList.setGTVersion("none");
    }

    /**
     * Bridges to the package-private-in-practice static setters. They are public API, but
     * keeping the reflective-free indirection in one place makes it obvious at a glance which
     * globals the suite mutates.
     */
    public static final class FuelRodBridge {
        private FuelRodBridge() {}

        static void setGT509(boolean value) {
            Ic2ExpReactorPlanner.components.FuelRod.setGT509Behavior(value);
        }

        static void setGTNH(boolean value) {
            Ic2ExpReactorPlanner.components.FuelRod.setGTNHBehavior(value);
        }
    }

    public static final class ReflectorBridge {
        private ReflectorBridge() {}

        static void setMcVersion(String value) {
            Ic2ExpReactorPlanner.components.Reflector.setMcVersion(value);
        }
    }

    // ------------------------------------------------------------------ reactor building

    /** Places a component, returning the placed instance. */
    public static ReactorItem place(Reactor reactor, int row, int col, String baseName) {
        ReactorItem component = ComponentFactory.createComponent(baseName);
        if (component == null) {
            throw new IllegalArgumentException("unknown component: " + baseName);
        }
        reactor.setComponentAt(row, col, component);
        return component;
    }

    /** Places several components in one call, laid out row-major. */
    public static Reactor build(String... baseNames) {
        Reactor reactor = new Reactor();
        int i = 0;
        for (int[] cell : CELLS) {
            if (i >= baseNames.length) {
                break;
            }
            place(reactor, cell[0], cell[1], baseNames[i++]);
        }
        return reactor;
    }

    /**
     * Builds a reactor from a full 54-slot picture, using {@code null} for empty slots.
     *
     * <p>Row 0 first, then row 1, and so on; a literal 6 rows of 9 strings reads far better in a
     * test body than 54 sequential {@code place()} calls.
     */
    public static Reactor buildGrid(String[][] rows) {
        Reactor reactor = new Reactor();
        for (int row = 0; row < rows.length; row++) {
            for (int col = 0; col < rows[row].length; col++) {
                if (rows[row][col] != null) {
                    place(reactor, row, col, rows[row][col]);
                }
            }
        }
        return reactor;
    }

    /** All non-null components of a reactor, in row-major order. */
    public static List<ReactorItem> componentsOf(Reactor reactor) {
        List<ReactorItem> out = new ArrayList<>();
        for (int[] cell : CELLS) {
            ReactorItem component = reactor.getComponentAt(cell[0], cell[1]);
            if (component != null) {
                out.add(component);
            }
        }
        return out;
    }

    /**
     * Surrounds a component at (row, col) with the given neighbour type in all four orthogonal
     * directions. Used to drive the "how many neutrons does this rod see" axis of the fuel rod
     * formulas from 0 to 4.
     */
    public static void surroundWith(Reactor reactor, int row, int col, String baseName) {
        reactor.setComponentAt(row - 1, col, ComponentFactory.createComponent(baseName));
        reactor.setComponentAt(row + 1, col, ComponentFactory.createComponent(baseName));
        reactor.setComponentAt(row, col - 1, ComponentFactory.createComponent(baseName));
        reactor.setComponentAt(row, col + 1, ComponentFactory.createComponent(baseName));
    }

    /** Number of orthogonal neighbours of (row, col) that are present and unbroken. */
    public static int liveNeighbourCount(Reactor reactor, int row, int col) {
        int n = 0;
        int[][] deltas = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
        for (int[] d : deltas) {
            ReactorItem neighbour = reactor.getComponentAt(row + d[0], col + d[1]);
            if (neighbour != null && !neighbour.isBroken()) {
                n++;
            }
        }
        return n;
    }

    // ------------------------------------------------------------------ simulation driving

    /** Everything a headless simulation run produces. */
    public static final class SimResult {
        public final SimulationData data;
        public final String outputText;
        public final int reactorTicks;

        SimResult(SimulationData data, String outputText, int reactorTicks) {
            this.data = data;
            this.outputText = outputText;
            this.reactorTicks = reactorTicks;
        }

        public boolean producedData() {
            return data != null;
        }
    }

    /** Runs a simulation to completion on the calling thread's reactor copy. */
    public static SimResult simulate(Reactor reactor) throws Exception {
        return simulate(reactor, null);
    }

    /**
     * Runs a simulation on a private copy of {@code design} so the caller's reactor is left
     * untouched (the simulator mutates component heat and damage in place).
     */
    public static SimResult simulate(Reactor design, File csvFile) throws Exception {
        Reactor simReactor = new Reactor();
        simReactor.setCode(design.getCode());

        // JTextArea/JPanel are JComponents, so they construct fine with no display attached.
        JTextArea output = new JTextArea(5, 20);
        output.setEditable(false);
        JPanel[][] panels = new JPanel[ROWS][COLS];
        for (int row = 0; row < ROWS; row++) {
            for (int col = 0; col < COLS; col++) {
                panels[row][col] = new JPanel();
            }
        }

        AutomationSimulator simulator = new AutomationSimulator(simReactor, output, panels, csvFile, -1);
        simulator.execute();
        simulator.get(); // blocks for doInBackground + done()
        String text = awaitCompletion(output);

        SimulationData data = simulator.getData();
        int ticks = data == null ? 0 : data.totalReactorTicks;
        return new SimResult(data, text, ticks);
    }

    /**
     * Waits until the simulator's whole report has been rendered into {@code output}.
     *
     * <p>{@code SwingWorker.get()} only waits for the background computation; the {@code publish}
     * batches it produced are posted to the event queue separately and can still be in flight
     * afterwards, so a single {@code invokeAndWait} is not enough to see the full text. The last
     * thing {@code doInBackground} publishes is the elapsed-time line, so we wait for the stable
     * prefix of that bundle entry -- taking it from the bundle rather than hard-coding it keeps
     * this working under a translated locale.
     */
    public static String awaitCompletion(final JTextArea output) throws Exception {
        final String marker = BundleHelper.getI18n("Simulation.ElapsedTime").split("%")[0];
        final StringBuilder seen = new StringBuilder();
        long deadline = System.currentTimeMillis() + 60000L;
        while (System.currentTimeMillis() < deadline) {
            SwingUtilities.invokeAndWait(new Runnable() {
                @Override
                public void run() {
                    seen.setLength(0);
                    seen.append(output.getText());
                }
            });
            if (seen.indexOf(marker) >= 0) {
                return seen.toString();
            }
            Thread.sleep(5L);
        }
        throw new IllegalStateException("the simulator's report never completed; got: " + seen);
    }

    /** Reads a file written by the simulator's CSV output. */
    public static List<String> readLines(File file) throws IOException {
        return Files.readAllLines(file.toPath(), StandardCharsets.UTF_8);
    }

    // ------------------------------------------------------------------ text parsing

    /** Counts lines the Java 8 way (String.lines() is Java 11+). */
    public static int countLines(String text) {
        return text.isEmpty() ? 0 : text.split("\\r?\\n", -1).length - 1;
    }

    /**
     * Parses a {@link MaterialsList#toString()} rendering back into material name to quantity.
     *
     * <p>Both {@code getMaterials()} and {@code getComponentList()} <i>aggregate</i> rather than
     * listing per component, so the rendering is a set of {@code "<count> <name>"} lines. Tests
     * assert on the parsed quantities instead of on line counts or string lengths, which would be
     * brittle across locale and formatting changes.
     */
    public static java.util.Map<String, Double> parseMaterialList(String rendered) {
        java.util.Map<String, Double> out = new java.util.LinkedHashMap<>();
        for (String line : rendered.split("\\r?\\n")) {
            if (line.trim().isEmpty()) {
                continue;
            }
            int split = line.indexOf(' ');
            if (split < 0) {
                throw new IllegalArgumentException("unparseable materials line: " + line);
            }
            double count = Double.parseDouble(line.substring(0, split).trim().replace(",", ""));
            out.put(line.substring(split + 1).trim(), count);
        }
        return out;
    }

    // ------------------------------------------------------------------ assertions

    /** Absolute-tolerance double comparison, for the many heat/EU accumulations in this codebase. */
    public static void assertClose(double expected, double actual, double tolerance) {
        assertClose(expected, actual, tolerance, "values differ");
    }

    public static void assertClose(double expected, double actual, String what) {
        assertClose(expected, actual, 1e-6, what);
    }

    public static void assertClose(double expected, double actual, double tolerance, String what) {
        if (Math.abs(expected - actual) > tolerance) {
            throw new AssertionError(
                    what + ": expected " + expected + " but was " + actual + " (tolerance " + tolerance + ")");
        }
    }
}