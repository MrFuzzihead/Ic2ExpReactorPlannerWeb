package Ic2ExpReactorPlanner.components;

import java.awt.*;

public class GGFuelRod extends FuelRod {

    private final int heatBonus;

    public GGFuelRod(
            int id,
            String baseName,
            String name,
            Image image,
            double maxDamage,
            double maxHeat,
            String sourceMod,
            int energyMult,
            double heatMult,
            int rodCount,
            boolean moxStyle,
            int heatBonus) {
        super(id, baseName, name, image, maxDamage, maxHeat, sourceMod, energyMult, heatMult, rodCount, moxStyle);
        this.heatBonus = heatBonus;
    }

    public GGFuelRod(GGFuelRod other) {
        super(other);
        this.heatBonus = other.heatBonus;
    }

    /**
     * P3-17: replacing {@code FuelRod.getHeatBonus()} wholesale is deliberate, not a shadowing bug.
     * GG is GoodGenerator, a GTNH sub-mod, and all twelve entries in {@code ComponentFactory} carry
     * {@code sourceMod = "GTNH"}, so the rod is GTNH-native whatever the user's version toggle says
     * - that toggle re-tunes the vanilla rods, whose {@code sourceMod} is null. {@code FuelRod}
     * derives the bonus from the mode because a vanilla rod has no value of its own; a GoodGenerator
     * rod does (6 for high-density plutonium, 2 for excited plutonium, and 0 for the uranium
     * variants, which are not mox-style and never consult the value). Both kinds of value are the
     * same kind of number: each multiplies the hull-heat ratio in {@code (1 + bonus * ratio)}, so
     * the rod's own value replaces the mode-derived one rather than adding to it. Pinned by
     * {@code PassiveComponentsTest.GGFuelRods}.
     */
    @Override
    protected double getHeatBonus() {
        return this.heatBonus;
    }
}
