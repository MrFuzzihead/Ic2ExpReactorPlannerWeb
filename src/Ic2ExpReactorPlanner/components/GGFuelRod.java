package Ic2ExpReactorPlanner.components;

import java.awt.*;

public class GGFuelRod extends FuelRod {

    private final int rodCount;
    private final double energyMult;
    private final int heatBonus;

    private static boolean GTNHbehavior = false;

    public static void setGTNHBehavior(boolean value) {
        GTNHbehavior = value;
    }

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
        this.energyMult = energyMult;
        this.rodCount = rodCount;
        this.heatBonus = heatBonus;
    }

    public GGFuelRod(GGFuelRod other) {
        super(other);
        this.energyMult = other.energyMult;
        this.rodCount = other.rodCount;
        this.heatBonus = other.heatBonus;
    }

    @Override
    protected double getHeatBonus() {
        return this.heatBonus;
    }
}
