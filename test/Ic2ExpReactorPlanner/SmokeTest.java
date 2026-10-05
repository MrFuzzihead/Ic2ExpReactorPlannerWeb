package Ic2ExpReactorPlanner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import Ic2ExpReactorPlanner.components.ReactorItem;
import org.junit.jupiter.api.Test;

/** Smoke test: proves the test source set, JUnit platform and resource classpath are wired up. */
class SmokeTest {

    @Test
    void resourceBundleIsOnTheTestClasspath() {
        // getI18n() resolves through ResourceBundle.getBundle("Ic2ExpReactorPlanner/Bundle"),
        // which lives under src/ and is only copied there by the processAssets task.
        assertNotNull(BundleHelper.getI18n("Simulation.Started"));
    }

    @Test
    void componentFactoryInitialises() {
        assertTrue(ComponentFactory.getComponentCount() > 1);
        ReactorItem rod = ComponentFactory.createComponent("fuelRodUranium");
        assertNotNull(rod);
        assertEquals(1, rod.getRodCount());
    }

    @Test
    void codeRoundTrips() {
        Reactor reactor = new Reactor();
        reactor.setComponentAt(2, 3, ComponentFactory.createComponent("dualFuelRodUranium"));
        String code = reactor.getCode();
        Reactor back = new Reactor();
        back.setCode(code);
        assertEquals(code, back.getCode());
    }
}