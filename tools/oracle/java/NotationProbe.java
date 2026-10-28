import java.util.Locale;

/**
 * Oracle driver: pins the exact boundary where `Double.toString` switches between plain decimal
 * and `xEyy` notation, for every decimal exponent and every significant-digit count.
 * `java.text.Formatter#formatFloat` branches on that, so the port needs the rule, not a guess.
 */
public class NotationProbe {
    public static void main(String[] argv) throws Exception {
        double[] powers = new double[25];
        powers[0] = 1e-4;
        for (int i = 1; i < powers.length; i++) powers[i] = powers[i - 1] * 10.0;

        // One probe per (exponent, significant-digit-count) pair, built by appending digits.
        for (int p = 0; p < 21; p++) {
            final double base = powers[p];
            for (int digits = 1; digits <= 17; digits++) {
                double v = 0.0;
                for (int k = 0; k < digits; k++) v = v * 10.0 + 1.0; // 1, 11, 111, ...
                v = v * base;
                System.out.println("e=" + (p - 4) + " d=" + digits + " |" + String.format(Locale.US, "%s", v)
                        + "| |" + String.format(Locale.US, "%.6f", v) + "|");
            }
        }
        // And the same for a value whose digits are not all 1, to rule out digit-specific rules.
        for (int p = 0; p < 21; p++) {
            final double base = powers[p];
            for (int digits = 1; digits <= 17; digits++) {
                double v = 0.0;
                for (int k = 0; k < digits; k++) v = v * 10.0 + (k % 9) + 1.0;
                v = v * base;
                System.out.println("mix e=" + (p - 4) + " d=" + digits + " |" + String.format(Locale.US, "%s", v)
                        + "| |" + String.format(Locale.US, "%.6f", v) + "|");
            }
        }
    }
}
