package Ic2ExpReactorPlanner.corpus;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Reads, writes and diffs the corpus baseline.
 *
 * <p>The baseline lives at {@code testResources/corpus-baseline.txt} — a committed, plain-text
 * file so that reviewing a change is {@code git diff} on a text file rather than a binary blob.
 * One line per design, fields in {@link CorpusRunner#FIELDS} order, delimited by {@code |}.
 */
public final class BaselineStore {

    private BaselineStore() {}

    /** Project-relative location. Read as a classpath resource, written on disk. */
    public static final String RESOURCE = "/corpus-baseline.txt";
    public static final Path FILE = Paths.get("testResources", "corpus-baseline.txt");

    private static final String MAGIC = "# erp-corpus-baseline v1";

    // ------------------------------------------------------------------ read / write

    public static String render(List<CorpusRunner.Result> results) {
        StringBuilder out = new StringBuilder(results.size() * 320);
        out.append(MAGIC).append('\n');
        out.append("# One line per design. '|'-delimited fields, in this order:\n");
        out.append("# ").append(String.join(" | ", CorpusRunner.FIELDS)).append('\n');
        out.append("# Doubles are %.6f in Locale.US. MAXINT means \"never reached\".\n");
        out.append("# The reportSha is the first 8 bytes of the SHA-256 of the run report with the\n");
        out.append("# wall-clock line removed, so per-component figures are covered too.\n");
        out.append("# Regenerate deliberately with: ./gradlew test -Derp.writeBaseline=true\n");
        out.append("# ").append(results.size()).append(" designs.\n");
        for (CorpusRunner.Result result : results) {
            out.append(result.toLine()).append('\n');
        }
        return out.toString();
    }

    public static void write(String content) throws IOException {
        Files.createDirectories(FILE.getParent());
        Files.write(FILE, content.getBytes(StandardCharsets.UTF_8));
    }

    /** Reads the committed baseline, as an id to line map in file order. */
    public static Map<String, String> read() throws IOException {
        if (!Files.exists(FILE)) {
            throw new IOException("corpus baseline is missing: " + FILE.toAbsolutePath()
                    + "\nGenerate it with: ./gradlew test -Derp.writeBaseline=true");
        }
        return parse(new String(Files.readAllBytes(FILE), StandardCharsets.UTF_8));
    }

    static Map<String, String> parse(String content) {
        Map<String, String> byId = new LinkedHashMap<>();
        for (String line : content.split("\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#")) {
                continue;
            }
            int split = trimmed.indexOf('|');
            byId.put(trimmed.substring(0, split), trimmed);
        }
        return byId;
    }

    // ------------------------------------------------------------------ diffing

    /** The outcome of comparing a fresh run against the committed baseline. */
    public static final class Diff {
        public final List<String> changedIds = new ArrayList<>();
        /** ids present in the baseline but not in the run (design removed from the corpus). */
        public final List<String> missingIds = new ArrayList<>();
        /** ids present in the run but not in the baseline (design added to the corpus). */
        public final List<String> addedIds = new ArrayList<>();
        /** id to the names of the fields whose values differ. */
        public final Map<String, List<String>> changedFields = new LinkedHashMap<>();

        public boolean isEmpty() {
            return changedIds.isEmpty() && missingIds.isEmpty() && addedIds.isEmpty();
        }

        public int size() {
            return changedIds.size() + missingIds.size() + addedIds.size();
        }

        /**
         * The tags co-occurring on everything that moved, and how many of the changed designs
         * carry each. Useful for eyeballing, but note a design appears under every tag it has,
         * so a tag here does not by itself mean that tag's logic is what changed.
         */
        public Map<String, Integer> changedTags(Map<String, String> runById) {
            Map<String, Integer> counts = new LinkedHashMap<>();
            for (String id : changedIds) {
                for (String tag : tagsOf(runById.get(id))) {
                    counts.merge(tag, 1, Integer::sum);
                }
            }
            return counts;
        }

        /**
         * The containment signal: the tags that <em>every</em> changed design carries.
         *
         * <p>This is what tests a prediction. If the prediction for P0-1 was "only exchanger
         * designs move", and this returns exactly {@code [exchanger]}, the change stayed inside
         * the exchanger logic. A tag that appears on only some of the changed designs means
         * the change reached something you did not predict.
         */
        public Set<String> tagsOnEveryChangedDesign(Map<String, String> runById) {
            Set<String> common = null;
            for (String id : changedIds) {
                Set<String> tags = new LinkedHashSet<>(tagsOf(runById.get(id)));
                if (common == null) {
                    common = tags;
                } else {
                    common.retainAll(tags);
                }
            }
            return common == null ? new LinkedHashSet<>() : common;
        }

        /** Tags that appear on some, but not all, of the changed designs. */
        public Set<String> tagsOnSomeChangedDesigns(Map<String, String> runById) {
            Set<String> common = tagsOnEveryChangedDesign(runById);
            Set<String> partial = new LinkedHashSet<>();
            for (String tag : changedTags(runById).keySet()) {
                if (!common.contains(tag)) {
                    partial.add(tag);
                }
            }
            return partial;
        }

        private static List<String> tagsOf(String line) {
            List<String> tags = new ArrayList<>();
            if (line == null) {
                return tags;
            }
            String[] fields = line.split("\\|", -1);
            if (fields.length < 2) {
                return tags;
            }
            for (String tag : fields[1].split(",")) {
                if (!tag.isEmpty()) {
                    tags.add(tag);
                }
            }
            return tags;
        }
    }

    public static Diff compare(List<CorpusRunner.Result> results, Map<String, String> baseline) {
        Map<String, String> runById = new LinkedHashMap<>();
        for (CorpusRunner.Result result : results) {
            runById.put(result.id, result.toLine());
        }
        return compareLines(runById, baseline);
    }

    static Diff compareLines(Map<String, String> runById, Map<String, String> baseline) {
        Diff diff = new Diff();
        for (Map.Entry<String, String> entry : runById.entrySet()) {
            String expected = baseline.get(entry.getKey());
            if (expected == null) {
                diff.addedIds.add(entry.getKey());
                continue;
            }
            if (expected.equals(entry.getValue())) {
                continue;
            }
            diff.changedIds.add(entry.getKey());
            diff.changedFields.put(entry.getKey(), differingFields(expected, entry.getValue()));
        }
        for (String id : baseline.keySet()) {
            if (!runById.containsKey(id)) {
                diff.missingIds.add(id);
            }
        }
        return diff;
    }

    /** Names the fields that differ, so a failure says "tXplode changed" rather than dumping 35 columns. */
    static List<String> differingFields(String expectedLine, String actualLine) {
        String[] expected = expectedLine.split("\\|", -1);
        String[] actual = actualLine.split("\\|", -1);
        List<String> names = new ArrayList<>();
        int fields = Math.max(expected.length, actual.length);
        for (int i = 0; i < fields; i++) {
            String left = i < expected.length ? expected[i] : "<missing>";
            String right = i < actual.length ? actual[i] : "<missing>";
            if (!left.equals(right)) {
                String name = i < CorpusRunner.FIELDS.length ? CorpusRunner.FIELDS[i] : "field" + i;
                names.add(name + ": " + left + " -> " + right);
            }
        }
        return names;
    }
}
