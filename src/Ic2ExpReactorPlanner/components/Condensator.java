/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */
package Ic2ExpReactorPlanner.components;

import java.awt.Image;

import static Ic2ExpReactorPlanner.AutomationSimulator.formatNumber;

/**
 * Represents a condensator in a reactor, either RSH or LZH.
 * @author Brian McCloud
 */
public class Condensator extends ReactorItem {

    public Condensator(
            final int id,
            final String baseName,
            final String name,
            final Image image,
            final double maxDamage,
            final double maxHeat,
            final String sourceMod) {
        super(id, baseName, name, image, maxDamage, maxHeat, sourceMod);
    }

    public Condensator(final Condensator other) {
        super(other);
    }

    @Override
    public double adjustCurrentHeat(final double heat) {
        if (heat < 0.0) {
            return heat;
        }
        // Clamp to the room actually left, not to maxHeat - heat. The old bound ignored
        // currentHeat entirely, so it under-accepted whenever the condensator was partly full,
        // and went *negative* for a packet larger than the capacity -- which, because
        // FuelRod.handleHeat discards this return value, silently deleted the rod's entire heat
        // output from the reactor. See CODE_REVIEW.md P0-2.
        //
        // currentHeat is held within [0, maxHeat] by this method together with the three
        // setters, so the bound below is never negative and currentHeat cannot decrease.
        final double acceptedHeat = Math.min(heat, getMaxHeat() - currentHeat);
        currentHeat += acceptedHeat;
        maxReachedHeat = Math.max(maxReachedHeat, currentHeat);
        // Record what was actually absorbed, not what was offered, so the reported cooling
        // matches the heat the condensator really took (CODE_REVIEW.md P3-18).
        currentCondensatorCooling += acceptedHeat;
        bestCondensatorCooling = Math.max(currentCondensatorCooling, bestCondensatorCooling);
        // This returns the *positive* amount refused, the opposite sign to the base class's
        // convention. Preserved deliberately: no caller reads it, and changing it here would
        // be an unrelated behaviour change.
        return heat - acceptedHeat;
    }

    @Override
    public boolean needsCoolantInjected() {
        return currentHeat > 0.85 * getMaxHeat();
    }

    @Override
    public void injectCoolant() {
        currentHeat = 0;
    }

    @Override
    public String[] formatTooltip() {
        return new String[] {
                formatNumber(maxHeat)
        };
    }
}
