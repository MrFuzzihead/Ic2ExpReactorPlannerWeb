package Ic2ExpReactorPlanner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.awt.Image;
import org.junit.jupiter.api.DisplayName;
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
}
