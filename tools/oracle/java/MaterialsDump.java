import Ic2ExpReactorPlanner.ComponentFactory;
import Ic2ExpReactorPlanner.MaterialsList;
import Ic2ExpReactorPlanner.corpus.Corpus;
import Ic2ExpReactorPlanner.components.ReactorItem;

/**
 * Oracle dump of the shopping-list feature: the component -> materials recipe table under every
 * switch setting, and the aggregated list a whole board produces.
 *
 * Two sections, one line each, tab-separated:
 *
 *   R  gt  ufc  alloy  id  baseName  toString()          one per component per switch combo
 *   B  gt   designId                                     toString() of Reactor.getMaterials()
 *
 * `toString()` is the exact text the desktop's `materialsArea` shows, so the dump is the panel's
 * oracle rather than an internal representation: the `#,##0.##` pattern, the fractional counts
 * (1/3 of a tin per coolant cell), and the `TreeMap` key order all have to reproduce in JS.
 * Newlines inside a list are escaped so one list stays on one line.
 *
 * Setter order mirrors `ReactorPlannerFrame.java:2408-2411`: the two booleans first, then the GT
 * version, because `setGTVersion` re-derives the coolant cell and the circuits from the flags that
 * are already set.
 */
public class MaterialsDump {

    private static String oneLine(String s) {
        return s.replace("\n", "\\n");
    }

    public static void main(String[] argv) {
        String[] gts = {"none", "5.08", "5.09", "GTNH"};
        int count = ComponentFactory.getComponentCount();

        for (String gt : gts) {
            for (int ufc = 0; ufc < 2; ufc++) {
                for (int alloy = 0; alloy < 2; alloy++) {
                    MaterialsList.setUseUfcForCoolantCells(ufc == 1);
                    MaterialsList.setExpandAdvancedAlloy(alloy == 1);
                    MaterialsList.setGTVersion(gt);
                    for (int id = 1; id < count; id++) {
                        ReactorItem item = ComponentFactory.createComponent(id);
                        MaterialsList recipe = MaterialsList.getMaterialsForComponent(item);
                        System.out.println("R\t" + gt + "\t" + ufc + "\t" + alloy + "\t" + id + "\t"
                                + item.baseName + "\t"
                                + (recipe == null ? "NULL" : oneLine(recipe.toString())));
                    }
                }
            }
        }

        for (String gt : gts) {
            MaterialsList.setUseUfcForCoolantCells(false);
            MaterialsList.setExpandAdvancedAlloy(false);
            MaterialsList.setGTVersion(gt);
            for (Corpus.Design design : Corpus.all()) {
                System.out.println("B\t" + gt + "\t" + design.id + "\t"
                        + oneLine(design.reactor.getMaterials().toString()));
            }
        }
    }
}
