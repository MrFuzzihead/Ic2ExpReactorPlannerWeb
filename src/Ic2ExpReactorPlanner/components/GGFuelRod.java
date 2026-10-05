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

    @Override
    protected double getHeatBonus() {
        return this.heatBonus;
    }
}
