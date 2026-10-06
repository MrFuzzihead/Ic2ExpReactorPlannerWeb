/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */
package Ic2ExpReactorPlanner;

import static Ic2ExpReactorPlanner.BundleHelper.formatI18n;
import static Ic2ExpReactorPlanner.BundleHelper.getI18n;

import Ic2ExpReactorPlanner.components.ReactorItem;

/**
 * Represents an IndustrialCraft2 Nuclear Reactor.
 * @author Brian McCloud
 */
public class Reactor {

    private final ReactorItem[][] grid = new ReactorItem[6][9];

    private double currentEUoutput = 0.0;

    private double currentHeat = 0.0;

    private double maxHeat = 10000.0;

    private double ventedHeat = 0.0;

    private boolean fluid = false;

    private boolean pulsed = false;

    private boolean automated = false;

    private boolean usingReactorCoolantInjectors = false;

    private static final int DEFAULT_ON_PULSE = (int) 5e6;

    private int onPulse = DEFAULT_ON_PULSE;

    private static final int DEFAULT_OFF_PULSE = 0;

    private int offPulse = DEFAULT_OFF_PULSE;

    private static final int DEFAULT_SUSPEND_TEMP = (int) 120e3;

    private int suspendTemp = DEFAULT_SUSPEND_TEMP;

    private static final int DEFAULT_RESUME_TEMP = (int) 120e3;

    private int resumeTemp = DEFAULT_RESUME_TEMP;

    // The largest value the suspend/resume code fields can carry. Derived rather than copied: the
    // store/extract bound has to be able to hold either field's own default, so once the two
    // defaults diverge the bound follows the larger of them. Declared after both defaults because
    // a field initializer reads them in declaration order.
    private static final int CODE_TEMP_BOUND = Math.max(DEFAULT_SUSPEND_TEMP, DEFAULT_RESUME_TEMP);

    // The largest value the current-heat code field can carry. It shares the number above by
    // coincidence, not by design: this bounds a stored heat, not a default temperature, and it is
    // unrelated to MAX_COMPONENT_HEAT.
    private static final int CODE_HEAT_BOUND = (int) 120e3;

    private int maxSimulationTicks = (int) 5e6;

    // maximum paramatter types for a reactor component (current initial heat, automation threshold, reactor pause
    private static final int MAX_PARAM_TYPES = 3;

    public static final int MAX_COMPONENT_HEAT = 1_080_000;

    public ReactorItem getComponentAt(final int row, final int column) {
        if (row >= 0 && row < grid.length && column >= 0 && column < grid[row].length) {
            return grid[row][column];
        }
        return null;
    }

    public void setComponentAt(final int row, final int column, final ReactorItem component) {
        if (row >= 0 && row < grid.length && column >= 0 && column < grid[row].length) {
            if (grid[row][column] != null) {
                grid[row][column].removeFromReactor();
            }
            grid[row][column] = component;
            if (component != null) {
                component.addToReactor(this, row, column);
            }
        }
    }

    public void clearGrid() {
        for (int row = 0; row < grid.length; row++) {
            for (int col = 0; col < grid[row].length; col++) {
                setComponentAt(row, col, null);
            }
        }
    }

    /**
     * @return the amount of EU output in the reactor tick just simulated.
     */
    public double getCurrentEUoutput() {
        return currentEUoutput;
    }

    /**
     * @return the current heat level of the reactor.
     */
    public double getCurrentHeat() {
        return currentHeat;
    }

    /**
     * @return the maximum heat of the reactor.
     */
    public double getMaxHeat() {
        return maxHeat;
    }

    /**
     * Adjust the maximum heat
     * @param adjustment the adjustment amount (negative values decrease the max heat).
     */
    public void adjustMaxHeat(final double adjustment) {
        maxHeat += adjustment;
    }

    /**
     * Set the current heat of the reactor.  Mainly to be used for simulating a pre-heated reactor, or for resetting to 0 for a new simulation.
     * @param currentHeat the heat to set
     */
    public void setCurrentHeat(final double currentHeat) {
        this.currentHeat = currentHeat;
    }

    /**
     * Adjusts the reactor's current heat by a specified amount
     * @param adjustment the adjustment amount.
     */
    public void adjustCurrentHeat(final double adjustment) {
        currentHeat += adjustment;
        if (currentHeat < 0.0) {
            currentHeat = 0.0;
        }
    }

    /**
     * add some EU output.
     * @param amount the amount of EU to output over 1 reactor tick (20 game ticks).
     */
    public void addEUOutput(final double amount) {
        currentEUoutput += amount;
    }

    /**
     * clears the EU output (presumably to start simulating a new reactor tick).
     */
    public void clearEUOutput() {
        currentEUoutput = 0.0;
    }

    /**
     * Gets a list of the materials needed to build the components.
     * @return a list of the materials needed to build the components.
     */
    public MaterialsList getMaterials() {
        MaterialsList result = new MaterialsList();
        for (int col = 0; col < grid[0].length; col++) {
            for (int row = 0; row < grid.length; row++) {
                ReactorItem component = getComponentAt(row, col);
                if (component != null) {
                    // getMaterialsForComponent returns null for a baseName with no recipe entry.
                    // MaterialsList.add rejects a null element outright, which is the right error
                    // for a genuine misuse but the wrong one here: a component the planner has no
                    // recipe for simply contributes nothing to the shopping list. All 72 factory
                    // components have entries today, so this is a trap guard, not a live path.
                    // See CODE_REVIEW.md P3-9.
                    MaterialsList recipe = MaterialsList.getMaterialsForComponent(component);
                    if (recipe != null) {
                        result.add(recipe);
                    }
                }
            }
        }
        return result;
    }

    public MaterialsList getComponentList() {
        MaterialsList result = new MaterialsList();
        for (int col = 0; col < grid[0].length; col++) {
            for (int row = 0; row < grid.length; row++) {
                if (getComponentAt(row, col) != null) {
                    result.add(getComponentAt(row, col).name);
                }
            }
        }
        return result;
    }

    /**
     * @return the amount of heat vented this reactor tick.
     */
    public double getVentedHeat() {
        return ventedHeat;
    }

    /**
     * Adds to the amount of heat vented this reactor tick, in case it is a new-style reactor with a pressure vessel and outputting heat to fluid instead of EU.
     * @param amount the amount to add.
     */
    public void ventHeat(final double amount) {
        ventedHeat += amount;
    }

    /**
     * Clears the amount of vented heat, in case a new reactor tick is starting.
     */
    public void clearVentedHeat() {
        ventedHeat = 0;
    }

    /**
     * Get a code that represents the component set, which can be passed between forum users, etc.
     * @return a code representing some ids for the components and arrangement.  Passing the same code to setCode() should re-create an identical reactor setup, even if other changes have happened in the meantime.
     */
    public String getCode() {
        return "erp=" + buildCodeString();
    }

    /**
     * Sets a code to configure the entire grid all at once.  Expects the code to have originally been output by getCode().
     *
     * <p><b>Strict parsing (CODE_REVIEW.md P1-1).</b> A code is either understood completely or
     * refused completely: every reader below parses into locals and only then applies, and any
     * input that trips a bounds or number-format problem is turned into a warning with the
     * reactor left exactly as it was. Previously a malformed code could escape as an unchecked
     * exception, or -- worse -- be applied halfway and then fail, leaving a design that was
     * never in the code the user pasted.
     *
     * @param code the code of the reactor setup to use.
     */
    public void setCode(final String code) {
        if (code == null || code.isEmpty()) {
            return;
        }
        try {
            if (code.startsWith("erp=")) {
                readCodeString(code.substring(4));
            } else if (code.length() >= 108 && code.matches("[0-9A-Za-z(),|]+")) { // NOI18N
                readLegacyCode(code);
            } else {
                String tempCode = code;
                if (code.startsWith("http://www.talonfiremage.pwp.blueyonder.co.uk/v3/reactorplanner.html?")) { // NOI18N
                    tempCode = code.replace(
                            "http://www.talonfiremage.pwp.blueyonder.co.uk/v3/reactorplanner.html?", ""); // NOI18N
                }
                if (tempCode.matches("[0-9a-z]+")) { // NOI18N
                    // Possibly a code from Talonius's old planner
                    handleTaloniusCode(tempCode);
                } else if (code.matches("[0-9A-Za-z+/=]+")) { // NOI18N
                    // Try to handle it as a newer code with the "erp=" prefix stripped
                    readCodeString(code);
                } else {
                    WarningDisplay.warn(
                            getI18n("Warning.Title"), String.format(getI18n("Warning.InvalidReactorCode"), code));
                }
            }
        } catch (IllegalArgumentException | IndexOutOfBoundsException e) {
            // Every one of these means "this is not a code we can read", and none of them can be
            // raised after this point: the readers apply only once parsing has fully succeeded.
            // NumberFormatException extends IllegalArgumentException, and both
            // ArrayIndexOutOfBoundsException and StringIndexOutOfBoundsException extend
            // IndexOutOfBoundsException, so this covers bad base-36 digits, bad hex digits, a
            // Base64 payload that will not decode, too many per-component parameters, and a
            // truncated suffix -- without swallowing NullPointerException and friends, which
            // would be real bugs rather than bad input.
            //
            // The exception's own message is appended when it has one. The deliberate refusals
            // (too many parameters, an unsupported revision, an unencodable value) say what was
            // wrong, which is the difference between a user fixing their paste and giving up. A
            // raw bounds exception's message is less friendly but still better than nothing.
            String message = String.format(getI18n("Warning.InvalidReactorCode"), code);
            if (e.getMessage() != null && !e.getMessage().isEmpty()) {
                message = message + "\n" + e.getMessage();
            }
            WarningDisplay.warn(getI18n("Warning.Title"), message);
        }
    }

    /**
     * Rejects a value the current code writer could not encode. {@code BigintStorage.store} throws
     * for anything outside {@code [0, max]}, so accepting one here would make the reactor hold a
     * state from which {@link #getCode()} throws.
     */
    private static void requireEncodable(final String what, final int value, final int max) {
        if (value < 0 || value > max) {
            throw new IllegalArgumentException(what + " of " + value + " is outside the encodable range of " + max);
        }
    }

    /**
     * Reads the pre-2.3.1 "old style" code: 108 hex digits of component ids with optional
     * parenthesised per-component parameters, then a {@code |}-separated suffix of mode flags.
     *
     * <p>Parsed entirely into locals before anything is applied, so a truncated or over-long
     * suffix cannot leave the grid loaded with half the mode flags set.
     */
    private void readLegacyCode(final String code) {
        int pos = 0;
        int[][] ids = new int[grid.length][grid[0].length];
        char[][][] paramTypes = new char[grid.length][grid[0].length][MAX_PARAM_TYPES];
        int[][][] params = new int[grid.length][grid[0].length][MAX_PARAM_TYPES];
        for (int row = 0; row < grid.length; row++) {
            for (int col = 0; col < grid[row].length; col++) {
                ids[row][col] = Integer.parseInt(code.substring(pos, pos + 2), 16);
                pos += 2;
                int paramNum = 0;
                if (pos + 1 < code.length() && code.charAt(pos) == '(') {
                    paramTypes[row][col][paramNum] = code.charAt(pos + 1);
                    int tempPos = pos + 2;
                    StringBuilder param = new StringBuilder(10);
                    while (tempPos < code.length() && code.charAt(tempPos) != ')') {
                        if (code.charAt(tempPos) == ',') {
                            params[row][col][paramNum] = Integer.parseInt(param.toString(), 36);
                            paramNum++;
                            if (paramNum >= MAX_PARAM_TYPES) {
                                // A fourth parameter would index past the end of the arrays. Refuse
                                // the code rather than quietly dropping the extra settings.
                                throw new IllegalArgumentException(
                                        "too many parameters for the cell at row " + row + " column " + col);
                            }
                            if (tempPos + 1 < code.length()) {
                                tempPos++;
                                paramTypes[row][col][paramNum] = code.charAt(tempPos);
                            }
                            param.setLength(0);
                        } else {
                            param.append(code.charAt(tempPos));
                        }
                        tempPos++;
                    }
                    params[row][col][paramNum] = Integer.parseInt(param.toString(), 36);
                    pos = tempPos + 1;
                }
            }
        }

        // The suffix is parsed into locals too, and it can no longer throw after the grid is
        // applied, because the grid is not applied until further down.
        boolean newFluid = fluid;
        boolean newPulsed = pulsed;
        boolean newAutomated = automated;
        boolean newInjectors = usingReactorCoolantInjectors;
        int newCurrentHeat = 0;
        boolean haveCurrentHeat = false;
        int newOnPulse = onPulse;
        int newOffPulse = offPulse;
        int newSuspendTemp = suspendTemp;
        int newResumeTemp = resumeTemp;

        String[] parts = code.split("\\|");
        if (parts.length > 1) {
            String extraCode = parts[1];
            switch (extraCode.charAt(0)) {
                case 'f':
                    newFluid = true;
                    break;
                case 'e':
                    newFluid = false;
                    break;
                default:
                    break;
            }
            switch (extraCode.charAt(1)) {
                case 's':
                    newPulsed = false;
                    newAutomated = false;
                    break;
                case 'p':
                    newPulsed = true;
                    newAutomated = false;
                    break;
                case 'a':
                    newPulsed = true;
                    newAutomated = true;
                    break;
                default:
                    break;
            }
            switch (extraCode.charAt(2)) {
                case 'i':
                    newInjectors = true;
                    break;
                case 'n':
                    newInjectors = false;
                    break;
                default:
                    break;
            }
            if (extraCode.length() > 3) {
                newCurrentHeat = Integer.parseInt(extraCode.substring(3), 36);
                haveCurrentHeat = true;
            }
        }
        for (int i = 2; i < parts.length; i++) {
            switch (parts[i].charAt(0)) {
                case 'n':
                    newOnPulse = Integer.parseInt(parts[i].substring(1), 36);
                    break;
                case 'f':
                    newOffPulse = Integer.parseInt(parts[i].substring(1), 36);
                    break;
                case 's':
                    newSuspendTemp = Integer.parseInt(parts[i].substring(1), 36);
                    break;
                case 'r':
                    newResumeTemp = Integer.parseInt(parts[i].substring(1), 36);
                    break;
                default:
                    break;
            }
        }

        // The legacy format can express values the current code writer cannot encode, because
        // each field is stored in base 36 with no bound. Accepting one would leave the reactor
        // holding a value that makes the *next* getCode() throw from BigintStorage.store, so a
        // code we could not faithfully re-encode is refused here instead.
        if (haveCurrentHeat) {
            requireEncodable("current heat", newCurrentHeat, CODE_HEAT_BOUND);
        }
        requireEncodable("on-pulse", newOnPulse, (int) 5e6);
        requireEncodable("off-pulse", newOffPulse, (int) 5e6);
        requireEncodable("suspend temperature", newSuspendTemp, CODE_TEMP_BOUND);
        requireEncodable("resume temperature", newResumeTemp, CODE_TEMP_BOUND);
        if (newOnPulse + newOffPulse > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("the pulse durations overflow");
        }

        // Parsing is complete and nothing above has touched the reactor, so from here on nothing
        // can fail and the application is all-or-nothing.
        for (int row = 0; row < grid.length; row++) {
            for (int col = 0; col < grid[row].length; col++) {
                final ReactorItem component = ComponentFactory.createComponent(ids[row][col]);
                for (int paramNum = 0; paramNum < MAX_PARAM_TYPES; paramNum++) {
                    switch (paramTypes[row][col][paramNum]) {
                        case 'h':
                            component.setInitialHeat(params[row][col][paramNum]);
                            break;
                        case 'a':
                            component.setAutomationThreshold(params[row][col][paramNum]);
                            break;
                        case 'p':
                            component.setReactorPause(params[row][col][paramNum]);
                            break;
                        default:
                            break;
                    }
                }
                setComponentAt(row, col, component);
            }
        }
        fluid = newFluid;
        pulsed = newPulsed;
        automated = newAutomated;
        usingReactorCoolantInjectors = newInjectors;
        if (haveCurrentHeat) {
            currentHeat = newCurrentHeat;
        }
        onPulse = newOnPulse;
        offPulse = newOffPulse;
        suspendTemp = newSuspendTemp;
        resumeTemp = newResumeTemp;
    }

    private void handleTaloniusCode(String tempCode) {
        StringBuilder warnings = new StringBuilder(500);
        // Buffered rather than applied, so a code this planner cannot fully read leaves the
        // existing design intact (CODE_REVIEW.md P1-1).
        ReactorItem[][] parsed = new ReactorItem[grid.length][grid[0].length];
        int newCurrentHeat;
        TaloniusDecoder decoder = new TaloniusDecoder(tempCode);
        // initial heat, in multiples of 100
        newCurrentHeat = 100 * decoder.readInt(10);
        // reactor grid
        for (int x = 8; x >= 0; x--) {
            for (int y = 5; y >= 0; y--) {
                int nextValue = decoder.readInt(7);

                // items are no longer stackable in IC2 reactors, but stack sizes from the planner code still need to be
                // handled
                if (nextValue > 64) {
                    nextValue = decoder.readInt(7);
                }

                switch (nextValue) {
                    case 0:
                        parsed[y][x] = null;
                        break;
                    case 1:
                        parsed[y][x] = ComponentFactory.createComponent("fuelRodUranium");
                        break;
                    case 2:
                        parsed[y][x] = ComponentFactory.createComponent("dualFuelRodUranium");
                        break;
                    case 3:
                        parsed[y][x] = ComponentFactory.createComponent("quadFuelRodUranium");
                        break;
                    case 4:
                        warnings.append(formatI18n("Warning.DepletedIsotope", y, x));
                        break;
                    case 5:
                        parsed[y][x] = ComponentFactory.createComponent("neutronReflector");
                        break;
                    case 6:
                        parsed[y][x] = ComponentFactory.createComponent("thickNeutronReflector");
                        break;
                    case 7:
                        parsed[y][x] = ComponentFactory.createComponent("heatVent");
                        break;
                    case 8:
                        parsed[y][x] = ComponentFactory.createComponent("reactorHeatVent");
                        break;
                    case 9:
                        parsed[y][x] = ComponentFactory.createComponent("overclockedHeatVent");
                        break;
                    case 10:
                        parsed[y][x] = ComponentFactory.createComponent("advancedHeatVent");
                        break;
                    case 11:
                        parsed[y][x] = ComponentFactory.createComponent("componentHeatVent");
                        break;
                    case 12:
                        parsed[y][x] = ComponentFactory.createComponent("rshCondensator");
                        break;
                    case 13:
                        parsed[y][x] = ComponentFactory.createComponent("lzhCondensator");
                        break;
                    case 14:
                        parsed[y][x] = ComponentFactory.createComponent("heatExchanger");
                        break;
                    case 15:
                        parsed[y][x] = ComponentFactory.createComponent("coreHeatExchanger");
                        break;
                    case 16:
                        parsed[y][x] = ComponentFactory.createComponent("componentHeatExchanger");
                        break;
                    case 17:
                        parsed[y][x] = ComponentFactory.createComponent("advancedHeatExchanger");
                        break;
                    case 18:
                        parsed[y][x] = ComponentFactory.createComponent("reactorPlating");
                        break;
                    case 19:
                        parsed[y][x] = ComponentFactory.createComponent("heatCapacityReactorPlating");
                        break;
                    case 20:
                        parsed[y][x] = ComponentFactory.createComponent("containmentReactorPlating");
                        break;
                    case 21:
                        parsed[y][x] = ComponentFactory.createComponent("coolantCell10k");
                        break;
                    case 22:
                        parsed[y][x] = ComponentFactory.createComponent("coolantCell30k");
                        break;
                    case 23:
                        parsed[y][x] = ComponentFactory.createComponent("coolantCell60k");
                        break;
                    case 24:
                        warnings.append(formatI18n("Warning.Heating", y, x));
                        break;
                    case 32:
                        parsed[y][x] = ComponentFactory.createComponent("fuelRodThorium");
                        break;
                    case 33:
                        parsed[y][x] = ComponentFactory.createComponent("dualFuelRodThorium");
                        break;
                    case 34:
                        parsed[y][x] = ComponentFactory.createComponent("quadFuelRodThorium");
                        break;
                    case 35:
                        warnings.append(formatI18n("Warning.Plutonium", y, x));
                        break;
                    case 36:
                        warnings.append(formatI18n("Warning.DualPlutonium", y, x));
                        break;
                    case 37:
                        warnings.append(formatI18n("Warning.QuadPlutonium", y, x));
                        break;
                    case 38:
                        parsed[y][x] = ComponentFactory.createComponent("iridiumNeutronReflector");
                        break;
                    case 39:
                        parsed[y][x] = ComponentFactory.createComponent("coolantCellHelium60k");
                        break;
                    case 40:
                        parsed[y][x] = ComponentFactory.createComponent("coolantCellHelium180k");
                        break;
                    case 41:
                        parsed[y][x] = ComponentFactory.createComponent("coolantCellHelium360k");
                        break;
                    case 42:
                        parsed[y][x] = ComponentFactory.createComponent("coolantCellNak60k");
                        break;
                    case 43:
                        parsed[y][x] = ComponentFactory.createComponent("coolantCellNak180k");
                        break;
                    case 44:
                        parsed[y][x] = ComponentFactory.createComponent("coolantCellNak360k");
                        break;
                    default:
                        warnings.append(formatI18n("Warning.Unrecognized", nextValue, y, x));
                        break;
                }
            }
        }
        // The whole grid is known now, so apply it in one go.
        for (int row = 0; row < grid.length; row++) {
            for (int col = 0; col < grid[row].length; col++) {
                setComponentAt(row, col, parsed[row][col]);
            }
        }
        currentHeat = newCurrentHeat;
        if (warnings.length() > 0) {
            warnings.setLength(warnings.length() - 1); // to remove last newline character
            WarningDisplay.warn(getI18n("Warning.Title"), warnings.toString());
        }
    }

    /**
     * Reads a Base64 code string for the reactor, after stripping the prefix.
     *
     * <p>Parsed entirely into locals before anything is applied, so an unreadable code leaves the
     * reactor untouched (CODE_REVIEW.md P1-1).
     */
    private void readCodeString(final String code) {
        BigintStorage storage = BigintStorage.inputBase64(code);
        // read the code revision from the code itself instead of making it part of the prefix.
        int codeRevision = storage.extract(255);
        // Check if the code revision is supported yet. Refuse rather than guess: the field
        // widths below change between revisions, so a revision we do not know is a code whose
        // layout we cannot read.
        if (codeRevision > 4) {
            throw new IllegalArgumentException("Unsupported code revision " + codeRevision + " in reactor code.");
        }
        int maxComponentHeat;
        if (codeRevision == 4) maxComponentHeat = (int) 1e9;
        else if (codeRevision == 3) maxComponentHeat = (int) 1080e3;
        else maxComponentHeat = (int) 360e3;

        boolean newPulsed = pulsed;
        boolean newAutomated = automated;
        // for code revision 1 or newer, read whether the reactor is pulsed and/or automated next.
        if (codeRevision >= 1) {
            newPulsed = storage.extract(1) > 0;
            newAutomated = storage.extract(1) > 0;
        }

        ReactorItem[][] parsed = new ReactorItem[grid.length][grid[0].length];
        for (int row = 0; row < grid.length; row++) {
            for (int col = 0; col < grid[row].length; col++) {
                int componentId;
                // Changes may be coming to the number of components available, so make sure to
                // check the code revision number.
                if (codeRevision <= 1) {
                    componentId = storage.extract(38);
                } else if (codeRevision == 2) {
                    componentId = storage.extract(44);
                } else if (codeRevision == 3) {
                    componentId = storage.extract(58);
                } else {
                    componentId = storage.extract(72);
                }
                if (componentId == 0) {
                    parsed[row][col] = null;
                    continue;
                }
                ReactorItem component = ComponentFactory.createComponent(componentId);
                // The automation fields are consumed from the stream whether or not this build can
                // instantiate the component, so the reader stays in step with the writer even for
                // a payload naming an id that has since been dropped. Defence in depth: every
                // revision's id field is narrower than the component registry, so a code produced
                // by buildCodeString can never actually reach the null case.
                if (storage.extract(1) > 0) {
                    int initialHeat = storage.extract(maxComponentHeat);
                    int threshold = 0;
                    int pause = 0;
                    if (codeRevision == 0 || newAutomated) {
                        threshold = storage.extract(maxComponentHeat);
                        pause = storage.extract((int) 10e3);
                    }
                    if (component != null) {
                        component.setInitialHeat(initialHeat);
                        if (codeRevision == 0 || newAutomated) {
                            component.setAutomationThreshold(threshold);
                            component.setReactorPause(pause);
                        }
                    }
                }
                parsed[row][col] = component;
            }
        }

        // next, read the initial temperature and other details.
        int newCurrentHeat = storage.extract(CODE_HEAT_BOUND);
        int newOnPulse = onPulse;
        int newOffPulse = offPulse;
        int newSuspendTemp = suspendTemp;
        int newResumeTemp = resumeTemp;
        if (codeRevision == 0 || newPulsed) {
            newOnPulse = storage.extract((int) 5e6);
            newOffPulse = storage.extract((int) 5e6);
            newSuspendTemp = storage.extract(CODE_TEMP_BOUND);
            newResumeTemp = storage.extract(CODE_TEMP_BOUND);
        }
        boolean newFluid = storage.extract(1) > 0;
        boolean newInjectors = storage.extract(1) > 0;
        if (codeRevision == 0) {
            newPulsed = storage.extract(1) > 0;
            newAutomated = storage.extract(1) > 0;
        }
        int newMaxSimulationTicks = storage.extract((int) 5e6);

        // Parsing is complete and nothing above has touched the reactor, so from here on nothing
        // can fail and the application is all-or-nothing.
        for (int row = 0; row < grid.length; row++) {
            for (int col = 0; col < grid[row].length; col++) {
                setComponentAt(row, col, parsed[row][col]);
            }
        }
        pulsed = newPulsed;
        automated = newAutomated;
        currentHeat = newCurrentHeat;
        onPulse = newOnPulse;
        offPulse = newOffPulse;
        suspendTemp = newSuspendTemp;
        resumeTemp = newResumeTemp;
        fluid = newFluid;
        usingReactorCoolantInjectors = newInjectors;
        maxSimulationTicks = newMaxSimulationTicks;
    }

    // builds a Base64 code string, not including the prefix.
    private String buildCodeString() {
        BigintStorage storage = new BigintStorage();
        // first, store the extra details, in reverse order of expected reading.
        storage.store(maxSimulationTicks, (int) 5e6);
        storage.store(usingReactorCoolantInjectors ? 1 : 0, 1);
        storage.store(fluid ? 1 : 0, 1);
        if (pulsed) {
            storage.store(resumeTemp, CODE_TEMP_BOUND);
            storage.store(suspendTemp, CODE_TEMP_BOUND);
            storage.store(offPulse, (int) 5e6);
            storage.store(onPulse, (int) 5e6);
        }
        storage.store((int) currentHeat, CODE_HEAT_BOUND);
        // grid is read (almost) first, so written (almost) last, and in reverse order
        for (int row = grid.length - 1; row >= 0; row--) {
            for (int col = grid[row].length - 1; col >= 0; col--) {
                ReactorItem component = grid[row][col];
                if (component != null) {
                    int id = component.id;
                    // only store automation details for a component if non-default, and add a flag bit to indicate
                    // their presence.  null components don't even need the flag bit.
                    if (component.getInitialHeat() > 0
                            || component.getAutomationThreshold()
                                    != ComponentFactory.getDefaultComponent(id).getAutomationThreshold()
                            || component.getReactorPause()
                                    != ComponentFactory.getDefaultComponent(id).getReactorPause()) {
                        if (automated) {
                            storage.store(component.getReactorPause(), (int) 10e3);
                            storage.store(component.getAutomationThreshold(), (int) 1e9);
                        }
                        storage.store((int) component.getInitialHeat(), (int) 1e9);
                        storage.store(1, 1);
                    } else {
                        storage.store(0, 1);
                    }
                    storage.store(id, 72);
                } else {
                    storage.store(0, 72);
                }
            }
        }
        storage.store(automated ? 1 : 0, 1);
        storage.store(pulsed ? 1 : 0, 1);
        // store the code revision, allowing values up to 255 (8 bits) before adjusting how it is stored in the code.
        storage.store(4, 255);
        return storage.outputBase64();
    }

    // Get an old-style (pre-2.3.1) code for the reactor, for pasting into older versions of the planner.
    public String getOldCode() {
        StringBuilder result = new StringBuilder(108);
        for (int row = 0; row < grid.length; row++) {
            for (int col = 0; col < grid[row].length; col++) {
                final ReactorItem component = getComponentAt(row, col);
                final int id = (component != null) ? component.id : 0;
                result.append(String.format("%02X", id)); // NOI18N
                if (component != null
                        && (component.getInitialHeat() > 0
                                || (automated
                                        && component.getAutomationThreshold()
                                                != ComponentFactory.getDefaultComponent(id)
                                                        .getAutomationThreshold())
                                || (automated
                                        && component.getReactorPause()
                                                != ComponentFactory.getDefaultComponent(id)
                                                        .getReactorPause()))) {
                    result.append("(");
                    if (component.getInitialHeat() > 0) {
                        result.append(String.format(
                                "h%s,", Integer.toString((int) component.getInitialHeat(), 36))); // NOI18N
                    }
                    if (automated
                            && component.getAutomationThreshold()
                                    != ComponentFactory.getDefaultComponent(id).getAutomationThreshold()) {
                        result.append(String.format(
                                "a%s,", Integer.toString(component.getAutomationThreshold(), 36))); // NOI18N
                    }
                    if (automated
                            && component.getReactorPause()
                                    != ComponentFactory.getDefaultComponent(id).getReactorPause()) {
                        result.append(
                                String.format("p%s,", Integer.toString(component.getReactorPause(), 36))); // NOI18N
                    }
                    result.setLength(result.length() - 1); // remove the last comma, whichever parameter it came from.
                    result.append(")");
                }
            }
        }
        result.append('|');
        if (fluid) {
            result.append('f');
        } else {
            result.append('e');
        }
        if (automated) {
            result.append('a');
        } else if (pulsed) {
            result.append('p');
        } else {
            result.append('s');
        }
        if (usingReactorCoolantInjectors) {
            result.append('i');
        } else {
            result.append('n');
        }
        if (currentHeat > 0) {
            result.append(Integer.toString((int) currentHeat, 36));
        }
        if (pulsed && onPulse != DEFAULT_ON_PULSE) {
            result.append(String.format("|n%s", Integer.toString(onPulse, 36)));
        }
        if (pulsed && offPulse != DEFAULT_OFF_PULSE) {
            result.append(String.format("|f%s", Integer.toString(offPulse, 36)));
        }
        if (pulsed && suspendTemp != DEFAULT_SUSPEND_TEMP) {
            result.append(String.format("|s%s", Integer.toString(suspendTemp, 36)));
        }
        if (pulsed && resumeTemp != DEFAULT_RESUME_TEMP) {
            result.append(String.format("|r%s", Integer.toString(resumeTemp, 36)));
        }
        return result.toString();
    }

    /**
     * Checks whether the reactor is to simulate a fluid-style reactor, rather than a direct EU-output reactor.
     * @return true if this was set to be a fluid-style reactor, false if this was set to be direct EU-output reactor.
     */
    public boolean isFluid() {
        return fluid;
    }

    /**
     * Sets whether the reactor is to simulate a fluid-style reactor, rather than a direct EU-output reactor.
     * @param fluid true if this is to be a fluid-style reactor, false if this is to be direct EU-output reactor.
     */
    public void setFluid(final boolean fluid) {
        this.fluid = fluid;
    }

    /**
     * Checks whether the reactor is using Reactor Coolant Injectors (RCIs)
     * @return true if this reactor was set to use RCIs, false otherwise.
     */
    public boolean isUsingReactorCoolantInjectors() {
        return usingReactorCoolantInjectors;
    }

    /**
     * Sets whether the reactor is to use Reactor Coolant Injectors (RCIs)
     * @param usingReactorCoolantInjectors true if this reactor should use RCIs, false otherwise.
     */
    public void setUsingReactorCoolantInjectors(final boolean usingReactorCoolantInjectors) {
        this.usingReactorCoolantInjectors = usingReactorCoolantInjectors;
    }

    public int getOnPulse() {
        return onPulse;
    }

    public void setOnPulse(final int onPulse) {
        this.onPulse = onPulse;
    }

    public int getOffPulse() {
        return offPulse;
    }

    public void setOffPulse(final int offPulse) {
        this.offPulse = offPulse;
    }

    public int getSuspendTemp() {
        return suspendTemp;
    }

    public void setSuspendTemp(final int suspendTemp) {
        this.suspendTemp = suspendTemp;
    }

    public int getResumeTemp() {
        return resumeTemp;
    }

    public void setResumeTemp(final int resumeTemp) {
        this.resumeTemp = resumeTemp;
    }

    public boolean isPulsed() {
        return pulsed;
    }

    public void setPulsed(boolean pulsed) {
        this.pulsed = pulsed;
    }

    public boolean isAutomated() {
        return automated;
    }

    public void setAutomated(boolean automated) {
        this.automated = automated;
    }

    public int getMaxSimulationTicks() {
        return maxSimulationTicks;
    }

    public void setMaxSimulationTicks(int maxSimulationTicks) {
        this.maxSimulationTicks = maxSimulationTicks;
    }

    public void resetPulseConfig() {
        onPulse = DEFAULT_ON_PULSE;
        offPulse = DEFAULT_OFF_PULSE;
        suspendTemp = DEFAULT_SUSPEND_TEMP;
        resumeTemp = DEFAULT_RESUME_TEMP;
    }
}
