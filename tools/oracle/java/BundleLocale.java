package Ic2ExpReactorPlanner;

import java.util.ResourceBundle;
import java.util.Locale;

/**
 * Probe: what the desktop does with a locale bundle that is missing keys.
 *
 * `BundleHelper.java:11` calls `ResourceBundle.getBundle("Ic2ExpReactorPlanner/Bundle")`, which
 * picks the properties file from the system locale. `Bundle_zh_CN.properties` carries 419 entries
 * against the default bundle's 422, so three keys exist only in English -- two of them on the
 * report path a normal overheated run takes (`Simulation.HeatOutputsBeforeOverheated`,
 * `Simulation.EUOutputsBeforeOverheated`). This probe answers whether Java merges the default file
 * under the locale file or throws for those keys, because the web port has to make the same
 * decision and the answer is not the obvious one.
 *
 * Compile and run with the repo's `src` on the classpath so both properties files are visible:
 *   javac -d out probe/BundleLocale.java
 *   java -cp "<repo>/src;out" Ic2ExpReactorPlanner.BundleLocale
 */
public class BundleLocale {

    private static void show(ResourceBundle b, String key) {
        try {
            System.out.println(key + " => " + b.getString(key));
        } catch (Exception e) {
            System.out.println(key + " => THROWS " + e.getClass().getName() + ": " + e.getMessage());
        }
    }

    public static void main(String[] args) {
        ResourceBundle english = ResourceBundle.getBundle("Ic2ExpReactorPlanner/Bundle");
        ResourceBundle chinese = ResourceBundle.getBundle("Ic2ExpReactorPlanner/Bundle", new Locale("zh", "CN"));
        String[] keys = {
            "Simulation.HeatOutputsBeforeOverheated",
            "Simulation.EUOutputsBeforeOverheated",
            "Simulation.AbortedByError",
            "UI.SimulateButton",
            "Simulation.ReactorOverheatedTime",
        };
        for (String key : keys) {
            show(english, key);
            show(chinese, key);
        }
    }
}
