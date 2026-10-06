package Ic2ExpReactorPlanner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.awt.Image;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * {@link TextureFactory}: resolving a component's icon from the texture pack zip or from the
 * jar's own resources.
 *
 * <p>This is P3-8 from {@code CODE_REVIEW.md}. {@code getImage} takes a component's primary name
 * and its fallback names, and the zip branch already tried each of them in turn. The classpath
 * branch only ever tried {@code imageNames[0]}, so a texture whose primary name is absent from the
 * jar but whose fallback name is present resolved to no image at all, which renders the component
 * blank in the GUI.
 *
 * <p>Every one of this repo's 69 asset names is a primary name, so the asymmetry is latent for the
 * components the factory actually builds; the tests below drive it with a name pair, which is the
 * layout a real jar produces when it carries the base IC2 item textures ({@code uranium.png},
 * {@code heat_storage.png}) rather than the reactor-plating names.
 */
class TextureFactoryTest {

    private static final String PACK_FIXTURE = "testResources/texture-pack-probe.zip";

    /** Reads one entry of the fixture pack straight, as the oracle for which entry {@code getImageFromPack} picked. */
    private static BufferedImage readEntry(final ZipFile pack, final String entryName) throws IOException {
        ZipEntry entry = pack.getEntry(entryName);
        BufferedImage[] image = new BufferedImage[1];
        try (InputStream entryStream = pack.getInputStream(entry)) {
            image[0] = ImageIO.read(entryStream);
        }
        return image[0];
    }

    @Test
    @DisplayName("a name absent from the jar falls through to the next name")
    void missingPrimaryFallsBackToTheNextName() {
        Image direct = TextureFactory.getImage("cesium_rod.png");
        assertNotNull(direct, "the fallback name is in the jar on its own");
        assertEquals(16, direct.getWidth(null), "a texture pack icon is 16x16");
        assertEquals(16, direct.getHeight(null), "a texture pack icon is 16x16");

        Image pair = TextureFactory.getImage("notInTheJar.png", "cesium_rod.png");
        assertNotNull(pair, "the pair resolves through the second name (P3-8)");
        assertEquals(16, pair.getWidth(null), "same dimensions as the direct load");
        assertEquals(16, pair.getHeight(null), "same dimensions as the direct load");
    }

    @Test
    @DisplayName("a primary name that is present is unaffected by the fallback list")
    void presentPrimaryIsUnaffected() {
        Image primary = TextureFactory.getImage("cesium_rod.png", "notInTheJar.png");
        assertNotNull(primary, "the primary resolves and the fallback is never needed");
        assertEquals(16, primary.getWidth(null), "16x16");
    }

    @Test
    @DisplayName("names that are not in the jar resolve to no image")
    void unknownNamesResolveToNoImage() {
        assertNull(
                TextureFactory.getImage("notInTheJar.png", "alsoNotInTheJar.png"),
                "the fallback loop does not invent an image");
    }

    /**
     * The zip half of the factory was never reached by the suite: {@code TEXTURE_PACK} is only
     * non-null when an {@code erpprefs.xml} in the working directory names a real zip, and no test
     * puts one there, so the field initializer left it null and the branch was dead in every run.
     * {@link getImageFromPack} and {@link getTexturePackZip} take the pack and the preferences path
     * as arguments, which is the whole seam; the loops inside them are the shipped ones.
     *
     * <p>Only the missing-file path of {@code getTexturePackZip} is driven here. The XML half needs
     * a {@code Properties.loadFromXML} fixture, and this toolchain's parser rejects every DOCTYPE
     * form tried, so no accepted form was established — see {@code CODE_REVIEW.md}.
     */
    @Nested
    @DisplayName("the texture pack zip branch")
    class ZipBranch {

        @Test
        @DisplayName("an entry resolves at each of the asset paths the factory tries")
        void entriesResolveAtTheirAssetPaths() throws IOException {
            ZipFile pack = new ZipFile(PACK_FIXTURE);
            assertNotNull(pack.getEntry("probe_root.png"), "the fixture really carries the pack");

            Image atTheRoot = TextureFactory.getImageFromPack(pack, "probe_root.png");
            assertNotNull(atTheRoot, "the empty asset path is tried first");
            assertEquals(16, atTheRoot.getWidth(null), "a texture pack icon is 16x16");

            Image inItems = TextureFactory.getImageFromPack(pack, "probe_early.png");
            assertNotNull(inItems, "assets/ic2/textures/items/ is tried");

            Image inFuelRod = TextureFactory.getImageFromPack(pack, "probe_rod.png");
            assertNotNull(inFuelRod, "the deepest asset path is tried as well");

            Image inGtnh = TextureFactory.getImageFromPack(pack, "probe_fallback.png");
            assertNotNull(inGtnh, "a name only present under a later asset path still resolves");
        }

        @Test
        @DisplayName("the first name wins even when only the second has an earlier path")
        void firstImageNameWinsOverTheAssetPath() throws IOException {
            ZipFile pack = new ZipFile(PACK_FIXTURE);
            BufferedImage chosen = TextureFactory.getImageFromPack(pack, "probe_late.png", "probe_early.png");
            assertNotNull(chosen, "both names are in the pack");

            int late = readEntry(pack, "assets/goodgenerator/textures/items/probe_late.png").getRGB(0, 0);
            int early = readEntry(pack, "assets/ic2/textures/items/probe_early.png").getRGB(0, 0);
            assertNotEquals(late, early, "the two fixtures are distinguishable at all");
            assertEquals(late, chosen.getRGB(0, 0),
                    "the name loop is outside the path loop, so probe_late.png wins even though it "
                            + "sits at a later asset path than probe_early.png");
        }

        @Test
        @DisplayName("a name the pack does not carry resolves to no image")
        void aNameThePackDoesNotCarryIsNoImage() throws IOException {
            ZipFile pack = new ZipFile(PACK_FIXTURE);
            assertNull(TextureFactory.getImageFromPack(pack, "notInThePack.png", "alsoNotInThePack.png"),
                    "the walk does not invent an image");
        }

        @Test
        @DisplayName("no pack is skipped rather than dereferenced")
        void noPackIsSkipped() {
            assertNull(TextureFactory.getImageFromPack(null, "probe_early.png"),
                    "the shipped field is null whenever there is no erpprefs.xml to read");
        }

        @Test
        @DisplayName("a preferences file that is not there yields no pack")
        void missingPreferencesYieldNoPack() {
            assertNull(TextureFactory.getTexturePackZip("testResources/no-such-preferences.xml"),
                    "the planner runs before the GUI has written a preferences file");
        }
    }
}
