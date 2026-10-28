import Ic2ExpReactorPlanner.corpus.Corpus;

/**
 * Oracle driver: prints the corpus DESIGN LIST only -- id, tags, GT modes, tick cap, and the
 * design's own reactor code -- without running a simulation.
 *
 * The committed baseline carries no codes, so the JS port of `Corpus.java` has nothing to check
 * its 200 seeded designs against. This is that missing half: the seed, the `java.util.Random`
 * stream, the `LinkedHashSet` tag order, and the per-component parameter writes all have to
 * reproduce here, and a design that is wrong by one cell would otherwise only show up as a
 * wrong SHA three layers down.
 */
public class CorpusCodes {
    public static void main(String[] argv) {
        java.util.List<Corpus.Design> designs = Corpus.all();
        System.out.println("count=" + designs.size());
        for (Corpus.Design design : designs) {
            System.out.println(design.id + "\t" + design.tags + "\t"
                    + (design.gt509 ? 1 : 0) + (design.gtnh ? 1 : 0) + "\t"
                    + design.tickCap + "\t" + design.reactor.getCode());
        }
    }
}
