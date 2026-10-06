package Ic2ExpReactorPlanner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.Image;
import javax.swing.Icon;
import javax.swing.ImageIcon;
import javax.swing.JButton;
import Ic2ExpReactorPlanner.components.ReactorItem;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The pure lookup helpers that the GUI leans on: the IC2 register-name to planner-name mapping
 * used to build tooltips, and the component/label pairs behind them.
 *
 * <p>Only static methods are exercised, so no {@code JFrame} is constructed and the test runs
 * headless. Every case also asserts that the mapped name really resolves to a component, which
 * keeps the tooltip code and the component registry from drifting apart.
 */
class ReactorPlannerFrameMappingTest {

    @BeforeEach
    @AfterEach
    void resetGlobals() {
        TestSupport.resetGlobalConfig();
    }

    // ================================================================== register name mapping

    @ParameterizedTest(name = "register name {0} maps to {1}")
    @CsvSource({
        "ReactorHeatExchanger, coreHeatExchanger",
        "CoolantCell60kHelium, coolantCellHelium60k",
        "CoolantCell180kHelium, coolantCellHelium180k",
        "CoolantCell360kHelium, coolantCellHelium360k",
        "CoolantCell60kNak, coolantCellNak60k",
        "CoolantCell180kNak, coolantCellNak180k",
        "CoolantCell360kNak, coolantCellNak360k",
        "CoolantCell180kSpace, coolantCellSpace180k",
        "CoolantCell360kSpace, coolantCellSpace360k",
        "CoolantCell540kSpace, coolantCellSpace540k",
        "CoolantCell1080kSpace, coolantCellSpace1080k",
        "CoolantCell1GNeutronium, coolantCellNeutronium1G",
    })
    @DisplayName("the renamed IC2 items map onto their planner names")
    void renamedItems(String registerName, String baseName) {
        assertEquals(baseName, ReactorPlannerFrame.getReactorItemRegisterName(registerName));
    }

    @Test
    @DisplayName("an unmapped name simply loses its leading capital")
    void unmappedNamesLowercaseTheFirstCharacter() {
        assertEquals("fuelRodUranium", ReactorPlannerFrame.getReactorItemRegisterName("FuelRodUranium"));
        assertEquals("dualFuelRodUranium", ReactorPlannerFrame.getReactorItemRegisterName("DualFuelRodUranium"));
        assertEquals("quadFuelRodCesium", ReactorPlannerFrame.getReactorItemRegisterName("QuadFuelRodCesium"));
    }

    @ParameterizedTest(name = "{0} is a single capital letter after mapping")
    @ValueSource(strings = {"X", "A", "Q"})
    @DisplayName("a one-character name survives the mapping")
    void singleCharacterNames(String registerName) {
        String mapped = ReactorPlannerFrame.getReactorItemRegisterName(registerName);
        assertEquals(registerName.toLowerCase(java.util.Locale.ROOT), mapped);
    }

    @Test
    @DisplayName("null and empty pass through untouched")
    void nullAndEmptyPassThrough() {
        assertEquals(null, ReactorPlannerFrame.getReactorItemRegisterName(null));
        assertEquals("", ReactorPlannerFrame.getReactorItemRegisterName(""), "the empty string is not indexed");
    }

    /**
     * Every label the frame hands to {@code buildTooltipInfo} must map to a real component, since
     * the tooltip code dereferences the result without a null check.
     */
    @ParameterizedTest(name = "label {0}")
    @ValueSource(
            strings = {
                "FuelRodUranium", "DualFuelRodUranium", "QuadFuelRodUranium",
                "FuelRodMox", "DualFuelRodMox", "QuadFuelRodMox",
                "NeutronReflector", "ThickNeutronReflector", "IridiumNeutronReflector",
                "HeatVent", "AdvancedHeatVent", "ReactorHeatVent", "ComponentHeatVent", "OverclockedHeatVent",
                "CoolantCell10k", "CoolantCell30k", "CoolantCell60k",
                "HeatExchanger", "AdvancedHeatExchanger", "ReactorHeatExchanger", "ComponentHeatExchanger",
                "ReactorPlating", "HeatCapacityReactorPlating", "ContainmentReactorPlating",
                "RshCondensator", "LzhCondensator",
                "FuelRodThorium", "DualFuelRodThorium", "QuadFuelRodThorium",
                "CoolantCell60kHelium", "CoolantCell180kHelium", "CoolantCell360kHelium",
                "CoolantCell60kNak", "CoolantCell180kNak", "CoolantCell360kNak",
                "CoolantCell1GNeutronium",
                "FuelRodNaquadah", "DualFuelRodNaquadah", "QuadFuelRodNaquadah",
                "FuelRodCoaxium", "DualFuelRodCoaxium", "QuadFuelRodCoaxium",
                "FuelRodCesium", "DualFuelRodCesium", "QuadFuelRodCesium",
                "FuelRodNaquadahGTNH", "DualFuelRodNaquadahGTNH", "QuadFuelRodNaquadahGTNH",
                "FuelRodNaquadria", "DualFuelRodNaquadria", "QuadFuelRodNaquadria",
                "FuelRodTiberium", "DualFuelRodTiberium", "QuadFuelRodTiberium",
                "FuelRodTheCore",
                "CoolantCell180kSpace", "CoolantCell360kSpace", "CoolantCell540kSpace", "CoolantCell1080kSpace",
                "FuelRodCompressedUranium", "DualFuelRodCompressedUranium", "QuadFuelRodCompressedUranium",
                "FuelRodCompressedPlutonium", "DualFuelRodCompressedPlutonium", "QuadFuelRodCompressedPlutonium",
                "FuelRodLiquidUranium", "DualFuelRodLiquidUranium", "QuadFuelRodLiquidUranium",
                "FuelRodLiquidPlutonium", "DualFuelRodLiquidPlutonium", "QuadFuelRodLiquidPlutonium",
                "FuelRodGlowstone",
            })
    @DisplayName("every tooltip label maps to a component that can produce a tooltip")
    void everyTooltipLabelResolves(String label) {
        String baseName = ReactorPlannerFrame.getReactorItemRegisterName(label);
        ReactorItem component = ComponentFactory.getDefaultComponent(baseName);
        assertNotNull(component, label + " mapped to '" + baseName + "', which is not a component");
        if (component instanceof Ic2ExpReactorPlanner.components.Plating) {
            // Plating overrides formatTooltip() with an empty list: its Bundle strings are prose
            // with no %s placeholders, so the frame appends them unchanged.
            assertEquals(0, component.formatTooltip().length, label + " is plating and formats no values");
        } else {
            assertTrue(component.formatTooltip().length > 0, label + " has no tooltip data");
        }
    }

    /**
     * Every component in the factory should be reachable from some label, otherwise the palette
     * could show a component with no tooltip. The mapping is the inverse of the label list, so
     * this checks the registry against that list rather than duplicating it.
     */
    @Test
    @DisplayName("every factory component is covered by the label list")
    void everyComponentIsLabelled() {
        java.util.Set<String> mapped = new java.util.HashSet<>();
        for (String label : new String[] {
            "FuelRodUranium", "DualFuelRodUranium", "QuadFuelRodUranium", "FuelRodMox", "DualFuelRodMox",
            "QuadFuelRodMox", "NeutronReflector", "ThickNeutronReflector", "IridiumNeutronReflector",
            "HeatVent", "AdvancedHeatVent", "ReactorHeatVent", "ComponentHeatVent", "OverclockedHeatVent",
            "CoolantCell10k", "CoolantCell30k", "CoolantCell60k", "HeatExchanger", "AdvancedHeatExchanger",
            "ReactorHeatExchanger", "ComponentHeatExchanger", "ReactorPlating", "HeatCapacityReactorPlating",
            "ContainmentReactorPlating", "RshCondensator", "LzhCondensator", "FuelRodThorium",
            "DualFuelRodThorium", "QuadFuelRodThorium", "CoolantCell60kHelium", "CoolantCell180kHelium",
            "CoolantCell360kHelium", "CoolantCell60kNak", "CoolantCell180kNak", "CoolantCell360kNak",
            "CoolantCell1GNeutronium", "FuelRodNaquadah", "DualFuelRodNaquadah", "QuadFuelRodNaquadah",
            "FuelRodCoaxium", "DualFuelRodCoaxium", "QuadFuelRodCoaxium", "FuelRodCesium", "DualFuelRodCesium",
            "QuadFuelRodCesium", "FuelRodNaquadahGTNH", "DualFuelRodNaquadahGTNH", "QuadFuelRodNaquadahGTNH",
            "FuelRodNaquadria", "DualFuelRodNaquadria", "QuadFuelRodNaquadria", "FuelRodTiberium",
            "DualFuelRodTiberium", "QuadFuelRodTiberium", "FuelRodTheCore", "CoolantCell180kSpace",
            "CoolantCell360kSpace", "CoolantCell540kSpace", "CoolantCell1080kSpace",
            "FuelRodCompressedUranium", "DualFuelRodCompressedUranium", "QuadFuelRodCompressedUranium",
            "FuelRodCompressedPlutonium", "DualFuelRodCompressedPlutonium", "QuadFuelRodCompressedPlutonium",
            "FuelRodLiquidUranium", "DualFuelRodLiquidUranium", "QuadFuelRodLiquidUranium",
            "FuelRodLiquidPlutonium", "DualFuelRodLiquidPlutonium", "QuadFuelRodLiquidPlutonium",
            "FuelRodGlowstone",
        }) {
            mapped.add(ReactorPlannerFrame.getReactorItemRegisterName(label));
        }

        for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
            String baseName = ComponentFactory.getDefaultComponent(id).baseName;
            assertTrue(mapped.contains(baseName), baseName + " has no tooltip label");
        }
    }

    // ================================================================== icon cache (P2-1)

    /**
     * Pinned through the static seam rather than a JFrame: the frame itself is never constructed
     * in a test, so the cache and the button helper are the parts that can run headless.
     */
    @Test
    @DisplayName("a texture at a fixed size scales once, not once per button")
    void oneScaledIconPerTextureAndSize() {
        java.awt.Image texture = ComponentFactory.getDefaultComponent("fuelRodCesium").image;
        assertNotNull(texture, "the texture did not load in the test environment");
        javax.swing.ImageIcon first = ReactorPlannerFrame.getCachedIcon(texture, 40);
        javax.swing.ImageIcon again = ReactorPlannerFrame.getCachedIcon(texture, 40);
        assertSame(first, again, "the second request re-scaled the texture");
        assertEquals(40, first.getImage().getWidth(null));
        assertEquals(40, first.getImage().getHeight(null));
    }

    @Test
    @DisplayName("sizes are not confused with each other")
    void differentSizesGetDifferentIcons() {
        java.awt.Image texture = ComponentFactory.getDefaultComponent("fuelRodCesium").image;
        javax.swing.ImageIcon small = ReactorPlannerFrame.getCachedIcon(texture, 20);
        javax.swing.ImageIcon large = ReactorPlannerFrame.getCachedIcon(texture, 60);
        assertNotSame(small, large, "the pixel size is not part of the cache key");
        assertEquals(20, small.getImage().getWidth(null));
        assertEquals(60, large.getImage().getWidth(null));
    }

    @Test
    @DisplayName("the cache is bounded so a resize drag cannot retain every intermediate")
    void cacheIsBounded() {
        java.awt.Image texture = ComponentFactory.getDefaultComponent("fuelRodCesium").image;
        javax.swing.ImageIcon first = ReactorPlannerFrame.getCachedIcon(texture, 1);
        for (int size = 2; size <= ReactorPlannerFrame.ICON_CACHE_LIMIT + 1; size++) {
            ReactorPlannerFrame.getCachedIcon(texture, size);
        }
        assertNotSame(
                first,
                ReactorPlannerFrame.getCachedIcon(texture, 1),
                "the cache kept every size the sweep asked for");
    }

    @Test
    @DisplayName("a button that already has the right icon is left alone")
    void unchangedSizeLeavesTheButtonAlone() {
        java.awt.Image texture = ComponentFactory.getDefaultComponent("fuelRodCesium").image;
        javax.swing.JButton button = new javax.swing.JButton();
        ReactorPlannerFrame.setComponentIcon(button, texture, 50);
        javax.swing.Icon applied = button.getIcon();
        assertNotNull(applied, "a button of a usable size still got no icon");
        ReactorPlannerFrame.setComponentIcon(button, texture, 50);
        assertSame(applied, button.getIcon(), "the memo did not hold and the icon was replaced");
        ReactorPlannerFrame.setComponentIcon(button, texture, 2);
        assertNull(button.getIcon(), "a button too small to draw on keeps an icon");
    }

    // ================================================================== resize feedback (P3-7)

    /**
     * P3-7: {@code plannerResized} used to call {@code setSize()} unconditionally, so every resize
     * event asked Swing for another resize and re-fired the handler -- the flicker. {@link
     * ReactorPlannerFrame.clampedFrameSize clampedFrameSize} is the seam that decides whether a
     * resize is asked for at all, and it is the only part of that handler reachable here: a {@code
     * JFrame} cannot be constructed in a headless JVM at all ({@code java.awt.HeadlessException}
     * out of {@code java.awt.Window.<init>}), so the frame itself is never instantiated and the
     * two lines that honour the {@code null} are pinned by reading, not by running.
     */
    @Test
    @DisplayName("a frame that honours its minimum asks for no resize")
    void aFrameAtOrAboveItsMinimumAsksForNoResize() {
        java.awt.Dimension minimum = new java.awt.Dimension(915, 700);
        assertNull(
                ReactorPlannerFrame.clampedFrameSize(new java.awt.Dimension(915, 700), minimum),
                "exactly at the minimum there is nothing to fix");
        assertNull(
                ReactorPlannerFrame.clampedFrameSize(new java.awt.Dimension(1200, 900), minimum),
                "above the minimum there is nothing to fix either");
    }

    @Test
    @DisplayName("a frame below its minimum is clamped on the axis that is short")
    void aFrameBelowItsMinimumIsClamped() {
        java.awt.Dimension minimum = new java.awt.Dimension(915, 700);
        java.awt.Dimension clamped =
                ReactorPlannerFrame.clampedFrameSize(new java.awt.Dimension(900, 700), minimum);
        assertNotNull(clamped, "the width is short, so a resize is requested");
        assertEquals(915, clamped.width, "the short axis is raised to the minimum");
        assertEquals(700, clamped.height, "the axis that already fits is left alone");

        java.awt.Dimension collapsed = ReactorPlannerFrame.clampedFrameSize(new java.awt.Dimension(0, 0), minimum);
        assertEquals(915, collapsed.width, "a collapsed frame is clamped on both axes");
        assertEquals(700, collapsed.height, "a collapsed frame is clamped on both axes");
    }

    // ================================================================== resource bundle

    @Test
    @DisplayName("the resource bundle resolves the keys the tooltips rely on")
    void bundleKeysResolve() {
        assertNotNull(BundleHelper.getI18n("ComponentName.FuelRodUranium"));
        assertNotNull(BundleHelper.getI18n("ComponentTooltip.Broken"));
        assertNotNull(BundleHelper.getI18n("ComponentTooltip.ResidualHeat"));
        assertNotNull(BundleHelper.getI18n("ComponentTooltip.NeutronNumber"));
        assertNotNull(BundleHelper.getI18n("ComponentTooltip.Infinite"));
    }

    @Test
    @DisplayName("formatI18n substitutes arguments")
    void formatI18nSubstitutes() {
        // UI.MaxHeatSpecific uses a %f conversion, so it wants a Double.
        String formatted = BundleHelper.formatI18n("UI.MaxHeatSpecific", 12345.0);
        assertTrue(formatted.contains("12,345") || formatted.contains("12345"), "got: " + formatted);
    }

    @Test
    @DisplayName("a missing bundle key is reported rather than silently ignored")
    void missingKeyThrows() {
        org.junit.jupiter.api.Assertions.assertThrows(
                java.util.MissingResourceException.class, () -> BundleHelper.getI18n("No.Such.Key.At.All"));
    }
}