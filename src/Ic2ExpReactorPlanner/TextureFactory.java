/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */
package Ic2ExpReactorPlanner;

import java.awt.Image;
import java.awt.image.BufferedImage;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import javax.imageio.ImageIO;

/**
 *
 * @author Brian McCloud
 */
public class TextureFactory {

    private TextureFactory() {}

    private static final ZipFile TEXTURE_PACK = getTexturePackZip("erpprefs.xml");

    // paths within the texture pack zip to check for the texture images.
    private static final String[] ASSET_PATHS = {
        "",
        "assets/ic2/textures/items/",
        "assets/ic2/textures/items/reactor/",
        "assets/ic2/textures/items/reactor/fuel_rod/",
        "assets/gregtech/textures/items/",
        "assets/fm/textures/items/",
        "assets/gtnh/textures/items/",
        "assets/goodgenerator/textures/items/",
    };

    /**
     * The zip half of {@link getImage}, extracted so a test can reach it: {@code TEXTURE_PACK} is
     * only non-null when an {@code erpprefs.xml} in the working directory names a real zip, and
     * nothing in the suite ever puts one there, which is why the branch had no coverage. Passing
     * the pack in is the whole seam — the loop body is unchanged.
     */
    public static BufferedImage getImageFromPack(final ZipFile pack, final String... imageNames) {
        BufferedImage result = null;
        if (pack != null) {
            for (String imageName : imageNames) {
                for (String asset_path : ASSET_PATHS) {
                    if (result == null) {
                        ZipEntry entry = pack.getEntry(asset_path + imageName);
                        if (entry != null) {
                            try (InputStream entryStream = pack.getInputStream(entry)) {
                                result = ImageIO.read(entryStream);
                            } catch (IOException ex) {
                                // ignore, fall back to default texture.
                            }
                        }
                    }
                }
            }
        }
        return result;
    }

    public static Image getImage(final String... imageNames) {
        Image result = getImageFromPack(TEXTURE_PACK, imageNames);

        // The zip branch above tries every fallback name, so this branch has to as well: a texture
        // whose primary name is absent from the jar but whose fallback name is present used to
        // resolve to no image at all, which renders the component blank (CODE_REVIEW.md P3-8). The
        // loop nesting mirrors the zip branch, so a primary name that is present still wins.
        if (result == null) {
            for (String imageName : imageNames) {
                for (String asset_path : ASSET_PATHS) {
                    if (result == null && TextureFactory.class.getResource("/" + asset_path + imageName) != null) {
                        try (InputStream stream = TextureFactory.class.getResourceAsStream("/" + asset_path + imageName)) {
                            result = ImageIO.read(stream);
                        } catch (IOException ex) {
                            ExceptionDialogDisplay.showExceptionDialog(ex);
                        }
                    }
                }
            }
        }
        return result;
    }

    /**
     * The other seam: reading the texture pack's name out of the preferences file. Extracted with
     * the path as an argument so a test can point it at a fixture; the shipped call above still
     * reads the {@code erpprefs.xml} in the working directory, which is what the GUI writes there.
     */
    public static ZipFile getTexturePackZip(final String configPath) {
        try (FileInputStream configStream = new FileInputStream(configPath)) {
            Properties config = new Properties();
            config.loadFromXML(configStream);
            String texturePackName = config.getProperty("texturePack");
            if (texturePackName != null) {
                ZipFile result = new ZipFile(texturePackName);
                return result;
            }
        } catch (FileNotFoundException ex) {
            // ignore, this might just mean the file hasn't been created yet.
        } catch (IOException | NullPointerException ex) {
            // ignore, security settings or whatever preventing reading the xml file (or resource pack zip) should not
            // stop the planner from running.
        }
        return null;
    }
}
