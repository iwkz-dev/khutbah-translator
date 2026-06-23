const fs = require('fs');
const csv = require('csv-parser');
const { Readable } = require('stream');

/**
 * Download Quran Multilingual dari HuggingFace
 * Convert CSV -> JSON dengan terjemahan Jerman official
 *
 * Run: node scripts/downloadQuranDB.js
 */

async function downloadQuranDB() {
    console.log('Downloading Quran Multilingual from HuggingFace...');

    const url =
        'https://huggingface.co/datasets/freococo/quran_multilingual_parallel/resolve/main/quran_multilingual_parallel.csv';

    const quranDB = {};
    let rowCount = 0;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(
                `Failed to download: ${response.status} ${response.statusText}`,
            );
        }

        const csvText = await response.text();

        await new Promise((resolve, reject) => {
            Readable.from([csvText])
                .pipe(csv())
                .on('data', (row) => {
                    try {
                        const surah = String(row.surah_number ?? '').trim();
                        const surahName = String(row.surah ?? '').trim();
                        const ayah = String(row.ayah ?? '').trim();
                        const arabic = String(row.arabic ?? '').trim();
                        const german = String(row.german ?? '').trim();
                        const indonesian = String(row.indonesian ?? '').trim();

                        if (!surah || !ayah) {
                            return;
                        }

                        if (!quranDB[surah]) {
                            quranDB[surah] = {};
                        }

                        quranDB[surah][ayah] = {
                            text_ar: arabic,
                            text_de: german,
                            text_id: indonesian,
                            surah_name: surahName,
                            surah_number: surah,
                            ayah_number: ayah,
                        };

                        rowCount++;
                    } catch (error) {
                        reject(error);
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        if (!fs.existsSync('data')) {
            fs.mkdirSync('data', { recursive: true });
        }

        const outputPath = 'data/quran.json';
        fs.writeFileSync(outputPath, JSON.stringify(quranDB, null, 2));

        console.log('Quran DB saved to data/quran.json');
        console.log(`Total surah: ${Object.keys(quranDB).length}`);
        console.log(`Total ayah: ${rowCount}`);
        console.log(
            `File size: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`,
        );
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

downloadQuranDB();
