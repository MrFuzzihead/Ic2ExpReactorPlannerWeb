import java.text.DecimalFormat;
import java.util.Locale;

/**
 * Oracle driver: prints what the real Java formatters produce for a spread of probe values, so
 * the JS ports of `String.format` and `java.text.DecimalFormat` can be matched against ground
 * truth rather than against a reading of the spec.
 *
 *   java -cp classes FormatProbe
 */
public class FormatProbe {
    public static void main(String[] argv) throws Exception {
        final double[] probes = {
            0.0, 0.5, 1.5, 2.5, 3.5, -0.5, -1.5, -2.5,
            0.125, 0.005, 0.015, 0.0005, 1.0 / 3.0, 2.0 / 3.0,
            999.994, 999.995, 999.999, 1000.0, 1000.004, 1000.005,
            1234.5678, 12345.678, 1234567.891, 123456789.0, 1e15, 1e16,
            -1234.5678, -0.0, 4.999999999, 5.000000001,
            250000.0, 626400.0, 18.0, 73.0, 3.0, 1.004, 15.004, 60.128, 182.112,
            0.049999999999999, 0.050000000000001,
        };
        final DecimalFormat plain = new DecimalFormat(java.util.ResourceBundle.getBundle("Ic2ExpReactorPlanner/Bundle").getString("Simulation.DecimalFormat"));
        final DecimalFormat compare = new DecimalFormat(java.util.ResourceBundle.getBundle("Ic2ExpReactorPlanner/Bundle").getString("Comparison.CompareDecimalFormat"));
        for (final double v : probes) {
            System.out.println("v=" + v);
            System.out.println("  DF        |" + plain.format(v) + "|");
            System.out.println("  CMP       |" + compare.format(v) + "|");
            System.out.println("  %,.2f     |" + String.format(Locale.US, "%,.2f", v) + "|");
            System.out.println("  %,.0f     |" + String.format(Locale.US, "%,.0f", v) + "|");
            System.out.println("  %,.2f DEF |" + String.format("%,.2f", v) + "|");
            System.out.println("  %,.0f DEF |" + String.format("%,.0f", v) + "|");
            System.out.println("  %.2f      |" + String.format(Locale.US, "%.2f", v) + "|");
            System.out.println("  %.0f      |" + String.format(Locale.US, "%.0f", v) + "|");
            System.out.println("  %s        |" + String.format(Locale.US, "%s", v) + "|");
        }
        // integer conversions, which is what the report's %d and %,d sites actually pass
        final int[] ints = {0, 1, 999, 1000, 4000, 1234567, 2147483647, -2147483648, -1};
        for (final int n : ints) {
            System.out.println("i=" + n);
            System.out.println("  %d        |" + String.format(Locale.US, "%d", n) + "|");
            System.out.println("  %,d       |" + String.format(Locale.US, "%,d", n) + "|");
            System.out.println("  %s        |" + String.format(Locale.US, "%s", n) + "|");
        }
        // DecimalFormat on the sentinels the report can actually reach
        final double huge = 1.0 / 0.0;
        final double nan = 0.0 / 0.0;
        System.out.println("DF huge |" + plain.format(huge) + "|");
        System.out.println("DF nan  |" + plain.format(nan) + "|");
        System.out.println("DF max  |" + plain.format(1.7976931348623157e308) + "|");
        System.out.println("DF -0   |" + plain.format(-0.0) + "|");
        System.out.println("DF big  |" + plain.format(1e20) + "|");
        System.out.println("DF 1e20 |" + String.format(Locale.US, "%,.0f", 1e20) + "|");
    }
}
