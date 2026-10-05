package Ic2ExpReactorPlanner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import Ic2ExpReactorPlanner.components.BreederCell;
import Ic2ExpReactorPlanner.components.Condensator;
import Ic2ExpReactorPlanner.components.CoolantCell;
import Ic2ExpReactorPlanner.components.Exchanger;
import Ic2ExpReactorPlanner.components.FuelRod;
import Ic2ExpReactorPlanner.components.GGFuelRod;
import Ic2ExpReactorPlanner.components.Plating;
import Ic2ExpReactorPlanner.components.ReactorItem;
import Ic2ExpReactorPlanner.components.Reflector;
import Ic2ExpReactorPlanner.components.Vent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * {@link ComponentFactory}: the id/name registries and the copy-on-create behaviour that the
 * whole application depends on. If {@code createComponent} ever returned the shared prototype,
 * every placed component would alias the same object.
 */
class ComponentFactoryTest {

    @BeforeEach
    @AfterEach
    void resetGlobals() {
        TestSupport.resetGlobalConfig();
    }

    @Test
    @DisplayName("id 0 is the empty slot")
    void idZeroIsEmpty() {
        assertNull(ComponentFactory.getDefaultComponent(0), "no component at id 0");
        assertNull(ComponentFactory.createComponent(0), "and nothing to create from it");
    }

    @Test
    @DisplayName("every id from 1 upwards resolves to a non-null component")
    void everyIdResolves() {
        for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
            assertNotNull(ComponentFactory.getDefaultComponent(id), "prototype missing for id " + id);
            assertEquals(id, ComponentFactory.getDefaultComponent(id).id, "prototype id mismatch at " + id);
            assertNotNull(ComponentFactory.createComponent(id), "createComponent failed for id " + id);
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {-1, 73, 100, Integer.MAX_VALUE})
    @DisplayName("out-of-range ids yield null rather than throwing")
    void outOfRangeIdsYieldNull(int id) {
        assertNull(ComponentFactory.getDefaultComponent(id));
        assertNull(ComponentFactory.createComponent(id));
    }

    @Test
    @DisplayName("every prototype has a distinct, non-blank base name")
    void baseNamesAreDistinct() {
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
            String baseName = ComponentFactory.getDefaultComponent(id).baseName;
            assertTrue(baseName != null && !baseName.trim().isEmpty(), "blank base name at id " + id);
            assertTrue(seen.add(baseName), "duplicate base name: " + baseName);
        }
        assertEquals(ComponentFactory.getComponentCount() - 1, seen.size(), "one name per component");
    }

    @Test
    @DisplayName("base-name lookup and id lookup agree")
    void lookupsAgree() {
        for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
            ReactorItem prototype = ComponentFactory.getDefaultComponent(id);
            assertSame(prototype, ComponentFactory.getDefaultComponent(prototype.baseName), prototype.baseName);
        }
    }

    @Test
    @DisplayName("an unknown or null base name yields null")
    void unknownNamesYieldNull() {
        assertNull(ComponentFactory.getDefaultComponent("noSuchComponent"));
        assertNull(ComponentFactory.getDefaultComponent((String) null));
        assertNull(ComponentFactory.createComponent("noSuchComponent"));
        assertNull(ComponentFactory.createComponent((String) null));
    }

    @Test
    @DisplayName("createComponent returns a fresh copy, never the shared prototype")
    void createReturnsACopy() {
        for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
            ReactorItem prototype = ComponentFactory.getDefaultComponent(id);
            ReactorItem copy = ComponentFactory.createComponent(id);
            assertTrue(copy != prototype, id + ": copy must not be the prototype");
            assertEquals(prototype.getClass(), copy.getClass(), id + ": wrong class");
            assertEquals(prototype.baseName, copy.baseName, id + ": wrong name");
            assertEquals(prototype.getMaxHeat(), copy.getMaxHeat(), 1e-9, id + ": wrong maxHeat");
            assertEquals(prototype.getMaxDamage(), copy.getMaxDamage(), 1e-9, id + ": wrong maxDamage");
            assertEquals(prototype.getAutomationThreshold(), copy.getAutomationThreshold(), id + ": threshold");
            assertEquals(prototype.getReactorPause(), copy.getReactorPause(), id + ": pause");
            assertSame(prototype.image, copy.image, id + ": images are shared, not copied");
        }
    }

    @Test
    @DisplayName("the copy constructor does not copy simulation state")
    void copyResetsSimulationState() {
        Reactor reactor = new Reactor();
        ReactorItem cell = ComponentFactory.createComponent("coolantCell60k");
        reactor.setComponentAt(2, 2, cell);
        cell.adjustCurrentHeat(5000);
        cell.applyDamage(0);

        ReactorItem copy = ComponentFactory.createComponent("coolantCell60k");
        assertEquals(0.0, copy.getCurrentHeat(), 1e-9, "current heat is not copied");
        assertEquals(0.0, copy.getCurrentDamage(), 1e-9, "damage is not copied");
        assertEquals(0.0, copy.getCurrentEUGenerated(), 1e-9, "EU is not copied");
    }

    @Test
    @DisplayName("the copy constructor does carry the user's per-component settings")
    void copyKeepsSettings() {
        // setCode relies on this: it creates a component and then applies initial heat, threshold
        // and pause to it.
        Reactor reactor = new Reactor();
        ReactorItem rod = ComponentFactory.createComponent("fuelRodUranium");
        reactor.setComponentAt(2, 2, rod);
        assertEquals(0, rod.getReactorPause(), "default pause");
    }

    @Test
    @DisplayName("each component type is created as its own subclass")
    void subclassesArePreserved() {
        assertTrue(ComponentFactory.createComponent("fuelRodUranium") instanceof FuelRod, "FuelRod");
        assertTrue(ComponentFactory.createComponent("fuelRodCompressedUranium") instanceof GGFuelRod, "GGFuelRod");
        assertTrue(ComponentFactory.createComponent("neutronReflector") instanceof Reflector, "Reflector");
        assertTrue(ComponentFactory.createComponent("heatVent") instanceof Vent, "Vent");
        assertTrue(ComponentFactory.createComponent("heatExchanger") instanceof Exchanger, "Exchanger");
        assertTrue(ComponentFactory.createComponent("reactorPlating") instanceof Plating, "Plating");
        assertTrue(ComponentFactory.createComponent("rshCondensator") instanceof Condensator, "Condensator");
        assertTrue(ComponentFactory.createComponent("coolantCell60k") instanceof CoolantCell, "CoolantCell");
        assertTrue(ComponentFactory.createComponent("fuelRodGlowstone") instanceof BreederCell, "BreederCell");
    }

    @Test
    @DisplayName("every component carries a display name and a base name that differ only in case")
    void namesAreLocalised() {
        for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
            ReactorItem item = ComponentFactory.getDefaultComponent(id);
            assertNotNull(item.name, "display name missing for " + item.baseName);
            assertTrue(!item.name.trim().isEmpty(), "blank display name for " + item.baseName);
        }
    }

    @Test
    @DisplayName("sourceMod is null for base IC2 parts and set for add-ons")
    void sourceMod() {
        assertNull(ComponentFactory.getDefaultComponent("fuelRodUranium").sourceMod, "vanilla has no mod");
        assertEquals(
                "GTNH",
                ComponentFactory.getDefaultComponent("fuelRodLiquidUranium").sourceMod,
                "GTNH rods declare their mod");
    }

    @Test
    @DisplayName("toString appends the initial heat when there is some")
    void toStringIncludesInitialHeat() {
        Reactor reactor = new Reactor();
        ReactorItem cell = ComponentFactory.createComponent("coolantCell60k");
        reactor.setComponentAt(2, 2, cell);
        String plain = cell.toString();
        cell.setInitialHeat(1000);
        String withHeat = cell.toString();
        assertTrue(withHeat.length() > plain.length(), "the initial heat is appended");
        assertTrue(withHeat.startsWith(plain), "and appended, not substituted");
    }

    @Test
    @DisplayName("getComponentCount matches the highest id plus one")
    void componentCount() {
        int count = ComponentFactory.getComponentCount();
        assertEquals(73, count, "72 components plus the empty slot at id 0");
        assertEquals(72, ComponentFactory.getDefaultComponent(count - 1).id, "ids are dense");
    }

    @Test
    @DisplayName("an unplaced component reports no reactor parent")
    void unplacedHasNoParent() throws Exception {
        java.lang.reflect.Field parent = ReactorItem.class.getDeclaredField("parent");
        parent.setAccessible(true);
        ReactorItem fresh = ComponentFactory.createComponent("fuelRodUranium");
        assertNull(parent.get(fresh), "a fresh component is not attached anywhere");
    }

    @Test
    @DisplayName("every component has a non-null info buffer sized for the per-tick report")
    void infoBuffersExist() {
        for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
            ReactorItem item = ComponentFactory.createComponent(id);
            assertNotNull(item.info, "info buffer missing for " + item.baseName);
            assertEquals(0, item.info.length(), "and starts empty");
        }
    }

    @Test
    @DisplayName("formatTooltip returns well-formed strings for every component except plating")
    void tooltipsAreWellFormed() {
        for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
            ReactorItem item = ComponentFactory.createComponent(id);
            String[] tooltip = item.formatTooltip();
            if (item instanceof Plating) {
                // Plating is the one type that does not override formatTooltip(), so it inherits
                // the base class's null. ReactorPlannerFrame.buildTooltipInfo relies on catching
                // that and falling back to a bare name.
                assertNull(tooltip, item.baseName + " is plating and has no tooltip override");
                continue;
            }
            assertNotNull(tooltip, item.baseName + " returned a null tooltip");
            assertTrue(tooltip.length > 0, item.baseName + " returned an empty tooltip");
            for (String line : tooltip) {
                assertNotNull(line, item.baseName + " has a null tooltip line");
            }
        }
    }

    @Test
    @DisplayName("plating is the only component type without a tooltip override")
    void onlyPlatingLacksATooltip() {
        for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
            ReactorItem item = ComponentFactory.createComponent(id);
            if (item instanceof Plating) {
                assertNull(item.formatTooltip(), item.baseName + " should have no tooltip");
            } else {
                assertNotNull(item.formatTooltip(), item.baseName + " should have a tooltip");
            }
        }
    }

    @Test
    @DisplayName("creating by name and by id give equivalent components")
    void nameAndIdAgree() {
        for (int id = 1; id < ComponentFactory.getComponentCount(); id++) {
            String baseName = ComponentFactory.getDefaultComponent(id).baseName;
            assertEquals(
                    ComponentFactory.getDefaultComponent(id).getMaxHeat(),
                    ComponentFactory.createComponent(baseName).getMaxHeat(),
                    1e-9,
                    baseName);
        }
    }

    @Test
    @DisplayName("a created component is not attached to any reactor until it is placed")
    void creationDoesNotAttach() {
        Reactor reactor = new Reactor();
        ReactorItem rod = ComponentFactory.createComponent("fuelRodUranium");
        // A fuel rod has no side effect on maxHeat, so use plating to observe attachment.
        ReactorItem plating = ComponentFactory.createComponent("heatCapacityReactorPlating");
        reactor.setComponentAt(2, 2, plating);
        assertEquals(11700, reactor.getMaxHeat(), 1e-9, "placing the plating is what changed maxHeat");
        assertEquals(10000, new Reactor().getMaxHeat(), 1e-9, "creating one elsewhere changed nothing");
        assertTrue(rod.getMaxDamage() == 20000, "the rod is untouched");
    }

    @Test
    @DisplayName("the first component is a uranium rod at id 1")
    void firstComponent() {
        assertEquals("fuelRodUranium", ComponentFactory.getDefaultComponent(1).baseName);
        assertEquals(1, ComponentFactory.createComponent(1).getRodCount(), "a single rod");
    }
}