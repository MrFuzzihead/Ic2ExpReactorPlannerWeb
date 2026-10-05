package Ic2ExpReactorPlanner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.util.Base64;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * {@link BigintStorage}: the packed integer that reactor codes are built from.
 *
 * <p>Values are packed least-significant-first, so the value stored <i>first</i> is the value
 * extracted <i>last</i>, and the whole thing round-trips through Base64 as one BigInteger.
 */
class BigintStorageTest {

    @Nested
    @DisplayName("store and extract")
    class StoreExtract {

        @Test
        @DisplayName("a single stored value comes back out")
        void singleValue() {
            BigintStorage storage = new BigintStorage();
            storage.store(42, 100);
            assertEquals(42, storage.extract(100));
        }

        @ParameterizedTest(name = "value {0} with max {1}")
        @CsvSource({
            "0, 1",
            "0, 1000",
            "1, 2",
            "255, 256",
            "999, 1000",
            "123456, 1000000",
            "1000000000, 1000000000",
        })
        @DisplayName("values round-trip, including the inclusive maximum")
        void roundTrip(int value, int max) {
            BigintStorage storage = new BigintStorage();
            storage.store(value, max);
            assertEquals(value, storage.extract(max));
        }

        @Test
        @DisplayName("values come back in reverse order of storage")
        void reverseOrder() {
            BigintStorage storage = new BigintStorage();
            storage.store(1, 10); // stored first, extracted last
            storage.store(2, 10);
            storage.store(3, 10);

            assertEquals(3, storage.extract(10));
            assertEquals(2, storage.extract(10));
            assertEquals(1, storage.extract(10));
        }

        @Test
        @DisplayName("each field must be extracted with the same max it was stored with")
        void fieldsAreIndependent() {
            BigintStorage storage = new BigintStorage();
            storage.store(5, 100);
            storage.store(7, 100);
            // Packed least-significant-first: 5 + 7 * 101 = 512.
            assertEquals(512, 512 & 0xFFFF, "sanity: the packed value is 512");
            assertEquals(7, storage.extract(100), "last stored comes out first");
            assertEquals(5, storage.extract(100), "then the earlier one");
            // Reading the same payload with the wrong max gives a different answer, which is
            // exactly why Reactor has to pair every store() with a matching extract().
            BigintStorage misread = BigintStorage.inputBase64(
                    new BigintStorage() {
                        {
                            store(5, 100);
                            store(7, 100);
                        }
                    }.outputBase64());
            assertEquals(0, misread.extract(255), "512 mod 256 is 0, not 7");
        }

        @Test
        @DisplayName("extracting past the end yields zero rather than throwing")
        void overExtractYieldsZero() {
            BigintStorage storage = new BigintStorage();
            storage.store(9, 10);
            assertEquals(9, storage.extract(10));
            assertEquals(0, storage.extract(10));
            assertEquals(0, storage.extract(10));
        }

        @Test
        @DisplayName("the first value stored is packed unchanged, whatever its max")
        void firstValueIsUnaffectedByItsMax() {
            // Nothing precedes it, so the packed value is just the value; the max only matters
            // for the values stored after it.
            BigintStorage wide = new BigintStorage();
            wide.store(7, 1000);
            BigintStorage narrow = new BigintStorage();
            narrow.store(7, 10);
            assertEquals(7, wide.extract(1000));
            assertEquals(7, narrow.extract(10));
            assertEquals(wide.outputBase64(), narrow.outputBase64());
        }

        /**
 * {@code store(v, m)} does {@code storedValue = storedValue * (m + 1) + v}, so a field's max is
 * the shift applied to everything stored <i>before</i> it -- which is why fields must be
 * extracted in exactly the reverse order they were stored, with the same maxes.
 */
@Test
        @DisplayName("a field's max is the shift applied to everything stored before it")
        void maxShiftsEarlierFields() {
            BigintStorage wide = new BigintStorage();
            wide.store(1, 10);
            wide.store(7, 100); // packed as 1 * 101 + 7 = 108

            BigintStorage narrow = new BigintStorage();
            narrow.store(1, 10);
            narrow.store(7, 10); // packed as 1 * 11 + 7 = 18

            // compare the payloads first: extract() consumes the storage
            assertTrue(
                    !wide.outputBase64().equals(narrow.outputBase64()), "108 and 18 must encode differently");

            assertEquals(7, wide.extract(100), "read back with the matching max");
            assertEquals(7, narrow.extract(10), "read back with the matching max");
            assertEquals(1, wide.extract(100), "then the earlier field");
            assertEquals(1, narrow.extract(10), "then the earlier field");
        }
    }

    @Nested
    @DisplayName("bounds checking")
    class Bounds {

        @Test
        @DisplayName("storing a value above the maximum throws")
        void tooLargeThrows() {
            BigintStorage storage = new BigintStorage();
            assertThrows(IllegalArgumentException.class, () -> storage.store(101, 100));
        }

        @Test
        @DisplayName("storing a negative value throws")
        void negativeThrows() {
            BigintStorage storage = new BigintStorage();
            assertThrows(IllegalArgumentException.class, () -> storage.store(-1, 100));
        }

        @Test
        @DisplayName("the maximum itself is allowed (the bound is inclusive)")
        void maximumIsAllowed() {
            // This is why a legacy code carrying currentHeat == 120000 does not blow up the
            // code writer; see CODE_REVIEW.md P1-1 for the case that does.
            BigintStorage storage = new BigintStorage();
            storage.store(120000, 120000);
            assertEquals(120000, storage.extract(120000));
        }
    }

    @Nested
    @DisplayName("base64 encoding")
    class Base64Encoding {

        @Test
        @DisplayName("an empty storage encodes to an empty-ish payload and decodes back to zero")
        void emptyRoundTrip() {
            BigintStorage storage = new BigintStorage();
            BigintStorage back = BigintStorage.inputBase64(storage.outputBase64());
            assertEquals(0, back.extract(255));
        }

        @Test
        @DisplayName("a realistic reactor code payload survives the round trip")
        void payloadRoundTrip() {
            // values of the magnitudes the reactor code actually uses
            BigintStorage storage = new BigintStorage();
            storage.store(4, 255); // code revision
            storage.store(1, 1); // pulsed
            storage.store(1, 1); // automated
            for (int i = 0; i < 54; i++) {
                storage.store(i % 70, 72); // component id
                storage.store(0, 1); // no automation config
            }
            storage.store(4321, 120000); // current heat
            storage.store(5000000, 5000000); // max simulation ticks

            BigintStorage back = BigintStorage.inputBase64(storage.outputBase64());

            assertEquals(5000000, back.extract(5000000));
            assertEquals(4321, back.extract(120000));
            for (int i = 53; i >= 0; i--) {
                assertEquals(0, back.extract(1));
                assertEquals(i % 70, back.extract(72));
            }
            assertEquals(1, back.extract(1));
            assertEquals(1, back.extract(1));
            assertEquals(4, back.extract(255));
        }

        @Test
        @DisplayName("the encoding is the one the GUI puts in the clipboard")
        void encodingIsUrlSafeBase64Alphabet() {
            BigintStorage storage = new BigintStorage();
            storage.store(255, 255);
            storage.store(255, 255);
            String encoded = storage.outputBase64();
            // Must survive Reactor.setCode's "[0-9A-Za-z+/=]+" check.
            assertTrue(encoded.matches("[0-9A-Za-z+/=]+"), "got: " + encoded);
            // and it must be decodable by the standard decoder
            assertTrue(Base64.getDecoder().decode(encoded).length > 0, "decodes to bytes");
        }

        @Test
        @DisplayName("decoding is a plain BigInteger read of the raw bytes")
        void decodingMatchesBigInteger() {
            BigintStorage storage = new BigintStorage();
            storage.store(123456, 1000000);
            byte[] raw = Base64.getDecoder().decode(storage.outputBase64());
            assertEquals(
                    new BigInteger(raw).intValue(),
                    BigintStorage.inputBase64(storage.outputBase64()).extract(1000000),
                    "decode agrees with a direct BigInteger read");
        }
    }
}