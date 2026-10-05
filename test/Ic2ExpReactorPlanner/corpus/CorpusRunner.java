package Ic2ExpReactorPlanner.corpus;

import Ic2ExpReactorPlanner.AutomationSimulator;
import Ic2ExpReactorPlanner.BundleHelper;
import Ic2ExpReactorPlanner.Reactor;
import Ic2ExpReactorPlanner.SimulationData;
import Ic2ExpReactorPlanner.components.FuelRod;
import Ic2ExpReactorPlanner.components.GGFuelRod;
import Ic2ExpReactorPlanner.components.ReactorItem;
import java.beans.PropertyChangeEvent;
import java.beans.PropertyChangeListener;
import java.io.UnsupportedEncodingException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import javax.swing.JPanel;
import javax.swing.JTextArea;
import javax.swing.SwingUtilities;

/** Runs a corpus {@link Corpus.Design} to completion and captures everything worth diffing. */
public final class CorpusRunner {

    private CorpusRunner() {}

    /**
     * Everything about one simulated design that the baseline records.
     *
     * <p>The scalar fields are for a human reading a diff; {@link #reportHash} is for
     * completeness, because the report text carries per-component figures (peak vent cooling,
     * condensator cooling, max reached heat) that no scalar captures.
     */
    public static final class Result {
        public final String id;
        public final String tags;
        public final boolean completed;
        public final int totalReactorTicks;
        public final int timeToBurn;
        public final int timeToEvaporate;
        public final int timeToHurt;
        public final int timeToLava;
        public final int timeToXplode;
        public final int timeToBelow50;
        public final double minTemp;
        public final double maxTemp;
        public final int totalRodCount;
        public final double totalEUoutput;
        public final double avgEUoutput;
        public final double minEUoutput;
        public final double maxEUoutput;
        public final double totalHUoutput;
        public final double avgHUoutput;
        public final double minHUoutput;
        public final double maxHUoutput;
        public final int firstComponentBrokenTime;
        public final int firstComponentBrokenRow;
        public final int firstComponentBrokenCol;
        public final int firstRodDepletedTime;
        public final int firstRodDepletedRow;
        public final int firstRodDepletedCol;
        public final double prebreakTotalEUoutput;
        public final double predepleteTotalEUoutput;
        public final double hullHeating;
        public final double componentHeating;
        public final double hullCooling;
        public final double ventCooling;
        public final double hullCoolingCapacity;
        public final double ventCoolingCapacity;
        /** The report with the wall-clock line removed, so it is comparable run to run. */
        public final String report;
        public final String reportHash;

        private Result(String id, String tags, boolean completed, SimulationData data, String report) {
            this.id = id;
            this.tags = tags;
            this.completed = completed;
            this.report = report;
            this.reportHash = sha256(report);
            int missing = Integer.MAX_VALUE;
            this.totalReactorTicks = data == null ? 0 : data.totalReactorTicks;
            this.timeToBurn = data == null ? missing : data.timeToBurn;
            this.timeToEvaporate = data == null ? missing : data.timeToEvaporate;
            this.timeToHurt = data == null ? missing : data.timeToHurt;
            this.timeToLava = data == null ? missing : data.timeToLava;
            this.timeToXplode = data == null ? missing : data.timeToXplode;
            this.timeToBelow50 = data == null ? missing : data.timeToBelow50;
            this.minTemp = data == null ? 0 : data.minTemp;
            this.maxTemp = data == null ? 0 : data.maxTemp;
            this.totalRodCount = data == null ? 0 : data.totalRodCount;
            this.totalEUoutput = data == null ? 0 : data.totalEUoutput;
            this.avgEUoutput = data == null ? 0 : data.avgEUoutput;
            this.minEUoutput = data == null ? 0 : data.minEUoutput;
            this.maxEUoutput = data == null ? 0 : data.maxEUoutput;
            this.totalHUoutput = data == null ? 0 : data.totalHUoutput;
            this.avgHUoutput = data == null ? 0 : data.avgHUoutput;
            this.minHUoutput = data == null ? 0 : data.minHUoutput;
            this.maxHUoutput = data == null ? 0 : data.maxHUoutput;
            this.firstComponentBrokenTime = data == null ? missing : data.firstComponentBrokenTime;
            this.firstComponentBrokenRow = data == null ? -1 : data.firstComponentBrokenRow;
            this.firstComponentBrokenCol = data == null ? -1 : data.firstComponentBrokenCol;
            this.firstRodDepletedTime = data == null ? missing : data.firstRodDepletedTime;
            this.firstRodDepletedRow = data == null ? -1 : data.firstRodDepletedRow;
            this.firstRodDepletedCol = data == null ? -1 : data.firstRodDepletedCol;
            this.prebreakTotalEUoutput = data == null ? 0 : data.prebreakTotalEUoutput;
            this.predepleteTotalEUoutput = data == null ? 0 : data.predepleteTotalEUoutput;
            this.hullHeating = data == null ? 0 : data.hullHeating;
            this.componentHeating = data == null ? 0 : data.componentHeating;
            this.hullCooling = data == null ? 0 : data.hullCooling;
            this.ventCooling = data == null ? 0 : data.ventCooling;
            this.hullCoolingCapacity = data == null ? 0 : data.hullCoolingCapacity;
            this.ventCoolingCapacity = data == null ? 0 : data.ventCoolingCapacity;
        }

        /**
         * One pipe-delimited line, in a fixed field order, formatted locale-independently.
         * The header lives in {@link BaselineStore} so the two cannot drift apart.
         */
        public String toLine() {
            StringBuilder line = new StringBuilder(320);
            line.append(id);
            line.append('|').append(tags);
            line.append('|').append(completed ? 1 : 0);
            line.append('|').append(totalReactorTicks);
            line.append('|').append(timeToBurn);
            line.append('|').append(timeToEvaporate);
            line.append('|').append(timeToHurt);
            line.append('|').append(timeToLava);
            line.append('|').append(timeToXplode);
            line.append('|').append(timeToBelow50);
            line.append('|').append(fmt(minTemp));
            line.append('|').append(fmt(maxTemp));
            line.append('|').append(totalRodCount);
            line.append('|').append(fmt(totalEUoutput));
            line.append('|').append(fmt(avgEUoutput));
            line.append('|').append(fmt(minEUoutput));
            line.append('|').append(fmt(maxEUoutput));
            line.append('|').append(fmt(totalHUoutput));
            line.append('|').append(fmt(avgHUoutput));
            line.append('|').append(fmt(minHUoutput));
            line.append('|').append(fmt(maxHUoutput));
            line.append('|').append(firstComponentBrokenTime);
            line.append('|').append(firstComponentBrokenRow);
            line.append('|').append(firstComponentBrokenCol);
            line.append('|').append(firstRodDepletedTime);
            line.append('|').append(firstRodDepletedRow);
            line.append('|').append(firstRodDepletedCol);
            line.append('|').append(fmt(prebreakTotalEUoutput));
            line.append('|').append(fmt(predepleteTotalEUoutput));
            line.append('|').append(fmt(hullHeating));
            line.append('|').append(fmt(componentHeating));
            line.append('|').append(fmt(hullCooling));
            line.append('|').append(fmt(ventCooling));
            line.append('|').append(fmt(hullCoolingCapacity));
            line.append('|').append(fmt(ventCoolingCapacity));
            line.append('|').append(reportHash);
            return line.toString();
        }

        /**
         * Compact, locale-independent formatting.
         *
         * <p>{@code SimulationData} uses {@code Double.MAX_VALUE} as its "never recorded"
         * sentinel for the minimums, and {@code Integer.MAX_VALUE} for the threshold times.
         * Printing those with {@code %.6f} produces 309-digit numbers that make the baseline
         * unreadable, so anything beyond a plausible real value collapses to a short token.
         * Legitimate values here are EU/HU totals, bounded well under 1e12 even at the tick cap.
         */
        private static String fmt(double value) {
            if (Double.isNaN(value)) {
                return "nan";
            }
            if (Double.isInfinite(value)) {
                return value > 0 ? "inf" : "-inf";
            }
            if (Math.abs(value) >= 1e12) {
                return value > 0 ? "MAX" : "-MAX";
            }
            // Locale.US so the file is identical everywhere; %.6f catches any real change
            // while staying readable in a diff.
            return String.format(java.util.Locale.US, "%.6f", value);
        }

        @Override
        public String toString() {
            return id + " tags=" + tags + " ticks=" + totalReactorTicks + " xplode=" + timeToXplode
                    + " totalEU=" + fmt(totalEUoutput) + " maxEU=" + fmt(maxEUoutput) + " hash=" + reportHash;
        }
    }

    /** Field names, in the order {@link Result#toLine()} writes them. */
    public static final String[] FIELDS = {
        "id", "tags", "completed", "ticks", "tBurn", "tEvap", "tHurt", "tLava", "tXplode", "tBelow50",
        "minTemp", "maxTemp", "rods", "totalEU", "avgEU", "minEU", "maxEU",
        "totalHU", "avgHU", "minHU", "maxHU",
        "brkTime", "brkRow", "brkCol", "depTime", "depRow", "depCol",
        "prebreakEU", "predepleteEU", "hullHeat", "compHeat", "hullCool", "ventCool",
        "hullCoolCap", "ventCoolCap", "reportSha",
    };

    // ------------------------------------------------------------------ running

    /**
     * Simulates one design and captures its fingerprint.
     *
     * <p>Note how completion is detected: the {@code completed} property change is awaited via a
     * latch rather than reading {@code AutomationSimulator.getData()} after {@code get()}. That
     * is deliberate — {@code completed} is now volatile (CODE_REVIEW.md P1-2, fixed), but the latch
     * gives a real happens-before edge either way and does not depend on that fix, so the corpus
     * reads the same before and after it.
     */
    public static Result run(Corpus.Design design) throws Exception {
        FuelRod.setGT509Behavior(design.gt509);
        FuelRod.setGTNHBehavior(design.gtnh);
        try {
            // The simulator mutates component heat and damage, so hand it a private copy.
            Reactor simReactor = new Reactor();
            simReactor.setCode(design.reactor.getCode());
            simReactor.setMaxSimulationTicks(design.tickCap);

            JTextArea output = new JTextArea(5, 20);
            JPanel[][] panels = new JPanel[Corpus.ROWS][Corpus.COLS];
            for (int row = 0; row < Corpus.ROWS; row++) {
                for (int col = 0; col < Corpus.COLS; col++) {
                    panels[row][col] = new JPanel();
                }
            }

            final CountDownLatch done = new CountDownLatch(1);
            AutomationSimulator simulator = new AutomationSimulator(simReactor, output, panels, null, -1);
            simulator.addPropertyChangeListener(new PropertyChangeListener() {
                @Override
                public void propertyChange(PropertyChangeEvent evt) {
                    if ("completed".equals(evt.getPropertyName())) {
                        done.countDown();
                    }
                }
            });
            simulator.execute();
            if (!done.await(120, TimeUnit.SECONDS)) {
                throw new IllegalStateException(design.id + " did not finish within 120s");
            }
            simulator.get();
            String report = awaitReport(output);
            return new Result(design.id, design.tags, true, simulator.getData(), report);
        } finally {
            FuelRod.setGT509Behavior(false);
            FuelRod.setGTNHBehavior(false);
        }
    }

    /**
     * Simulates a design and hands back the reactor in its post-run state.
     *
     * <p>Used by the corpus self-checks, which need to inspect final component state (a
     * condensator's heat, say) rather than just the reported metrics.
     */
    public static Reactor simulateToCompletion(Corpus.Design design) throws Exception {
        FuelRod.setGT509Behavior(design.gt509);
        FuelRod.setGTNHBehavior(design.gtnh);
        try {
            Reactor simReactor = new Reactor();
            simReactor.setCode(design.reactor.getCode());
            simReactor.setMaxSimulationTicks(design.tickCap);

            JTextArea output = new JTextArea(5, 20);
            JPanel[][] panels = new JPanel[Corpus.ROWS][Corpus.COLS];
            for (int row = 0; row < Corpus.ROWS; row++) {
                for (int col = 0; col < Corpus.COLS; col++) {
                    panels[row][col] = new JPanel();
                }
            }
            final CountDownLatch done = new CountDownLatch(1);
            AutomationSimulator simulator = new AutomationSimulator(simReactor, output, panels, null, -1);
            simulator.addPropertyChangeListener(new PropertyChangeListener() {
                @Override
                public void propertyChange(PropertyChangeEvent evt) {
                    if ("completed".equals(evt.getPropertyName())) {
                        done.countDown();
                    }
                }
            });
            simulator.execute();
            if (!done.await(120, TimeUnit.SECONDS)) {
                throw new IllegalStateException(design.id + " did not finish within 120s");
            }
            return simReactor;
        } finally {
            FuelRod.setGT509Behavior(false);
            FuelRod.setGTNHBehavior(false);
        }
    }

    /** Waits for the whole report to be rendered, then strips the wall-clock line. */
    private static String awaitReport(final JTextArea output) throws Exception {
        final String marker = BundleHelper.getI18n("Simulation.ElapsedTime").split("%")[0];
        final StringBuilder seen = new StringBuilder();
        long deadline = System.currentTimeMillis() + 60_000L;
        while (System.currentTimeMillis() < deadline) {
            SwingUtilities.invokeAndWait(new Runnable() {
                @Override
                public void run() {
                    seen.setLength(0);
                    seen.append(output.getText());
                }
            });
            if (seen.indexOf(marker) >= 0) {
                return stripElapsedTime(seen.toString());
            }
            Thread.sleep(2L);
        }
        throw new IllegalStateException("report never completed: " + seen);
    }

    /**
     * Removes the one legitimately variable line. Everything else — including cooldown times and
     * per-component figures — is deterministic and must be preserved.
     */
    private static String stripElapsedTime(String report) {
        String marker = BundleHelper.getI18n("Simulation.ElapsedTime").split("%")[0];
        int start = report.indexOf(marker);
        if (start < 0) {
            return report;
        }
        int end = report.indexOf('\n', start);
        return report.substring(0, start) + (end < 0 ? "" : report.substring(end));
    }

    static String sha256(String text) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(text.getBytes("UTF-8"));
            StringBuilder hex = new StringBuilder(16);
            for (int i = 0; i < 8; i++) {
                hex.append(String.format("%02x", hash[i]));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException | UnsupportedEncodingException e) {
            throw new IllegalStateException("SHA-256 is required", e);
        }
    }

    /** Convenience for the self-check: the largest heat packet a rod hands to its only acceptor. */
    public static double packetFromRod(Reactor design) {
        for (int row = 0; row < Corpus.ROWS; row++) {
            for (int col = 0; col < Corpus.COLS; col++) {
                ReactorItem component = design.getComponentAt(row, col);
                if (component instanceof FuelRod) {
                    Reactor scratch = new Reactor();
                    scratch.setCode(design.getCode());
                    return ((FuelRod) scratch.getComponentAt(row, col)).generateHeat();
                }
            }
        }
        return 0;
    }
}
