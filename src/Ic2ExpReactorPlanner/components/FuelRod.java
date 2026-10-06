/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */
package Ic2ExpReactorPlanner.components;

import java.awt.Image;
import java.util.ArrayList;
import java.util.List;
import java.util.function.IntFunction;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static Ic2ExpReactorPlanner.AutomationSimulator.formatNumber;
import static Ic2ExpReactorPlanner.BundleHelper.getI18n;

/**
 * Represents some form of fuel rod (may be single, dual, or quad).
 * @author Brian McCloud
 */
public class FuelRod extends ReactorItem {

    private final int energyMult;
    private final double heatMult;
    private final int rodCount;
    private final boolean moxStyle;

    // P3-11: written on the EDT by the version-combo handlers (ReactorPlannerFrame.java:2372-2381)
    // and read from the simulation thread through generateHeat (:177), getEnergy (:188), getHeatBonus
    // (:208) and generateEnergy (:217), which AutomationSimulator.java:228 and :241 call every tick.
    // There is no happens-before edge between those two paths, so both flags need volatile: without it
    // a simulation that is already running may never see a version change the user made mid-run.
    private static volatile boolean GT509behavior = false;
    private static volatile boolean GTNHbehavior = false;

    private static final int[][] DIRECTIONS = {{1, 0}, {-1, 0}, {0, -1}, {0, 1}};

    public static void setGT509Behavior(boolean value) {
        GT509behavior = value;
    }

    public static void setGTNHBehavior(boolean value) {
        GTNHbehavior = value;
    }

    public FuelRod(
            final int id,
            final String baseName,
            final String name,
            final Image image,
            final double maxDamage,
            final double maxHeat,
            final String sourceMod,
            final int energyMult,
            final double heatMult,
            final int rodCount,
            final boolean moxStyle) {
        super(id, baseName, name, image, maxDamage, maxHeat, sourceMod);
        this.energyMult = energyMult;
        this.heatMult = heatMult;
        this.rodCount = rodCount;
        this.moxStyle = moxStyle;
    }

    public FuelRod(final FuelRod other) {
        super(other);
        this.energyMult = other.energyMult;
        this.heatMult = other.heatMult;
        this.rodCount = other.rodCount;
        this.moxStyle = other.moxStyle;
    }

    @Override
    public boolean isNeutronReflector() {
        return !isBroken();
    }

    private int countNeutronNeighbors() {
        int neutronNeighbors = 0;
        for (int[] dir : DIRECTIONS) {
            ReactorItem component = parent.getComponentAt(row + dir[0], col + dir[1]);
            if (component != null && component.isNeutronReflector()) {
                neutronNeighbors++;
            }
        }
        return neutronNeighbors;
    }

    private int countNeutronNumberNeighbors() {
        int neutronNumberNeighbors = 0;
        for (int[] dir : DIRECTIONS) {
            ReactorItem component = parent.getComponentAt(row + dir[0], col + dir[1]);
            if (component != null && component.isNeutronReflector()) {
                if (component instanceof FuelRod) {
                    neutronNumberNeighbors += ((FuelRod) component).rodCount;
                } else if (component instanceof Reflector) {
                    neutronNumberNeighbors += this.rodCount;
                }
            }
        }
        return neutronNumberNeighbors;
    }

    protected List<ReactorItem> getHeatableNeighbors() {
        List<ReactorItem> heatableNeighbors = new ArrayList<>(4);
        for (int[] dir : DIRECTIONS) {
            ReactorItem component = parent.getComponentAt(row + dir[0], col + dir[1]);
            if (component != null && component.isHeatAcceptor()) {
                heatableNeighbors.add(component);
            }
        }
        return heatableNeighbors;
    }

    protected List<ReactorItem> getGTHeatableNeighbors() {
        List<ReactorItem> heatableNeighbors = new ArrayList<>(4);
        ReactorItem component = parent.getComponentAt(row, col - 1);
        if (component != null && component.isHeatAcceptor()) {
            heatableNeighbors.add(component);
        }
        component = parent.getComponentAt(row, col + 1);
        if (component != null && component.isHeatAcceptor()) {
            heatableNeighbors.add(component);
        }
        component = parent.getComponentAt(row + 1, col);
        if (component != null && component.isHeatAcceptor()) {
            heatableNeighbors.add(component);
        }
        component = parent.getComponentAt(row - 1, col);
        if (component != null && component.isHeatAcceptor()) {
            heatableNeighbors.add(component);
        }
        return heatableNeighbors;
    }

    protected void handleHeat(final int heat) {
        List<ReactorItem> heatableNeighbors = getHeatableNeighbors();
        if (heatableNeighbors.isEmpty()) {
            parent.adjustCurrentHeat(heat);
            currentHullHeating = heat;
        } else {
            currentComponentHeating = heat;
            for (ReactorItem heatableNeighbor : heatableNeighbors) {
                heatableNeighbor.adjustCurrentHeat(heat / heatableNeighbors.size());
            }
            int remainderHeat = heat % heatableNeighbors.size();
            heatableNeighbors.get(0).adjustCurrentHeat(remainderHeat);
        }
    }

    protected void handleGTHeat(final int heat) {
        List<ReactorItem> heatableNeighbors = getGTHeatableNeighbors();
        if (heatableNeighbors.isEmpty()) {
            parent.adjustCurrentHeat(heat);
            currentHullHeating = heat;
        } else {
            currentComponentHeating = heat;
            int everCycleHeat = heat / rodCount;
            for (int i = 0; i < heatableNeighbors.size(); i++) {
                int toNeighborHeat = everCycleHeat / (heatableNeighbors.size() - i);
                everCycleHeat -= toNeighborHeat;
                heatableNeighbors.get(i).adjustCurrentHeat(rodCount * toNeighborHeat);
            }
        }
    }

    protected double getHeat(int neighbors) {
        int pulses = neighbors + 1 + rodCount / 2;
        return heatMult * pulses * (pulses + 1);
    }

    @Override
    public double generateHeat() {
        int heat = (int) (getHeat(countNeutronNeighbors()));
        if (moxStyle && parent.isFluid() && (parent.getCurrentHeat() / parent.getMaxHeat()) > 0.5) {
            heat *= 2;
        }
        currentHeatGenerated = heat;
        minHeatGenerated = Math.min(minHeatGenerated, heat);
        maxHeatGenerated = Math.max(maxHeatGenerated, heat);
        if (GT509behavior || GTNHbehavior) {
            handleGTHeat(heat);
        } else {
            handleHeat(heat);
        }
        return currentHeatGenerated;
    }

    protected double getEnergy(int neighbors, double moxHeatMultiplier) {
        int pulses = neighbors + 1 + rodCount / 2;
        double energy = energyMult * pulses;
        if (GT509behavior || "GT5.09".equals(sourceMod)) {
            energy *= 2; // EUx2 if from GT5.09 or in GT5.09 mode
        }
        if (moxStyle) {
            energy *= (1 + getHeatBonus() * moxHeatMultiplier);
        }
        return energy;
    }

    protected double getGTNHEnergy(int neutronNumber, double moxHeatMultiplier) {
        double energyMulti = this.energyMult * 10 * (1 + rodCount / 2);
        double coefficient = (double) (energyMult * 10) /  rodCount;
        double energy = energyMulti + coefficient * neutronNumber;
        if (moxStyle) {
            energy *= (1 + getHeatBonus() * moxHeatMultiplier);
        }
        return energy;
    }

    protected double getHeatBonus() {
        if (GT509behavior || "GT5.09".equals(sourceMod) || GTNHbehavior || "GTNH".equals(sourceMod)) {
            return 1.5;
        }
        return 4.0;
    }

    @Override
    public double generateEnergy() {
        double energy;
        if (GTNHbehavior || "GTNH".equals(sourceMod)) {
            energy = getGTNHEnergy(countNeutronNumberNeighbors(), parent.getCurrentHeat() / parent.getMaxHeat());
        } else {
            energy = getEnergy(countNeutronNeighbors(), parent.getCurrentHeat() / parent.getMaxHeat());
        }
        minEUGenerated = Math.min(minEUGenerated, energy);
        maxEUGenerated = Math.max(maxEUGenerated, energy);
        currentEUGenerated = energy;
        parent.addEUOutput(energy);
        applyDamage(1.0);
        return energy;
    }

    @Override
    public int getRodCount() {
        return rodCount;
    }

    @Override
    public double getCurrentOutput() {
        if (parent != null) {
            if (parent.isFluid()) {
                return currentHeatGenerated;
            } else {
                return currentEUGenerated;
            }
        }
        return 0;
    }

    protected String getTooltipHeat(int neighbors, int multiplier) {
        return formatNumber(getHeat(neighbors) * multiplier);
    }

    public String getTooltipGTNHEnergy(double moxHeatMultiplier) {
        double energyMulti = this.energyMult * 10 * (1 + rodCount / 2);
        double coefficient = (double) (energyMult * 10) /  rodCount;
        if (moxStyle) {
            energyMulti *= 1 + getHeatBonus() * moxHeatMultiplier;
            coefficient *= 1 + getHeatBonus() * moxHeatMultiplier;
        }
        return formatNumber(convertToTick(energyMulti)) + "+" + formatNumber(convertToTick(coefficient)) + "*" + getI18n("ComponentTooltip.NeutronNumber");
    }

    public String buildTooltipGTNHEnergy() {
        if (!moxStyle) {
            return getTooltipGTNHEnergy(0);
        }
        return "[" + getTooltipGTNHEnergy(0) + ", " + getTooltipGTNHEnergy(1) + ")";
    }

    private double convertToTick(double input) {
        return input / 20;
    }

    protected String buildTooltipEnergy(int neighbors) {
        if (!moxStyle) {
            return formatNumber(convertToTick(getEnergy(neighbors, 0)));
        }
        return "[" + formatNumber(convertToTick(getEnergy(neighbors, 0))) +
                "," +
                formatNumber(convertToTick(getEnergy(neighbors, 1))) +
                ")";
    }

    protected String buildTooltip(IntFunction<String> function) {
        return IntStream.rangeClosed(0, 4).mapToObj(function).collect(Collectors.joining("/"));
    }

    @Override
    public String[] formatTooltip() {
        final String energy;
        if (GTNHbehavior || "GTNH".equals(sourceMod)) {
            energy = buildTooltipGTNHEnergy();
        } else {
            energy = buildTooltip(this::buildTooltipEnergy);
        }
        if (!moxStyle) {
            return new String[]{
                    formatNumber(getMaxDamage()),
                    energy,
                    buildTooltip(i -> getTooltipHeat(i, 1))
            };
        }
        return new String[]{
                formatNumber(getMaxDamage()),
                energy,
                buildTooltip(i -> getTooltipHeat(i, 1)),
                buildTooltip(i -> getTooltipHeat(i, 2))
        };
    }
}
