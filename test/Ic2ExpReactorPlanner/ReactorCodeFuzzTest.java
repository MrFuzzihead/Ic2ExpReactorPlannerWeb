package Ic2ExpReactorPlanner;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Property tests over {@code Reactor.setCode}: the parser is the one place a bad paste could
 * leave the reactor half-updated, so the invariant under fuzzing is that {@code setCode} is
 * atomic. Every input, valid or not, must end in one of exactly two states — the design that
 * existed before the call, or a whole design that re-encodes to itself. A blend of the two is
 * what P1-1 was, and no single hand-written case finds it.
 *
 * <p>The inputs are generated rather than typed: truncations, single-character deletions and
 * substitutions, and edge junk. Generation is deterministic, so a failure is reproducible from
 * the seed design alone.
 */
class ReactorCodeFuzzTest {

    @BeforeEach
    @AfterEach
    void resetGlobals() {
        TestSupport.resetGlobalConfig();
    }

    /** A distinctive design, so "the reactor is unchanged" is a claim with content in it. */
    private Reactor populated() {
        Reactor reactor = new Reactor();
        TestSupport.place(reactor, 2, 2, "quadFuelRodUranium");
        reactor.setComponentAt(0, 8, ComponentFactory.createComponent("reactorPlating"));
        reactor.setFluid(true);
        reactor.setPulsed(true);
        reactor.setOnPulse(1111);
        reactor.setCurrentHeat(2222);
        reactor.setMaxSimulationTicks(3333);
        return reactor;
    }

    private int unchanged;
    private int applied;

    /**
     * WarningDisplay's default sink opens a GUI dialog, which throws {@code HeadlessException} in
     * a headless JVM — and {@code setCode} calls {@code warn} from inside its own {@code catch}, so
     * an unrecognizable input would otherwise escape the property check as a crash. The sink is
     * swapped for a collector, exactly as {@code ReactorCodeSerializationTest.Malformed} does.
     */
    private final List<String> warnings = new ArrayList<>();

    private void captureWarnings() {
        WarningDisplay.setSink(new WarningDisplay.Sink() {
            @Override
            public void warn(String title, String message) {
                warnings.add(message);
            }
        });
    }

    private void releaseWarnings() {
        WarningDisplay.setSink(null);
        warnings.clear();
    }

    /**
     * The atomicity property, checked for one input.
     *
     * @param description what the input is, so a failure names the generated case
     * @param code the generated input
     */
    private void assertAtomic(String description, String code) {
        Reactor reactor = populated();
        String before = reactor.getCode();
        int maxHeatBefore = (int) reactor.getMaxHeat();

        assertDoesNotThrow(() -> reactor.setCode(code), description + " must not throw out of setCode");

        String after = reactor.getCode();
        if (after.equals(before)) {
            // Refused whole: nothing at all may have moved, including the max heat that plating
            // derives on contact.
            assertEquals(maxHeatBefore, (int) reactor.getMaxHeat(), description + " must leave derived max heat alone");
            assertEquals(2222, (int) reactor.getCurrentHeat(), description + " must leave the heat alone");
            assertEquals(3333, reactor.getMaxSimulationTicks(), description + " must leave the tick limit alone");
            assertTrue(reactor.isPulsed(), description + " must leave the mode flags alone");
            unchanged++;
            return;
        }

        // The other allowed state is a whole design, and "whole" means the code it just produced
        // reads back as itself: a layout that applied without the flags, or flags without the
        // plating, would fail here rather than silently shipping a half-parsed reactor.
        applied++;
        int maxHeatAfter = (int) reactor.getMaxHeat();
        Reactor reread = new Reactor();
        assertDoesNotThrow(() -> reread.setCode(after), description + " must produce a code that reads back");
        assertEquals(after, reread.getCode(), description + " must land on a design that re-encodes to itself");
        assertEquals(
                TestSupport.componentsOf(reactor).size(),
                TestSupport.componentsOf(reread).size(),
                description + " must land on a design whose layout reads back");
        assertEquals(
                maxHeatAfter,
                (int) reread.getMaxHeat(),
                description + " must land on a design whose derived max heat reads back");
    }

    // ================================================================== generated families

    @Test
    @DisplayName("every prefix of a valid code ends in one of the two whole states")
    void truncations() {
        captureWarnings();
        try {
            String code = populated().getCode();
            for (int i = 0; i < code.length(); i++) {
                assertAtomic("prefix of length " + i, code.substring(0, i));
            }
            assertEquals(code.length(), unchanged + applied, "every truncation was checked");
            assertTrue(unchanged > 0, "at least some truncations are refused");
        } finally {
            releaseWarnings();
        }
    }

    @Test
    @DisplayName("deleting one character never leaves a blend")
    void deletions() {
        captureWarnings();
        try {
            String code = populated().getCode();
            for (int i = 0; i < code.length(); i++) {
                assertAtomic("character deleted at " + i, code.substring(0, i) + code.substring(i + 1));
            }
            assertEquals(code.length(), unchanged + applied, "every deletion was checked");
        } finally {
            releaseWarnings();
        }
    }

    @Test
    @DisplayName("substituting one character never leaves a blend")
    void substitutions() {
        captureWarnings();
        try {
            String[] alphabet = {"!", "(", ")", ",", "|", "+", "=", " ", "\t", "0", "z", "Z", "\u00e9", "\u4e09"};
            String code = populated().getCode();
            for (int i = 0; i < code.length(); i++) {
                for (int j = 0; j < alphabet.length; j++) {
                    assertAtomic(
                            "position " + i + " set to '" + alphabet[j] + "'",
                            code.substring(0, i) + alphabet[j] + code.substring(i + 1));
                }
            }
            assertEquals(code.length() * alphabet.length, unchanged + applied, "every substitution was checked");
            assertTrue(applied > 0, "some substitutions still land on a whole design");
        } finally {
            releaseWarnings();
        }
    }

    @Test
    @DisplayName("junk around the edges is refused whole")
    void edgeJunk() {
        captureWarnings();
        try {
            String code = populated().getCode();
            String[] cases = {
                "",
                " ",
                " " + code,
                code + " ",
                code + "\n",
                "\t" + code,
                "erp=erp=" + code,
                code + "!",
                "!" + code,
                code + "%%",
                "\u00e9" + code,
                code + "\uD83D\uDE00",
                code + code,
                code.substring(0, code.length() - 1) + "=",
            };
            for (String candidate : cases) {
                assertAtomic("edge input", candidate);
            }
            assertEquals(cases.length, unchanged + applied, "every edge case was checked");
            assertTrue(unchanged > 0, "at least some edge junk is refused");
        } finally {
            releaseWarnings();
        }
    }

    @Test
    @DisplayName("a legacy-shaped code is atomic under the same mutations")
    void legacyMutations() {
        captureWarnings();
        try {
            String code = populated().getOldCode();
            for (int i = 0; i < code.length(); i++) {
                assertAtomic("legacy prefix of length " + i, code.substring(0, i));
                assertAtomic(
                        "legacy character deleted at " + i,
                        code.substring(0, i) + code.substring(i + 1));
            }
            assertEquals(code.length() * 2, unchanged + applied, "every legacy mutation was checked");
            assertTrue(unchanged > 0, "at least some legacy mutations are refused");
        } finally {
            releaseWarnings();
        }
    }

    @Test
    @DisplayName("applying the same code twice lands on the same design")
    void applyingTwiceIsANoOp() {
        String code = populated().getCode();
        Reactor reactor = new Reactor();
        assertDoesNotThrow(() -> reactor.setCode(code), "a valid code must not throw");
        String afterFirst = reactor.getCode();
        int maxHeatAfterFirst = (int) reactor.getMaxHeat();
        int componentsAfterFirst = TestSupport.componentsOf(reactor).size();

        assertDoesNotThrow(() -> reactor.setCode(code), "re-applying a valid code must not throw");
        assertEquals(afterFirst, reactor.getCode(), "the second application must be a no-op");
        assertEquals(
                maxHeatAfterFirst,
                (int) reactor.getMaxHeat(),
                "the second application must not double the plating-derived max heat");
        assertEquals(
                componentsAfterFirst,
                TestSupport.componentsOf(reactor).size(),
                "the second application must not duplicate components");
    }
}
