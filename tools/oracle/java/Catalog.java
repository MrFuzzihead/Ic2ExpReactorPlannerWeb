import Ic2ExpReactorPlanner.ComponentFactory;
import Ic2ExpReactorPlanner.Reactor;
import Ic2ExpReactorPlanner.components.ReactorItem;
import Ic2ExpReactorPlanner.components.Reflector;
import java.util.ArrayList;
import java.util.List;

/**
 * Oracle dump of every component's OBSERVABLE fields. The subclass-specific constructor
 * arguments (energyMult, switchSide, heatBonus, ...) are private with no getter, so the
 * catalog itself is a source extraction; this dump is the cross-check on everything the
 * engine can actually see.
 */
public class Catalog {

    private static String num(double v) {
        if (v == Math.floor(v) && Math.abs(v) < 1e15) return String.valueOf((long) v);
        return String.valueOf(v);
    }

    private static String bool(boolean v) { return v ? "true" : "false"; }

    public static void main(String[] argv) {
        List<String> lines = new java.util.ArrayList<String>();
        int count = ComponentFactory.getComponentCount();
        for (int id = 1; id < count; id++) {
            ReactorItem item = ComponentFactory.createComponent(id);
            List<String> f = new java.util.ArrayList<String>();
            f.add("\"id\":" + num(item.id));
            f.add("\"baseName\":\"" + item.baseName + "\"");
            f.add("\"sourceMod\":" + (item.sourceMod == null ? "null" : "\"" + item.sourceMod + "\""));
            f.add("\"maxDamage\":" + num(item.getMaxDamage()));
            f.add("\"maxHeat\":" + num(item.getMaxHeat()));
            f.add("\"automationThreshold\":" + num(item.getAutomationThreshold()));
            f.add("\"reactorPause\":" + num(item.getReactorPause()));
            f.add("\"initialHeat\":" + num(item.getInitialHeat()));
            f.add("\"isHeatAcceptor\":" + bool(item.isHeatAcceptor()));
            f.add("\"isCoolable\":" + bool(item.isCoolable()));
            f.add("\"isNeutronReflector\":" + bool(item.isNeutronReflector()));
            f.add("\"rodCount\":" + num(item.getRodCount()));
            f.add("\"ventCoolingCapacity\":" + num(item.getVentCoolingCapacity()));
            f.add("\"hullCoolingCapacity\":" + num(item.getHullCoolingCapacity()));
            f.add("\"explosionPowerMultiplier\":" + num(item.getExplosionPowerMultiplier()));
            f.add("\"explosionPowerOffset\":" + num(item.getExplosionPowerOffset()));
            f.add("\"producesOutput\":" + bool(item.producesOutput()));
            f.add("\"needsCoolantInjected\":" + bool(item.needsCoolantInjected()));
            f.add("\"getCurrentOutput\":" + num(item.getCurrentOutput()));
            lines.add("{" + String.join(",", f) + "}");
        }

        // Reflector overrides getMaxDamage() per Minecraft version; pin the two that matter.
        Reflector.setMcVersion("1.7.10");
        List<String> at1710 = new java.util.ArrayList<String>();
        for (int id = 1; id < count; id++) {
            at1710.add(num(ComponentFactory.createComponent(id).getMaxDamage()));
        }
        Reflector.setMcVersion("1.12.2");
        lines.add("{\"__reflectorMaxDamageAt1710\":[" + String.join(",", at1710) + "]}");

        // Plating adjusts the reactor's max heat on contact; that is how heatAdjustment shows up.
        Reactor r = new Reactor();
        double base = r.getMaxHeat();
        for (int id = 1; id < count; id++) {
            ReactorItem probe = ComponentFactory.createComponent(id);
            Reactor withProbe = new Reactor();
            withProbe.setComponentAt(0, 0, probe);
            lines.add("{\"__maxHeatWith\":" + num(withProbe.getMaxHeat()) + ",\"at\":" + num(id) + "}");
        }
        lines.add("{\"__baseMaxHeat\":" + num(base) + "}");

        for (String line : lines) System.out.println(line);
    }
}
