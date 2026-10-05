package Ic2ExpReactorPlanner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@link WarningDisplay}: the seam that makes {@code Reactor}'s user-facing parse warnings
 * testable without a display.
 *
 * <p>This is P3-10 from {@code CODE_REVIEW.md}, which existed only because {@code setCode} used
 * to call {@code JOptionPane} from inside the model, forcing the code-workspace corpus to reach
 * a private method by reflection to dodge a {@code HeadlessException}.
 */
class WarningDisplayTest {

    private final List<String> captured = new ArrayList<>();

    @AfterEach
    void restoreDialog() {
        WarningDisplay.setSink(null);
    }

    private void capture() {
        WarningDisplay.setSink(new WarningDisplay.Sink() {
            @Override
            public void warn(String title, String message) {
                captured.add(title + "|" + message);
            }
        });
    }

    @Test
    @DisplayName("a captured warning carries the localised title and the message verbatim")
    void capturesTitleAndMessage() {
        capture();
        WarningDisplay.warn("Warning.Title", "something went wrong");
        assertEquals(1, captured.size(), "one warning");
        assertEquals("Warning.Title|something went wrong", captured.get(0));
    }

    @Test
    @DisplayName("setSink(null) restores the dialog, so a failed test cannot silence warnings forever")
    void nullRestoresTheDialog() {
        capture();
        WarningDisplay.warn("t", "captured");
        WarningDisplay.setSink(null);
        // Nothing installed, so this goes to the real dialog. In a headless JVM that is a
        // HeadlessException rather than a hang, which is a safe thing to assert on.
        boolean threw = false;
        try {
            WarningDisplay.warn("t", "not captured");
        } catch (java.awt.HeadlessException e) {
            threw = true;
        }
        assertTrue(threw, "the default sink still talks to JOptionPane, so it is genuinely restored");
        assertEquals(1, captured.size(), "and only the first warning was captured");
    }

    @Test
    @DisplayName("an unrecognised code warns instead of throwing, headlessly")
    void unrecognisedCodeWarns() {
        capture();
        Reactor reactor = new Reactor();
        reactor.setComponentAt(2, 2, ComponentFactory.createComponent("fuelRodUranium"));
        reactor.setCode("not a valid code at all!");

        assertEquals(1, captured.size(), "one warning: " + captured);
        assertTrue(
                captured.get(0).startsWith(BundleHelper.getI18n("Warning.Title")),
                "titled as a warning, got: " + captured.get(0));
        // The existing layout is left completely alone.
        assertNotNull(reactor.getComponentAt(2, 2), "the existing design survived");
    }

    @Test
    @DisplayName("an empty code warns nothing and changes nothing")
    void emptyCodeIsSilent() {
        capture();
        Reactor reactor = new Reactor();
        reactor.setCode("");
        assertTrue(captured.isEmpty(), "an empty paste is not worth a dialog, got: " + captured);
    }

    /**
     * The reason this seam exists. A Talonius code for a grid containing components this planner
     * does not have produces a warning, and before P3-10 reaching it required reflection to
     * avoid a {@code HeadlessException}.
     */
    @Test
    @DisplayName("a Talonius code with unrecognised items warns, with no reflection and no display")
    void taloniusWarningsAreCapturable() {
        capture();
        // Cell 54 (the last one read, which lands at row 0 column 0) starts at bit
        // 10 + 7*53, because handleTaloniusCode reads 10 bits of initial heat first.
        // 61 is not a component the old planner knew, so it must produce a warning.
        java.math.BigInteger value = java.math.BigInteger.valueOf(61).shiftLeft(10 + 7 * 53);
        Reactor reactor = new Reactor();
        reactor.setCode(value.toString(36));

        assertFalse(captured.isEmpty(), "expected a warning about the unrecognised item");
        assertTrue(
                captured.get(0).startsWith(BundleHelper.getI18n("Warning.Title")),
                "titled as a warning, got: " + captured.get(0));
        assertTrue(captured.get(0).contains("61"), "and names the unrecognised id: " + captured.get(0));
    }

    @Test
    @DisplayName("a recognised Talonius code loads silently")
    void recognisedTaloniusCodeIsSilent() {
        capture();
        // value 1 in the last cell read is a uranium rod.
        java.math.BigInteger value = java.math.BigInteger.ONE.shiftLeft(10 + 7 * 53);
        Reactor reactor = new Reactor();
        reactor.setCode(value.toString(36));

        assertTrue(captured.isEmpty(), "nothing to warn about, got: " + captured);
        assertNotNull(reactor.getComponentAt(0, 0), "and the rod was placed");
        assertEquals(
                "fuelRodUranium", reactor.getComponentAt(0, 0).baseName, "as a uranium rod");
    }

    @Test
    @DisplayName("the dialog sink is the default, so behaviour is unchanged until a test opts in")
    void defaultSinkIsTheDialog() {
        // Nothing installed: warn() must reach JOptionPane, which is HeadlessException headless.
        boolean threw = false;
        try {
            WarningDisplay.warn("t", "m");
        } catch (java.awt.HeadlessException e) {
            threw = true;
        }
        assertTrue(threw, "the default sink is a real dialog");
    }

    @Test
    @DisplayName("installing a sink twice replaces it rather than chaining")
    void setSinkReplaces() {
        final int[] firstCount = {0};
        WarningDisplay.setSink(new WarningDisplay.Sink() {
            @Override
            public void warn(String title, String message) {
                firstCount[0]++;
            }
        });
        capture();
        WarningDisplay.warn("t", "m");
        assertEquals(0, firstCount[0], "the first sink was replaced, not chained to");
        assertEquals(1, captured.size(), "the second sink received it");
    }

    @Test
    @DisplayName("the sink is a static field, so it must be volatile for cross-thread visibility")
    void sinkIsVolatile() throws Exception {
        java.lang.reflect.Field f = WarningDisplay.class.getDeclaredField("sink");
        assertTrue(
                java.lang.reflect.Modifier.isVolatile(f.getModifiers()),
                "written on the event thread and read wherever a code is parsed");
        assertTrue(java.lang.reflect.Modifier.isStatic(f.getModifiers()), "and it is process-wide");
        f.setAccessible(true);
        WarningDisplay.setSink(null);
        assertNotNull(f.get(null), "restoring null puts the dialog back, never null");
        assertSame(
                WarningDisplay.class,
                f.get(null).getClass().getEnclosingClass(),
                "the default is an inner instance of WarningDisplay itself");
    }
}
