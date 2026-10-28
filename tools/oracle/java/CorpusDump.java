import Ic2ExpReactorPlanner.corpus.Corpus;
import Ic2ExpReactorPlanner.corpus.CorpusRunner;

/**
 * Oracle driver: runs the whole corpus through the real engine and prints the baseline lines
 * exactly as BaselineStore would write them. Used to confirm the committed baseline is what the
 * current sources produce, before any of it is ported.
 */
public class CorpusDump {
    public static void main(String[] argv) {
        java.util.List<Corpus.Design> designs = Corpus.all();
        for (Corpus.Design design : designs) {
            try {
                CorpusRunner.Result result = CorpusRunner.run(design);
                System.out.println(result.toLine());
            } catch (Exception e) {
                System.out.println(design.id + "|ERROR|" + e);
            }
        }
    }
}
