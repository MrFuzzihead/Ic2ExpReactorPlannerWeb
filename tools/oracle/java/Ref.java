import Ic2ExpReactorPlanner.Reactor;
import Ic2ExpReactorPlanner.ComponentFactory;
import Ic2ExpReactorPlanner.WarningDisplay;
import Ic2ExpReactorPlanner.components.ReactorItem;
import java.util.*;

/**
 * Stage-1 reference oracle. Emits real reactor codes from the Java engine so the
 * JavaScript port can be checked against byte-identical output.
 *
 * Output: one line per design, TAB-separated:  name \t code \t oldCode \t roundTripOk
 */
public class Ref {

    private static void place(Reactor r, int row, int col, String name) {
        ReactorItem c = ComponentFactory.createComponent(name);
        if (c == null) throw new IllegalArgumentException("unknown component " + name);
        r.setComponentAt(row, col, c);
    }

    static List<String[]> designs = new java.util.ArrayList<String[]>();

    private static void emit(String name, Reactor r) {
        String code = r.getCode();
        String old = r.getOldCode();
        // self-consistency: the code the engine writes must read back to the same design
        Reactor copy = new Reactor();
        final List<String> warnings = new java.util.ArrayList<String>();
        WarningDisplay.setSink(new WarningDisplay.Sink() {
            public void warn(String t, String m) { warnings.add(t + " | " + m); }
        });
        boolean ok;
        try {
            copy.setCode(code);
            ok = copy.getCode().equals(code) && warnings.isEmpty();
        } catch (Exception e) {
            ok = false;
        }
        designs.add(new String[] { name, code, old, String.valueOf(ok) });
    }

    public static void main(String[] args) {
        // 1. empty grid, every field at its default
        Reactor r = new Reactor();
        emit("empty", r);

        // 2. a plain design, no per-component parameters
        r = new Reactor();
        place(r, 0, 0, "quadFuelRodUranium");
        place(r, 0, 1, "neutronReflector");
        place(r, 0, 2, "quadFuelRodUranium");
        place(r, 1, 0, "coolantCell60k");
        place(r, 1, 1, "heatVent");
        place(r, 2, 1, "reactorPlating");
        emit("uranium-basic", r);

        // 3. non-default initial heat on two cells (params present, flag bit set)
        r = new Reactor();
        ReactorItem rod = ComponentFactory.createComponent("dualFuelRodThorium");
        rod.setInitialHeat(12000);
        r.setComponentAt(3, 4, rod);
        ReactorItem vent = ComponentFactory.createComponent("advancedHeatVent");
        vent.setInitialHeat(1);
        r.setComponentAt(0, 8, vent);
        emit("preheated", r);

        // 4. automated with non-default threshold and pause
        r = new Reactor();
        r.setAutomated(true);
        ReactorItem ex = ComponentFactory.createComponent("coreHeatExchanger");
        ex.setAutomationThreshold(12345);
        ex.setReactorPause(678);
        r.setComponentAt(2, 2, ex);
        emit("automated", r);

        // 5. pulsed with every pulse field off its default
        r = new Reactor();
        r.setPulsed(true);
        r.setOnPulse(1234);
        r.setOffPulse(567);
        r.setSuspendTemp(90000);
        r.setResumeTemp(30000);
        place(r, 0, 0, "fuelRodMox");
        emit("pulsed", r);

        // 6. pulsed but every pulse field left at its default
        r = new Reactor();
        r.setPulsed(true);
        place(r, 5, 8, "quadFuelRodUranium");
        emit("pulsed-defaults", r);

        // 7. fluid-style and reactor coolant injectors
        r = new Reactor();
        r.setFluid(true);
        r.setUsingReactorCoolantInjectors(true);
        place(r, 1, 1, "coolantCellNak360k");
        emit("fluid-injectors", r);

        // 8. non-default simulation tick cap
        r = new Reactor();
        r.setMaxSimulationTicks(123456);
        emit("tick-cap", r);

        // 9. ids that only revision 4 can carry (59..72)
        r = new Reactor();
        place(r, 0, 0, "coolantCellNeutronium1G");   // id 59
        place(r, 0, 1, "fuelRodGlowstone");          // id 72
        place(r, 0, 2, "fuelRodCompressedPlutonium");// id 63
        emit("high-ids", r);

        // 10. initial heat at the component-heat bound
        r = new Reactor();
        ReactorItem hot = ComponentFactory.createComponent("quadFuelRodCoaxium");
        hot.setInitialHeat(Reactor.MAX_COMPONENT_HEAT);
        r.setComponentAt(5, 0, hot);
        emit("max-heat", r);

        // 11. everything switched on at once
        r = new Reactor();
        r.setFluid(true);
        r.setPulsed(true);
        r.setAutomated(true);
        r.setUsingReactorCoolantInjectors(true);
        r.setOnPulse(5000000);
        r.setOffPulse(1000000);
        r.setSuspendTemp(120000);
        r.setResumeTemp(120000);
        r.setMaxSimulationTicks(5000000);
        r.setCurrentHeat(119999);
        for (int row = 0; row < 6; row++) {
            for (int col = 0; col < 9; col++) {
                ReactorItem c = ComponentFactory.createComponent(1 + ((row * 9 + col) % 72));
                c.setInitialHeat((row * 9 + col) % 1000);
                c.setAutomationThreshold(9000 + row * 9 + col);
                c.setReactorPause((row + col) % 10000);
                r.setComponentAt(row, col, c);
            }
        }
        emit("everything", r);

        // 12. the fuzz seed, so the generated fuzz inputs are anchored to Java too
        r = new Reactor();
        place(r, 2, 2, "quadFuelRodUranium");
        place(r, 0, 8, "reactorPlating");
        r.setFluid(true);
        r.setPulsed(true);
        r.setOnPulse(1111);
        r.setCurrentHeat(2222);
        r.setMaxSimulationTicks(3333);
        emit("populated", r);

        for (String[] d : designs) {
            System.out.println(join(d, "\t"));
        }
    }

    private static String join(String[] a, String sep) {
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < a.length; i++) {
            if (i > 0) s.append(sep);
            s.append(a[i]);
        }
        return s.toString();
    }
}
