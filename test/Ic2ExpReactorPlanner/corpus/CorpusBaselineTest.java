package Ic2ExpReactorPlanner.corpus;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import Ic2ExpReactorPlanner.Reactor;
import Ic2ExpReactorPlanner.components.Condensator;
import Ic2ExpReactorPlanner.components.Exchanger;
import Ic2ExpReactorPlanner.components.FuelRod;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

/**
 * The corpus regression gate.
 *
 * <p>Simulates every design in {@link Corpus} and compares the full fingerprint against the
 * committed {@link BaselineStore#FILE}. This is the instrument that makes a calculation change
 * reviewable: before touching a formula, write down which designs you expect to move, then let
 * this test tell you whether the set matches.
 *
 * <p><b>This test is expected to fail whenever a calculation change is intentional.</b> That is
 * the point — it is an alarm, not an assertion of correctness. When it fires:
 *
 * <ol>
 *   <li>Read the "changed fields" in the failure message. If they are the ones you meant to
 *       move, the change did what you thought.
 *   <li>Read the tag histogram. If designs outside your predicted category moved, you have
 *       touched a shared path — investigate before regenerating.
 *   <li>Regenerate deliberately and commit the diff:
 *       {@code ./gradlew test -Derp.writeBaseline=true}
 * </ol>
 *
 * <p>Never regenerate without reading the diff first, or the baseline stops being a guard.
 */
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class CorpusBaselineTest {

    private static List<Corpus.Design> designs;
    private static List<CorpusRunner.Result> results;
    private static long elapsedMillis;

    @BeforeAll
    static void runCorpus() throws Exception {
        designs = Corpus.all();
        results = new ArrayList<>(designs.size());
        long start = System.nanoTime();
        for (Corpus.Design design : designs) {
            results.add(CorpusRunner.run(design));
        }
        elapsedMillis = (System.nanoTime() - start) / 1_000_000L;
    }

    @AfterAll
    static void reportTiming() {
        System.out.println("[corpus] " + results.size() + " designs simulated in " + elapsedMillis + " ms");
    }

    // ------------------------------------------------------------------ the gate

    @Test
    @Order(1)
    @DisplayName("every corpus design matches the committed baseline")
    void matchesBaseline() throws IOException {
        if (Boolean.getBoolean("erp.writeBaseline")) {
            BaselineStore.write(BaselineStore.render(results));
            System.out.println("[corpus] wrote " + results.size() + " designs to " + BaselineStore.FILE);
            return;
        }

        Map<String, String> baseline = BaselineStore.read();
        Map<String, String> runById = indexById(results);
        BaselineStore.Diff diff = BaselineStore.compare(results, baseline);

        if (diff.isEmpty()) {
            assertEquals(results.size(), baseline.size(), "no designs were added or removed");
            return;
        }

        fail(describeDiff(diff, runById));
    }

    // ------------------------------------------------------------------ corpus self-checks

    @Test
    @Order(2)
    @DisplayName("the corpus is deterministic: regenerating it yields the same designs")
    void corpusIsDeterministic() {
        List<Corpus.Design> again = Corpus.all();
        assertEquals(designs.size(), again.size(), "design count is stable");
        for (int i = 0; i < designs.size(); i++) {
            assertEquals(designs.get(i).id, again.get(i).id, "design " + i + " id is stable");
            assertEquals(designs.get(i).tags, again.get(i).tags, "design " + i + " tags are stable");
            assertEquals(
                    designs.get(i).reactor.getCode(),
                    again.get(i).reactor.getCode(),
                    "design " + i + " (" + designs.get(i).id + ") layout is stable");
        }
    }

    @Test
    @Order(3)
    @DisplayName("the corpus is broad enough to be worth diffing")
    void corpusIsBroadEnough() {
        assertTrue(designs.size() >= 250, "expected 250+ designs, got " + designs.size());
        int generated = 0;
        int withExchanger = 0;
        int withCondensator = 0;
        int exploding = 0;
        for (Corpus.Design design : designs) {
            if (design.id.startsWith("gen-")) {
                generated++;
            }
            if (design.tags.contains("exchanger")) {
                withExchanger++;
            }
            if (design.tags.contains("condensator")) {
                withCondensator++;
            }
        }
        for (CorpusRunner.Result result : results) {
            if (result.timeToXplode != Integer.MAX_VALUE) {
                exploding++;
            }
        }
        assertEquals(200, generated, "the generated count is part of the baseline's identity");
        assertTrue(withExchanger >= 6, "P0-1 needs several exchanger designs, got " + withExchanger);
        assertTrue(withCondensator >= 6, "P0-2 needs several condensator designs, got " + withCondensator);
        assertTrue(exploding >= 20, "the corpus must include designs that actually explode");
    }

    /**
     * The P0-2 designs only reach the overfill and negative regimes if the rods still make the
     * heat the builders assumed. If someone retunes a rod, this fails and the corpus notes
     * (and the baseline) need revisiting.
     */
    @Test
    @Order(4)
    @DisplayName("the P0-2 corpus designs still reach the intended heat-packet regimes")
    void condensatorPacketsReachEveryRegime() throws Exception {
        // RSH holds 20 000, so the interesting boundaries are 10 000 (overfill starts) and
        // 20 000 (the negative mode). These are the packet sizes the named designs rely on.
        assertEquals(4, (int) packetFor("named-condensator-small"), "bare rod");
        assertEquals(336, (int) packetFor("named-condensator-overfill"), "quad uranium, 3 reflectors");
        assertEquals(5376, (int) packetFor("named-condensator-overfill-big"), "quad liquid uranium");
        assertEquals(26880, (int) packetFor("named-condensator-over-capacity"), "The Core exceeds the RSH capacity");

        // And confirm the regimes are actually reached by a live simulation, because that is the
        // property P0-2 is about.
        assertOverfills("named-condensator-overfill", true);
        assertGoesNegative("named-condensator-over-capacity", true);
    }

    /**
     * The exchanger designs in the corpus are <em>representative</em>, not cascade-band cases:
     * an exchanger reaches equilibrium within a couple of ticks, so an initial charge washes out
     * and five designs differing only in initial charge produce byte-identical results. The band
     * table is pinned by {@code ExchangerTest} instead. What this test guards is that the corpus
     * covers all four exchanger types, which is what P0-1 needs.
     */
    @Test
    @Order(5)
    @DisplayName("the corpus covers all four exchanger types")
    void everyExchangerTypeIsCovered() {
        Set<String> covered = new LinkedHashSet<>();
        for (Corpus.Design design : designs) {
            if (!design.tags.contains("exchanger")) {
                continue;
            }
            for (int row = 0; row < Corpus.ROWS; row++) {
                for (int col = 0; col < Corpus.COLS; col++) {
                    if (design.reactor.getComponentAt(row, col) instanceof Exchanger) {
                        covered.add(((Exchanger) design.reactor.getComponentAt(row, col)).baseName);
                    }
                }
            }
        }
        assertEquals(
                new LinkedHashSet<>(Arrays.asList(
                        "heatExchanger", "advancedHeatExchanger", "coreHeatExchanger", "componentHeatExchanger")),
                covered,
                "P0-1 affects three of these four; all must be represented");
    }

    // ------------------------------------------------------------------ helpers

    private static void assertClose(double expected, double actual, double tolerance) {
        assertTrue(
                Math.abs(expected - actual) <= tolerance,
                "expected " + expected + " +/- " + tolerance + " but was " + actual);
    }

    private static Corpus.Design design(String id) {
        for (Corpus.Design design : designs) {
            if (design.id.equals(id)) {
                return design;
            }
        }
        throw new IllegalArgumentException("no such corpus design: " + id);
    }

    private static double packetFor(String id) {
        return CorpusRunner.packetFromRod(design(id).reactor);
    }

    private static double sumFor(String id) {
        Reactor design = design(id).reactor;
        for (int row = 0; row < Corpus.ROWS; row++) {
            for (int col = 0; col < Corpus.COLS; col++) {
                if (design.getComponentAt(row, col) instanceof Exchanger) {
                    Exchanger exchanger = (Exchanger) design.getComponentAt(row, col);
                    return exchanger.getCurrentHeat() * 50.0 / exchanger.getMaxHeat();
                }
            }
        }
        throw new IllegalStateException(id + " has no exchanger");
    }

    /** Runs one design and inspects the condensator's final heat against its capacity. */
    private static void assertOverfills(String id, boolean expected) throws Exception {
        double maxHeat = condMax(id);
        double seen = condHeatAfterRun(id);
        if (expected) {
            assertTrue(seen > maxHeat, id + " should have overshot its capacity, but topped out at " + seen);
        } else {
            assertTrue(seen <= maxHeat, id + " should not have overshot, but reached " + seen);
        }
    }

    private static void assertGoesNegative(String id, boolean expected) throws Exception {
        double seen = condHeatAfterRun(id);
        if (expected) {
            assertTrue(seen < 0, id + " should have gone negative, but read " + seen);
        } else {
            assertTrue(seen >= 0, id + " should not have gone negative, but read " + seen);
        }
    }

    /** Re-runs a design and reads the condensator heat left behind at the end of the run. */
    private static double condHeatAfterRun(String id) throws Exception {
        Reactor simReactor = CorpusRunner.simulateToCompletion(design(id));
        for (int row = 0; row < Corpus.ROWS; row++) {
            for (int col = 0; col < Corpus.COLS; col++) {
                if (simReactor.getComponentAt(row, col) instanceof Condensator) {
                    return ((Condensator) simReactor.getComponentAt(row, col)).getCurrentHeat();
                }
            }
        }
        throw new IllegalStateException(id + " has no condensator");
    }

    private static double condMax(String id) {
        Reactor design = design(id).reactor;
        for (int row = 0; row < Corpus.ROWS; row++) {
            for (int col = 0; col < Corpus.COLS; col++) {
                if (design.getComponentAt(row, col) instanceof Condensator) {
                    return design.getComponentAt(row, col).getMaxHeat();
                }
            }
        }
        throw new IllegalStateException(id + " has no condensator");
    }

    // ------------------------------------------------------------------ failure message

    private static String describeDiff(BaselineStore.Diff diff, Map<String, String> runById) {
        StringBuilder out = new StringBuilder(4000);
        out.append('\n');
        out.append("Corpus baseline mismatch: ")
                .append(diff.size())
                .append(" of ")
                .append(runById.size())
                .append(" design(s) differ from testResources/corpus-baseline.txt\n");

        // The containment signal, first, because it is what tests your prediction.
        Set<String> onEvery = diff.tagsOnEveryChangedDesign(runById);
        Set<String> onSome = diff.tagsOnSomeChangedDesigns(runById);
        out.append('\n');
        if (diff.changedIds.isEmpty()) {
            out.append("Nothing moved, so the design set itself changed.\n");
        } else {
            out.append("EVERY changed design is tagged: ")
                    .append(onEvery.isEmpty() ? "(none — they have nothing in common)" : onEvery)
                    .append('\n');
            out.append("SOME changed designs also carry: ")
                    .append(onSome.isEmpty() ? "(none)" : onSome)
                    .append('\n');
            out.append("  -> If your prediction was \"only <tag> designs move\" and that tag is not\n");
            out.append("     in the EVERY line, the change reached something you did not predict.\n");
        }

        out.append('\n');
        out.append("Meant to move? Regenerate deliberately with:\n");
        out.append("    ./gradlew test -Derp.writeBaseline=true\n");
        out.append("Not meant to move anything? This is a regression.\n");

        if (!diff.changedTags(runById).isEmpty()) {
            out.append('\n').append("Tags on changed designs (a design appears under every tag it has,\n");
            out.append("so this counts co-occurrence, not causation):\n");
            for (Map.Entry<String, Integer> entry : diff.changedTags(runById).entrySet()) {
                out.append(String.format("    %-14s %d of %d%n", entry.getKey(), entry.getValue(), diff.changedIds.size()));
            }
        }
        if (!diff.addedIds.isEmpty()) {
            out.append('\n').append("Added to the corpus (no baseline entry): ").append(diff.addedIds).append('\n');
        }
        if (!diff.missingIds.isEmpty()) {
            out.append('\n').append("Removed from the corpus (baseline has no run): ").append(diff.missingIds).append('\n');
        }

        // List every changed design, but cap the per-design field detail to keep the message readable.
        int detailed = 0;
        for (String id : diff.changedIds) {
            out.append('\n').append("  ").append(id).append("  tags=").append(tagOf(runById, id)).append('\n');
            if (detailed++ < 12) {
                for (String field : diff.changedFields.getOrDefault(id, new ArrayList<>())) {
                    out.append("      ").append(field).append('\n');
                }
            }
        }
        if (diff.changedIds.size() > detailed) {
            out.append("\n  ... and ").append(diff.changedIds.size() - detailed).append(" more (run with -Derp.writeBaseline=true to inspect).\n");
        }
        return out.toString();
    }

    private static String tagOf(Map<String, String> runById, String id) {
        String line = runById.get(id);
        if (line == null) {
            return "?";
        }
        String[] fields = line.split("\\|", -1);
        return fields.length > 1 ? fields[1] : "?";
    }

    private static Map<String, String> indexById(List<CorpusRunner.Result> results) {
        Map<String, String> map = new java.util.LinkedHashMap<>();
        for (CorpusRunner.Result result : results) {
            map.put(result.id, result.toLine());
        }
        return map;
    }
}
