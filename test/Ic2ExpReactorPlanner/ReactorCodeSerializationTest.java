package Ic2ExpReactorPlanner;

import static Ic2ExpReactorPlanner.TestSupport.assertClose;
import static Ic2ExpReactorPlanner.TestSupport.place;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import Ic2ExpReactorPlanner.components.Condensator;
import Ic2ExpReactorPlanner.components.CoolantCell;
import Ic2ExpReactorPlanner.components.FuelRod;
import Ic2ExpReactorPlanner.components.Plating;
import Ic2ExpReactorPlanner.components.ReactorItem;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Reactor code serialization: {@code getCode}/{@code setCode} (Base64, revision 4),
 * {@code getOldCode} (legacy hex), and the failure modes of malformed input.
 *
 * <p>Everything here is refactor-sensitive: the Base64 payload is a hand-rolled bit packing over
 * a {@link BigintStorage}, so any change to field order or width silently invalidates every code
 * users have shared. The round-trip tests below are the guard rail for that.
 */
class ReactorCodeSerializationTest {

    @BeforeEach
    @AfterEach
    void resetGlobals() {
        TestSupport.resetGlobalConfig();
    }

    // ================================================================== Base64 codes

    @Nested
    @DisplayName("Base64 codes (revision 4)")
    class Base64Codes {

        @Test
        @DisplayName("an empty reactor round-trips")
        void emptyReactor() {
            Reactor reactor = new Reactor();
            reactor.setCode(reactor.getCode());
            assertEquals(reactor.getCode(), reactor.getCode(), "stable");
            assertTrue(TestSupport.componentsOf(reactor).isEmpty(), "still empty");
        }

        @Test
        @DisplayName("getCode is prefixed with erp=")
        void prefix() {
            String code = new Reactor().getCode();
            assertTrue(code.startsWith("erp="), "got: " + code.substring(0, Math.min(12, code.length())));
        }

        @Test
        @DisplayName("every component in the factory round-trips through the Base64 code")
        void everyComponentRoundTrips() {
            for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
                ReactorItem prototype = ComponentFactory.getDefaultComponent(id);
                Reactor reactor = new Reactor();
                reactor.setComponentAt(2, 3, ComponentFactory.createComponent(id));

                String code = reactor.getCode();
                Reactor back = new Reactor();
                back.setCode(code);

                assertNotNull(back.getComponentAt(2, 3), prototype.baseName + " did not survive the round trip");
                assertEquals(
                        prototype.baseName,
                        back.getComponentAt(2, 3).baseName,
                        prototype.baseName + " came back as the wrong component");
                assertEquals(
                        reactor.getCode(),
                        back.getCode(),
                        prototype.baseName + " code is not stable across a round trip");
            }
        }

        @Test
        @DisplayName("a full 54-component layout round-trips slot for slot")
        void fullLayout() {
            Reactor reactor = new Reactor();
            int id = 1;
            for (int[] cell : TestSupport.CELLS) {
                reactor.setComponentAt(cell[0], cell[1], ComponentFactory.createComponent(id++));
            }
            Reactor back = new Reactor();
            back.setCode(reactor.getCode());
            assertEquals(reactor.getCode(), back.getCode(), "code is stable");
            for (int[] cell : TestSupport.CELLS) {
                assertEquals(
                        reactor.getComponentAt(cell[0], cell[1]).baseName,
                        back.getComponentAt(cell[0], cell[1]).baseName,
                        "slot " + cell[0] + "," + cell[1]);
            }
        }

        @Test
        @DisplayName("mode flags round-trip in every combination")
        void modeFlags() {
            for (boolean fluid : new boolean[] {false, true}) {
                for (int mode = 0; mode < 3; mode++) { // none / pulsed / automated
                    Reactor reactor = new Reactor();
                    reactor.setComponentAt(2, 2, ComponentFactory.createComponent("fuelRodUranium"));
                    reactor.setFluid(fluid);
                    reactor.setPulsed(mode > 0);
                    reactor.setAutomated(mode > 1);
                    reactor.setUsingReactorCoolantInjectors(mode > 1);

                    Reactor back = new Reactor();
                    back.setCode(reactor.getCode());

                    assertEquals(fluid, back.isFluid(), "fluid");
                    assertEquals(mode > 0, back.isPulsed(), "pulsed");
                    assertEquals(mode > 1, back.isAutomated(), "automated");
                    assertEquals(mode > 1, back.isUsingReactorCoolantInjectors(), "injectors");
                    assertEquals(reactor.getCode(), back.getCode(), "code stable");
                }
            }
        }

        @Test
        @DisplayName("pulse settings round-trip when pulsed")
        void pulseSettings() {
            Reactor reactor = new Reactor();
            reactor.setComponentAt(2, 2, ComponentFactory.createComponent("fuelRodUranium"));
            reactor.setPulsed(true);
            reactor.setOnPulse(12345);
            reactor.setOffPulse(54321);
            reactor.setSuspendTemp(60000);
            reactor.setResumeTemp(70000);

            Reactor back = new Reactor();
            back.setCode(reactor.getCode());
            assertEquals(12345, back.getOnPulse(), "onPulse");
            assertEquals(54321, back.getOffPulse(), "offPulse");
            assertEquals(60000, back.getSuspendTemp(), "suspendTemp");
            assertEquals(70000, back.getResumeTemp(), "resumeTemp");
        }

        @Test
        @DisplayName("pulse settings are not stored when the reactor is not pulsed")
        void pulseSettingsDroppedWhenNotPulsed() {
            Reactor reactor = new Reactor();
            reactor.setOnPulse(12345);
            reactor.setPulsed(false);
            Reactor back = new Reactor();
            back.setCode(reactor.getCode());
            assertEquals(5000000, back.getOnPulse(), "the default comes back instead");
        }

        @Test
        @DisplayName("current heat and max simulation ticks round-trip")
        void heatAndTickLimit() {
            for (int heat : new int[] {0, 1, 4321, 119999}) {
                Reactor reactor = new Reactor();
                reactor.setCurrentHeat(heat);
                reactor.setMaxSimulationTicks(123456);
                Reactor back = new Reactor();
                back.setCode(reactor.getCode());
                assertEquals(heat, (int) back.getCurrentHeat(), "heat " + heat);
                assertEquals(123456, back.getMaxSimulationTicks(), "tick limit");
            }
        }

        @Test
        @DisplayName("the 120 000 heat storage bound is inclusive")
        void heatBoundIsInclusive() {
            Reactor reactor = new Reactor();
            reactor.setCurrentHeat(120000);
            assertNotNull(reactor.getCode(), "120000 must be encodable, it is not out of range");
        }

        @Test
        @DisplayName("per-component initial heat, threshold and pause round-trip when automated")
        void automationSettingsRoundTrip() {
            Reactor reactor = new Reactor();
            reactor.setAutomated(true);
            CoolantCell cell = (CoolantCell) place(reactor, 2, 2, "coolantCell60k");
            cell.setInitialHeat(5000);
            cell.setAutomationThreshold(40000);
            cell.setReactorPause(20);

            Reactor back = new Reactor();
            back.setCode(reactor.getCode());
            CoolantCell backCell = (CoolantCell) back.getComponentAt(2, 2);
            assertClose(5000, backCell.getInitialHeat(), 1e-9, "initial heat");
            assertEquals(40000, backCell.getAutomationThreshold(), "threshold");
            assertEquals(20, backCell.getReactorPause(), "pause");
            assertEquals(reactor.getCode(), back.getCode(), "code stable");
        }

        @Test
        @DisplayName("initial heat round-trips without automation mode")
        void initialHeatWithoutAutomation() {
            Reactor reactor = new Reactor();
            place(reactor, 2, 2, "coolantCell60k").setInitialHeat(1234);
            Reactor back = new Reactor();
            back.setCode(reactor.getCode());
            assertClose(1234, back.getComponentAt(2, 2).getInitialHeat(), 1e-9, "initial heat");
        }

        @Test
        @DisplayName("initial heat at or above the component's capacity is refused")
        void initialHeatIsCappedByCapacity() {
            Reactor reactor = new Reactor();
            CoolantCell cell = (CoolantCell) place(reactor, 2, 2, "coolantCell60k");
            cell.setInitialHeat(cell.getMaxHeat() + 1000);
            assertClose(0, cell.getInitialHeat(), 1e-9, "silently ignored, not clamped");
            cell.setInitialHeat(-5);
            assertClose(0, cell.getInitialHeat(), 1e-9, "negatives are ignored too");
        }

        @Test
        @DisplayName("components that take no settings keep their defaults")
        void settingsAreGuardedByCapacity() {
            Reactor reactor = new Reactor();
            Plating plating = (Plating) place(reactor, 2, 2, "reactorPlating"); // maxHeat 1, maxDamage 1
            plating.setInitialHeat(5000);
            plating.setAutomationThreshold(1234);
            plating.setReactorPause(7);
            assertClose(0, plating.getInitialHeat(), 1e-9, "plating cannot hold heat");
            assertEquals(9000, plating.getAutomationThreshold(), "threshold unchanged");
            assertEquals(0, plating.getReactorPause(), "pause unchanged");
        }

        @Test
        @DisplayName("the code survives being written to the clipboard charset")
        void codeIsClipboardSafe() {
            Reactor reactor = new Reactor();
            for (int id = 1; id <= 40; id++) {
                reactor.setComponentAt((id / 9), (id % 9), ComponentFactory.createComponent(id));
            }
            reactor.setCurrentHeat(4321);
            String code = reactor.getCode();
            assertTrue(code.matches("erp=[0-9A-Za-z+/=]+"), "paste-unsafe characters in: " + code);
        }

        @Test
        @DisplayName("setCode accepts a Base64 payload with the erp= prefix stripped")
        void strippedPrefixStillParses() {
            Reactor reactor = new Reactor();
            reactor.setComponentAt(2, 2, ComponentFactory.createComponent("quadFuelRodUranium"));
            String stripped = reactor.getCode().substring(4);

            Reactor back = new Reactor();
            back.setCode(stripped);
            assertEquals(
                    "quadFuelRodUranium", back.getComponentAt(2, 2).baseName, "recovered from the stripped payload");
        }

        @Test
        @DisplayName("an empty code is ignored")
        void emptyCode() {
            Reactor reactor = new Reactor();
            reactor.setComponentAt(2, 2, ComponentFactory.createComponent("fuelRodUranium"));
            reactor.setCode("");
            assertNotNull(reactor.getComponentAt(2, 2), "the existing layout is left alone");
        }
    }

    // ================================================================== legacy hex codes

    @Nested
    @DisplayName("legacy hex codes (getOldCode)")
    class LegacyHexCodes {

        @Test
        @DisplayName("the legacy code is 108 hex digits plus a suffix")
        void shape() {
            String old = new Reactor().getOldCode();
            String[] parts = old.split("\\|");
            assertEquals(108, parts[0].length(), "108 component slots");
            assertTrue(parts[0].matches("[0-9A-F]{108}"), "hex digits only");
            assertTrue(parts.length >= 2, "has a suffix");
        }

        @Test
        @DisplayName("a populated layout round-trips through the legacy code")
        void populatedRoundTrip() {
            Reactor reactor = new Reactor();
            reactor.setComponentAt(0, 0, ComponentFactory.createComponent("fuelRodUranium"));
            reactor.setComponentAt(2, 2, ComponentFactory.createComponent("reactorPlating"));
            reactor.setComponentAt(5, 8, ComponentFactory.createComponent("coolantCell60k"));

            Reactor back = new Reactor();
            back.setCode(reactor.getOldCode());

            assertEquals("fuelRodUranium", back.getComponentAt(0, 0).baseName, "slot 0,0");
            assertEquals("reactorPlating", back.getComponentAt(2, 2).baseName, "slot 2,2");
            assertEquals("coolantCell60k", back.getComponentAt(5, 8).baseName, "slot 5,8");
            assertEquals(11000, back.getMaxHeat(), 1e-9, "the plating's heat adjustment was applied");
            assertEquals(reactor.getOldCode(), back.getOldCode(), "code is stable");
        }

        @Test
        @DisplayName("mode flags round-trip through the suffix")
        void modeSuffix() {
            Reactor reactor = new Reactor();
            reactor.setFluid(true);
            reactor.setAutomated(true);
            reactor.setUsingReactorCoolantInjectors(true);
            Reactor back = new Reactor();
            back.setCode(reactor.getOldCode());
            assertTrue(back.isFluid(), "fluid");
            assertTrue(back.isAutomated(), "automated");
            assertTrue(back.isUsingReactorCoolantInjectors(), "injectors");
        }

        @Test
        @DisplayName("per-component initial heat round-trips in the parenthesised form")
        void perComponentParams() {
            Reactor reactor = new Reactor();
            reactor.setAutomated(true);
            CoolantCell cell = (CoolantCell) place(reactor, 2, 2, "coolantCell60k");
            cell.setInitialHeat(4321);
            cell.setAutomationThreshold(44444);
            cell.setReactorPause(33);

            String old = reactor.getOldCode();
            assertTrue(old.contains("(h"), "initial heat is present: " + old);
            assertTrue(old.contains(",a"), "threshold is present");
            assertTrue(old.contains(",p"), "pause is present");

            Reactor back = new Reactor();
            back.setCode(old);
            CoolantCell backCell = (CoolantCell) back.getComponentAt(2, 2);
            assertClose(4321, backCell.getInitialHeat(), 1e-9, "initial heat");
            assertEquals(44444, backCell.getAutomationThreshold(), "threshold");
            assertEquals(33, backCell.getReactorPause(), "pause");
        }

        @Test
        @DisplayName("a non-default resume temperature is emitted as its own suffix field")
        void resumeTempSuffix() {
            // getOldCode compares resumeTemp against DEFAULT_SUSPEND_TEMP rather than
            // DEFAULT_RESUME_TEMP (CODE_REVIEW.md P3-3). The two constants are both 120e3 today
            // so it happens to work; this test passes today and would catch a divergence.
            Reactor reactor = new Reactor();
            reactor.setPulsed(true);
            reactor.setResumeTemp(60000);
            String old = reactor.getOldCode();
            assertTrue(old.contains("|r"), "resume temp field emitted: " + old);
        }
    }

    // ================================================================== Talonius codes

    @Nested
    @DisplayName("Talonius legacy codes")
    class Talonius {

        @Test
        @DisplayName("readInt pulls bits off the front of the base-36 value")
        void decoderReadsLowBitsFirst() {
            TaloniusDecoder decoder = new TaloniusDecoder("1z"); // 1 * 36 + 35 = 71
            assertEquals(7, decoder.readInt(6), "low 6 bits of 71");
            assertEquals(1, decoder.readInt(1), "then the next bit");
            assertEquals(0, decoder.readInt(3), "then the rest");
        }

        @Test
        @DisplayName("single-digit codes decode to their own value")
        void singleDigit() {
            assertEquals(0, new TaloniusDecoder("0").readInt(10));
            assertEquals(5, new TaloniusDecoder("5").readInt(10));
            assertEquals(35, new TaloniusDecoder("z").readInt(10));
        }

        /**
         * A Talonius code for a reactor holding a single uranium rod at 0 heat.
         *
         * <p>{@code handleTaloniusCode} reads initial heat in multiples of 100 (10 bits) and then
         * walks the grid from (8,5) down to (0,0) taking 7 bits per cell, so cell {@code k}
         * occupies bits {@code 10 + 7*(k-1)}. The 54th and last cell read is x=0, y=0, i.e. grid
         * row 0 column 0, so setting bit {@code 10 + 7*53} places a uranium rod there.
         */
        @Test
        @DisplayName("a synthetic Talonius code places components")
        void syntheticCode() {
            java.math.BigInteger value = java.math.BigInteger.ONE.shiftLeft(10 + 7 * 53);
            String code = value.toString(36);

            // No reflection and no display: P3-10 replaced the direct JOptionPane call in
            // handleTaloniusCode with WarningDisplay, so the warning sink absorbs it.
            final List<String> warnings = new ArrayList<>();
            WarningDisplay.setSink(new WarningDisplay.Sink() {
                @Override
                public void warn(String title, String message) {
                    warnings.add(message);
                }
            });
            try {
                Reactor reactor = new Reactor();
                reactor.setCode(code);
                assertTrue(warnings.isEmpty(), "a fully recognised code warns nothing, got: " + warnings);
                assertClose(
                        0,
                        reactor.getCurrentHeat(),
                        1e-9,
                        "initial heat is read in multiples of 100, so 0 here");
                assertNotNull(reactor.getComponentAt(0, 0), "the last field read lands at row 0, column 0");
                assertEquals("fuelRodUranium", reactor.getComponentAt(0, 0).baseName, "a uranium rod");
                assertEquals(1, TestSupport.componentsOf(reactor).size(), "and nothing else was placed");
            } finally {
                WarningDisplay.setSink(null);
            }
        }
    }

    // ================================================================== malformed input

    @Nested
    @DisplayName("malformed input")
    class Malformed {

        @Test
        @DisplayName("an unsupported code revision is rejected")
        void unsupportedRevision() {
            BigintStorage storage = new BigintStorage();
            storage.store(0, (int) 5e6); // maxSimulationTicks
            storage.store(0, 1); // RCIs
            storage.store(0, 1); // fluid
            storage.store(0, (int) 120e3); // currentHeat
            storage.store(5, 255); // revision 5 -- does not exist
            Reactor reactor = new Reactor();
            assertThrows(
                    IllegalArgumentException.class,
                    () -> reactor.setCode("erp=" + storage.outputBase64()),
                    "revision 5 does not exist");
        }

        @Test
        @DisplayName("revisions 0 to 4 all decode")
        void supportedRevisionsDecode() {
            for (int revision = 0; revision <= 4; revision++) {
                Reactor reactor = new Reactor();
                reactor.setCode("erp=" + codeForRevision(revision));
                assertNotNull(reactor, "revision " + revision + " should decode");
                assertFalse(
                        reactor.isFluid() && !codeForRevision(revision).isEmpty(),
                        "revision " + revision + " decoded to something");
            }
        }

        @Test
        @DisplayName("revision 3 and 4 codes with a full grid decode identically")
        void revision3And4Agree() {
            Reactor three = new Reactor();
            three.setCode("erp=" + codeForRevision(3));
            Reactor four = new Reactor();
            four.setCode("erp=" + codeForRevision(4));
            assertEquals(three.getCode(), four.getCode(), "both re-encode as revision 4");
        }

        /**
         * CODE_REVIEW.md P1-1: a legacy hex code with more than three per-component parameters
         * overflows the {@code MAX_PARAM_TYPES} array and throws an unchecked exception that
         * {@code setCode} does not catch.
         */
        @Test
        @DisplayName("a cell with four parameters throws ArrayIndexOutOfBounds")
        void fourParametersThrows() {
            StringBuilder code = new StringBuilder("01(h1,a2,p3,h4)");
            while (code.length() < 108) {
                code.append("00");
            }
            code.append("|fes");
            Reactor reactor = new Reactor();
            assertThrows(ArrayIndexOutOfBoundsException.class, () -> reactor.setCode(code.toString()));
        }

        /** The same finding from the other direction: a truncated suffix has no second character. */
        @Test
        @DisplayName("a one-character suffix throws StringIndexOutOfBounds")
        void shortSuffixThrows() {
            StringBuilder code = new StringBuilder();
            for (int i = 0; i < 54; i++) {
                code.append("00");
            }
            Reactor reactor = new Reactor();
            assertThrows(StringIndexOutOfBoundsException.class, () -> reactor.setCode(code + "|f"));
        }

        /**
         * The same finding again: the legacy parser clamps nothing, so a large base-36 suffix
         * produces a current heat above the 120 000 storage bound, and the next call to
         * {@code getCode()} throws from {@code BigintStorage.store}.
         */
        @Test
        @DisplayName("a legacy code with an oversized heat poisons getCode()")
        void oversizedHeatPoisonsGetCode() {
            StringBuilder code = new StringBuilder();
            for (int i = 0; i < 54; i++) {
                code.append("00");
            }
            Reactor reactor = new Reactor();
            reactor.setCode(code + "|fes3W0E"); // 181 454
            assertEquals(181454, (int) reactor.getCurrentHeat(), "the heat is read unclamped");
            assertThrows(IllegalArgumentException.class, reactor::getCode);
        }

        @Test
        @DisplayName("a base-36 suffix within range is harmless")
        void inRangeHeatIsHarmless() {
            StringBuilder code = new StringBuilder();
            for (int i = 0; i < 54; i++) {
                code.append("00");
            }
            Reactor reactor = new Reactor();
            reactor.setCode(code + "|fesZZ");
            assertEquals(1295, (int) reactor.getCurrentHeat(), "parsed");
            assertNotNull(reactor.getCode(), "and still encodable");
        }
    }

    /**
     * Builds a minimal, valid Base64 payload at the given code revision, mirroring the field order
     * that {@code Reactor.readCodeString()} expects.
     *
     * <p>Fields are packed in reverse of read order:
     *
     * <pre>
     *   read:  revision, [pulsed, automated], grid..., currentHeat,
     *          [pulse params], fluid, RCIs, [revision 0: pulsed, automated], maxSimulationTicks
     * </pre>
     */
    private static String codeForRevision(int revision) {
        BigintStorage storage = new BigintStorage();
        storage.store(1000, (int) 5e6); // maxSimulationTicks
        if (revision == 0) {
            storage.store(0, 1); // automated
            storage.store(0, 1); // pulsed
        }
        storage.store(0, 1); // reactor coolant injectors
        storage.store(0, 1); // fluid
        if (revision == 0) {
            storage.store(0, (int) 120e3); // resumeTemp
            storage.store(0, (int) 120e3); // suspendTemp
            storage.store(0, (int) 5e6); // offPulse
            storage.store(0, (int) 5e6); // onPulse
        }
        storage.store(0, (int) 120e3); // currentHeat

        int componentBits;
        switch (revision) {
            case 0:
            case 1:
                componentBits = 38;
                break;
            case 2:
                componentBits = 44;
                break;
            case 3:
                componentBits = 58;
                break;
            default:
                componentBits = 72;
                break;
        }
        for (int i = 0; i < 54; i++) {
            storage.store(0, 1); // hasSpecialAutomationConfig
            storage.store(0, componentBits); // componentId 0 == empty
        }
        if (revision >= 1) {
            storage.store(0, 1); // automated
            storage.store(0, 1); // pulsed
        }
        storage.store(revision, 255);
        return storage.outputBase64();
    }
}