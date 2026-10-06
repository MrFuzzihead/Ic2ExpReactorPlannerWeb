/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */
package Ic2ExpReactorPlanner.components;

import java.awt.Image;

import static Ic2ExpReactorPlanner.AutomationSimulator.formatNumber;

/**
 * Represents a coolant cell in a reactor.
 * @author Brian McCloud
 */
public class CoolantCell extends ReactorItem {

    public CoolantCell(
            final int id,
            final String baseName,
            final String name,
            final Image image,
            final double maxDamage,
            final double maxHeat,
            final String sourceMod) {
        super(id, baseName, name, image, maxDamage, maxHeat, sourceMod);
    }

    public CoolantCell(final CoolantCell other) {
        super(other);
    }

    @Override
    public double adjustCurrentHeat(final double heat) {
        // The cell's cooling credit is the heat it absorbs, so only a positive adjustment counts --
        // draining the cell is not "negative cooling". Condensator guards the same way, by
        // early-returning on heat < 0. Unguarded, a component heat vent draining this cell
        // (Vent.handleSideVentCooling passes -sideVent) decrements the running figure, so +500,
        // -900, -2000, +300 left currentCellCooling at -2 100. bestCellCooling is what the report
        // prints ("ReceivedHeat" / "Total Cell Cooling") and it is a Math.max, so the dip was
        // invisible in the UI; the guard makes the running figure agree with the peak. See CODE_REVIEW.md P3-6.
        if (heat > 0.0) {
            currentCellCooling += heat;
            bestCellCooling = Math.max(currentCellCooling, bestCellCooling);
        }
        return super.adjustCurrentHeat(heat);
    }

    @Override
    public String[] formatTooltip() {
        return new String[] {
                formatNumber(maxHeat)
        };
    }
}
