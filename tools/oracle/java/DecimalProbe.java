import java.util.Locale;
import java.text.DecimalFormat;


/**
 * Oracle driver: `java.text.DecimalFormat` behaviour for the two patterns the planner actually
 * uses -- `#,##0.##` (Simulation.DecimalFormat, UI.MaterialDecimalFormat,
 * Comparison.SimpleDecimalFormat) and `+#,##0.##;-#` (Comparison.CompareDecimalFormat) -- plus
 * the ICU rounding rule against values that sit exactly on a rounding boundary.
 */
public class DecimalProbe {
    public static void main(String[] argv) throws Exception {
        final DecimalFormat simple = new DecimalFormat("#,##0.##");
        final DecimalFormat compare = new DecimalFormat("+#,##0.##;-#");
        final double[] probes = {
            0.0, -0.0, 1.0, -1.0, 0.004, 0.005, 0.0049999, 0.015, 0.025, 0.125, 0.135,
            1.004, 1.005, 1.006, 1.0049999, 15.004, 15.005, 182.112, 60.128, 60.125,
            999.995, 1000.005, 1000.015, 1234.565, 1234.575, 1e15, 1e16, 1.5e17, 1e20,
            1.0 / 3.0, 2.0 / 3.0, 1.0 / 8.0, 3.0 / 8.0, 5.0 / 8.0, 7.0 / 8.0,
            0.5, 1.5, 2.5, 3.5, 2.675, 1.005, 0.0001, 1e-9, 1234567890123.0,
            12345678901234567.0, 0.1 + 0.2, 100.0 / 3.0, 1000000.0 / 3.0,
            -0.5, -1.5, -0.1, -0.005, -0.015, -0.125, -1.005, -1234.5678, -2.0 / 3.0,
            -0.004, -0.0049999, -1e-9, -1234567890123.0, -1000000.0 / 3.0,
        };
        for (final double v : probes) {
            System.out.println(v + " simple=[" + simple.format(v) + "] compare=[" + compare.format(v)
                    + "] raw=[" + simple.format(v).replace(",", "") + "]");
        }
    }
}
