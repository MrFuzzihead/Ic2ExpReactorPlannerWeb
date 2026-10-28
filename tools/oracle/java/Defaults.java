import Ic2ExpReactorPlanner.ComponentFactory;
import Ic2ExpReactorPlanner.components.ReactorItem;

public class Defaults {
    public static void main(String[] args) {
        StringBuilder b = new StringBuilder();
        b.append("[\n");
        boolean first = true;
        for (int id = 0; id < 200; id++) {
            ReactorItem d = ComponentFactory.getDefaultComponent(id);
            if (d == null) continue;
            if (!first) b.append(",\n");
            first = false;
            b.append("  { \"id\": ").append(id)
             .append(", \"automationThreshold\": ").append(d.getAutomationThreshold())
             .append(", \"reactorPause\": ").append(d.getReactorPause())
             .append(" }");
        }
        b.append("\n]\n");
        System.out.println(b.toString());
    }
    private static String fmt(double v) {
        return (v == (long) v) ? String.valueOf((long) v) : String.valueOf(v);
    }
}
