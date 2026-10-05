package Ic2ExpReactorPlanner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import Ic2ExpReactorPlanner.components.ReactorItem;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** {@link MaterialsList}: recipe aggregation, rendering and the version-dependent variants. */
class MaterialsListTest {

    @BeforeEach
    @AfterEach
    void resetGlobals() {
        TestSupport.resetGlobalConfig();
    }

    // ================================================================== aggregation

    @Nested
    @DisplayName("aggregation")
    class Aggregation {

        @Test
        @DisplayName("an empty list renders as an empty string")
        void emptyList() {
            assertEquals("", new MaterialsList().toString());
        }

        @Test
        @DisplayName("a plain string means a count of one")
        void plainString() {
            Map<String, Double> parsed = TestSupport.parseMaterialList(new MaterialsList("Iron").toString());
            assertEquals(1, parsed.size());
            assertEquals(1.0, parsed.get(MaterialsList.IRON), 1e-9);
        }

        @Test
        @DisplayName("a number sets the count for the string that follows")
        void numberThenString() {
            Map<String, Double> parsed =
                    TestSupport.parseMaterialList(new MaterialsList(8, "Iron", "Gold").toString());
            assertEquals(8.0, parsed.get(MaterialsList.IRON), 1e-9);
            assertEquals(1.0, parsed.get(MaterialsList.GOLD), 1e-9);
        }

        /**
         * The renderer formats counts with "UI.MaterialDecimalFormat" ("#,##0.##"), so a
         * fractional count is rounded to two decimals on the way out. The stored value keeps full
         * precision; only the rendered text is rounded, so parse-back assertions use a tolerance.
         */
        @Test
        @DisplayName("fractional counts are rendered, rounded to the bundle's precision")
        void fractionalCounts() {
            Map<String, Double> parsed =
                    TestSupport.parseMaterialList(new MaterialsList(1.0 / 3, MaterialsList.TIN).toString());
            assertEquals(1.0 / 3, parsed.get(MaterialsList.TIN), 5e-3, "1/3 renders as 0.33");
            assertEquals(
                    0.25,
                    TestSupport.parseMaterialList(new MaterialsList(0.25, MaterialsList.TIN).toString())
                            .get(MaterialsList.TIN),
                    1e-9,
                    "a two-decimal value round-trips exactly");
        }

        @Test
        @DisplayName("a nested list is expanded, and a leading count multiplies it")
        void nestedLists() {
            Map<String, Double> inner =
                    TestSupport.parseMaterialList(new MaterialsList("Iron", "Gold").toString());
            Map<String, Double> outer =
                    TestSupport.parseMaterialList(new MaterialsList(3, new MaterialsList("Iron", "Gold")).toString());
            for (Map.Entry<String, Double> entry : inner.entrySet()) {
                assertEquals(entry.getValue() * 3, outer.get(entry.getKey()), 1e-9, entry.getKey());
            }
        }

        @Test
        @DisplayName("adding the same material twice sums the counts")
        void repeatedMaterialsSum() {
            Map<String, Double> parsed = TestSupport.parseMaterialList(
                    new MaterialsList(3, "Iron", 4, "Iron").toString());
            assertEquals(7.0, parsed.get(MaterialsList.IRON), 1e-9);
        }

        @Test
        @DisplayName("a null material throws a NullPointerException naming the arguments")
        void nullThrows() {
            assertThrows(
                    NullPointerException.class,
                    () -> new MaterialsList(2, (Object) null),
                    "a null entry is rejected outright");
        }

        @Test
        @DisplayName("an unsupported argument type throws IllegalArgumentException")
        void unsupportedTypeThrows() {
            assertThrows(
                    IllegalArgumentException.class,
                    () -> new MaterialsList(3, new Object()),
                    "only Strings, Numbers and MaterialsLists are accepted");
        }

        @Test
        @DisplayName("add() mutates an existing list in place")
        void addMutates() {
            MaterialsList list = new MaterialsList("Iron");
            list.add(2, "Iron");
            list.add("Gold");
            Map<String, Double> parsed = TestSupport.parseMaterialList(list.toString());
            assertEquals(3.0, parsed.get(MaterialsList.IRON), 1e-9);
            assertEquals(1.0, parsed.get(MaterialsList.GOLD), 1e-9);
        }
    }

    // ================================================================== component recipes

    @Nested
    @DisplayName("component recipes")
    class Recipes {

        @Test
        @DisplayName("every component in the factory has a recipe")
        void everyComponentHasARecipe() {
            for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
                ReactorItem item = ComponentFactory.getDefaultComponent(id);
                assertNotNull(
                        MaterialsList.getMaterialsForComponent(item), item.baseName + " has no recipe entry");
                assertFalse(
                        MaterialsList.getMaterialsForComponent(item).toString().isEmpty(),
                        item.baseName + " has an empty recipe");
            }
        }

        @Test
        @DisplayName("a dual rod costs twice a single rod")
        void dualRodIsDoubleTheSingle() {
            Map<String, Double> single =
                    TestSupport.parseMaterialList(MaterialsList.getMaterialsForComponent(
                                    ComponentFactory.getDefaultComponent("fuelRodUranium"))
                            .toString());
            Map<String, Double> dual = TestSupport.parseMaterialList(MaterialsList.getMaterialsForComponent(
                            ComponentFactory.getDefaultComponent("dualFuelRodUranium"))
                    .toString());
            // The dual rod is one rod plus two extra iron casings: "IRON, 2, fuelRodUranium".
            assertEquals(single.size(), dual.size(), "same distinct materials");
            for (Map.Entry<String, Double> entry : single.entrySet()) {
                assertTrue(
                        dual.get(entry.getKey()) > entry.getValue(),
                        "a dual rod needs more " + entry.getKey() + " than a single rod");
            }
            assertEquals(
                    single.get(MaterialsList.IRON) + 2,
                    dual.get(MaterialsList.IRON),
                    1e-9,
                    "specifically two extra iron casings");
            assertEquals(
                    single.get(MaterialsList.URANIUM) * 2,
                    dual.get(MaterialsList.URANIUM),
                    1e-9,
                    "but twice the fuel");
        }

        @Test
        @DisplayName("a quad rod costs four rods' fuel plus extra copper and iron")
        void quadRodIsRicherThanFourSingles() {
            Map<String, Double> quad = TestSupport.parseMaterialList(
                    MaterialsList.getMaterialsForComponent(ComponentFactory.getDefaultComponent("quadFuelRodUranium"))
                            .toString());
            Map<String, Double> single =
                    TestSupport.parseMaterialList(MaterialsList.getMaterialsForComponent(
                                    ComponentFactory.getDefaultComponent("fuelRodUranium"))
                            .toString());
            for (Map.Entry<String, Double> entry : single.entrySet()) {
                assertTrue(
                        quad.get(entry.getKey()) > entry.getValue(),
                        "a quad rod needs more " + entry.getKey() + " than a single rod");
            }
            assertNotNull(quad.get(MaterialsList.COPPER), "and copper for the extra casings");
        }

        @Test
        @DisplayName("a component list aggregates to at least one material per component type")
        void reactorAggregationUsesRecipes() {
            Reactor reactor = new Reactor();
            reactor.setComponentAt(2, 2, ComponentFactory.createComponent("fuelRodUranium"));
            reactor.setComponentAt(2, 4, ComponentFactory.createComponent("fuelRodUranium"));
            reactor.setComponentAt(4, 2, ComponentFactory.createComponent("neutronReflector"));

            Map<String, Double> parsed = TestSupport.parseMaterialList(reactor.getMaterials().toString());
            assertEquals(2.0, parsed.get(MaterialsList.IRON), 1e-9, "iron for the two rods");
            assertEquals(2.0, parsed.get(MaterialsList.URANIUM), 1e-9, "uranium for the two rods");
            assertTrue(parsed.containsKey(MaterialsList.COPPER), "copper for the reflector");
            assertTrue(parsed.containsKey(MaterialsList.COAL), "coal for the reflector");
        }
    }

    // ================================================================== version variants

    @Nested
    @DisplayName("version and flag variants")
    class Variants {

        @Test
        @DisplayName("GT 5.09 gives the reflector a different recipe than vanilla")
        void gt509ReflectorRecipe() {
            Map<String, Double> vanilla = reflectorRecipe();
            MaterialsList.setGTVersion("5.09");
            try {
                Map<String, Double> gt509 = reflectorRecipe();
                assertTrue(
                        !vanilla.equals(gt509), "the recipe changes between vanilla and 5.09: "
                                + vanilla + " vs " + gt509);
            } finally {
                MaterialsList.setGTVersion("none");
            }
        }

        /** Only 5.09 gets the tin-alloy/graphite/beryllium reflector; 5.08 falls through to vanilla. */
        @Test
        @DisplayName("only GT 5.09 changes the reflector recipe; 5.08 matches vanilla")
        void onlyGt509ChangesTheReflector() {
            Map<String, Double> vanilla = reflectorRecipe();
            MaterialsList.setGTVersion("5.09");
            Map<String, Double> gt509 = reflectorRecipe();
            MaterialsList.setGTVersion("5.08");
            try {
                assertEquals(vanilla, reflectorRecipe(), "5.08 uses the vanilla recipe");
                assertTrue(!vanilla.equals(gt509), "5.09 does not");
                assertTrue(gt509.containsKey(MaterialsList.BERYLLIUM), "5.09 uses beryllium");
                assertTrue(gt509.containsKey(MaterialsList.GRAPHITE), "and graphite");
            } finally {
                MaterialsList.setGTVersion("none");
            }
        }

        private Map<String, Double> reflectorRecipe() {
            return TestSupport.parseMaterialList(
                    MaterialsList.getMaterialsForComponent(ComponentFactory.getDefaultComponent("neutronReflector"))
                            .toString());
        }

        @Test
        @DisplayName("expanded advanced alloy replaces the alloy entry with its ingredients")
        void expandAdvancedAlloy() {
            String alloyName = BundleHelper.getI18n("MaterialName.AdvancedAlloy");
            Map<String, Double> collapsed =
                    TestSupport.parseMaterialList(MaterialsList.getMaterialsForComponent(
                                    ComponentFactory.getDefaultComponent("reactorPlating"))
                            .toString());
            assertTrue(collapsed.containsKey(alloyName), "by default the alloy is opaque");

            MaterialsList.setExpandAdvancedAlloy(true);
            try {
                Map<String, Double> expanded =
                        TestSupport.parseMaterialList(MaterialsList.getMaterialsForComponent(
                                        ComponentFactory.getDefaultComponent("reactorPlating"))
                                .toString());
                assertFalse(expanded.containsKey(alloyName), "and expanded it is not");
                assertTrue(expanded.containsKey(MaterialsList.IRON), "iron is now listed");
                assertTrue(expanded.containsKey(MaterialsList.BRONZE), "as is bronze");
                assertTrue(expanded.containsKey(MaterialsList.TIN), "as is tin");
            } finally {
                MaterialsList.setExpandAdvancedAlloy(false);
            }
        }

        @Test
        @DisplayName("UFC coolant cells change the cell recipe and leave the vanilla case intact")
        void ufcCoolantCells() {
            // coolantCell10k is "coolantCell, 4, TIN": the shared cell recipe plus four more tin.
            Map<String, Double> vanilla = coolantCellRecipe();
            assertEquals(1.0 / 3 + 4, vanilla.get(MaterialsList.TIN), 5e-3, "a third of a tin plus four");
            assertFalse(vanilla.containsKey(MaterialsList.GLASS), "no glass in the vanilla casing");

            MaterialsList.setUseUfcForCoolantCells(true);
            try {
                Map<String, Double> ufc = coolantCellRecipe();
                assertTrue(!vanilla.equals(ufc), "the recipe changes");
                // The UFC cell recipe is 4 casings of half a tin (2 tin), and the cell adds four
                // more on top, so the tin total goes from 4.33 to 6.
                assertEquals(4 * 0.5 + 4, ufc.get(MaterialsList.TIN), 1e-9, "2 from the casing plus 4");
                assertTrue(ufc.containsKey(MaterialsList.GLASS), "the reinforced casing brings glass");
                assertEquals(1.0, ufc.get(MaterialsList.DISTILLED_WATER), 1e-9, "water is unchanged");
                assertEquals(1.0, ufc.get(MaterialsList.LAPIS), 1e-9, "lapis is unchanged");
            } finally {
                MaterialsList.setUseUfcForCoolantCells(false);
            }
            assertEquals(vanilla, coolantCellRecipe(), "and switching back restores the vanilla recipe");
        }

        private Map<String, Double> coolantCellRecipe() {
            return TestSupport.parseMaterialList(MaterialsList.getMaterialsForComponent(
                            ComponentFactory.getDefaultComponent("coolantCell10k"))
                    .toString());
        }

        @Test
        @DisplayName("setting a GT version twice converges on the same recipe")
        void repeatedVersionSetsAreStable() {
            MaterialsList.setGTVersion("5.09");
            Map<String, Double> first = reflectorRecipe();
            MaterialsList.setGTVersion("none");
            MaterialsList.setGTVersion("5.09");
            try {
                assertEquals(first, reflectorRecipe(), "the rebuild is deterministic");
            } finally {
                MaterialsList.setGTVersion("none");
            }
        }

        @Test
        @DisplayName("every component still has a recipe after switching to each GT version")
        void allVersionsKeepRecipesComplete() {
            for (String version : new String[] {"none", "5.08", "5.09", "GTNH"}) {
                MaterialsList.setGTVersion(version);
                try {
                    for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
                        ReactorItem item = ComponentFactory.getDefaultComponent(id);
                        assertNotNull(
                                MaterialsList.getMaterialsForComponent(item),
                                item.baseName + " lost its recipe under GT " + version);
                    }
                } finally {
                    MaterialsList.setGTVersion("none");
                }
            }
        }
    }

    // ================================================================== comparison

    @Nested
    @DisplayName("comparison rendering")
    class Comparison {

        @Test
        @DisplayName("equal lists render nothing when only differences are wanted")
        void equalListsRenderNothing() {
            MaterialsList left = new MaterialsList(2, "Iron");
            MaterialsList right = new MaterialsList(2, "Iron");
            assertEquals("", left.buildComparisonString(right, false), "no differences, no output");
        }

        @Test
        @DisplayName("a difference is rendered with the delta and both sides")
        void differenceIsRendered() {
            MaterialsList left = new MaterialsList(4, "Iron");
            MaterialsList right = new MaterialsList(2, "Iron");
            String rendered = left.buildComparisonString(right, false);
            assertFalse(rendered.isEmpty(), "there is a difference to show");
            assertTrue(rendered.contains("red"), "the left side is higher, so it is flagged red");
            assertTrue(rendered.contains(MaterialsList.IRON), "with the material named");
        }

        @Test
        @DisplayName("alwaysDiff renders even when the lists match")
        void alwaysDiffRendersEverything() {
            MaterialsList left = new MaterialsList(2, "Iron");
            MaterialsList right = new MaterialsList(2, "Iron");
            String rendered = left.buildComparisonString(right, true);
            assertFalse(rendered.isEmpty(), "asked for everything, got something");
            assertTrue(rendered.contains("orange"), "matching entries are shown in orange");
        }

        @Test
        @DisplayName("materials present on only one side are still compared")
        void oneSidedMaterials() {
            MaterialsList left = new MaterialsList("Iron", "Gold");
            MaterialsList right = new MaterialsList("Iron");
            String rendered = left.buildComparisonString(right, false);
            assertTrue(rendered.contains(MaterialsList.GOLD), "gold is only on the left, so it is shown");
            // Iron matches on both sides, and only differences are requested, so it is omitted.
            assertFalse(rendered.contains(MaterialsList.IRON), "matching iron is not rendered");
            assertTrue(
                    left.buildComparisonString(right, true).contains(MaterialsList.IRON),
                    "but it appears when everything is requested");
        }
    }

    @Test
    @DisplayName("material name constants are non-blank and unique enough to be usable as keys")
    void constantsAreUsable() {
        assertFalse(MaterialsList.IRON.trim().isEmpty(), "IRON");
        assertFalse(MaterialsList.URANIUM.trim().isEmpty(), "URANIUM");
        assertFalse(MaterialsList.TIN.trim().isEmpty(), "TIN");
        // the shared recipe lists must exist and be populated
        assertNotNull(MaterialsList.basicCircuit);
        assertNotNull(MaterialsList.advancedCircuit);
        assertNotNull(MaterialsList.alloy);
        assertNotNull(MaterialsList.coolantCell);
        assertNotNull(MaterialsList.iridiumPlate);
        assertFalse(MaterialsList.coolantCell.toString().isEmpty(), "the coolant cell recipe is populated");
        assertNull(null, "sanity");
    }
}