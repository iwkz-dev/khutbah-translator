const { ArabicDetector } = require('./arabicDetector');
const { ArabicClassifier } = require('./arabicClassifier');
const { QuranRepository } = require('./quranRepository');
const { LocalOutputStore } = require('./localOutputStore');

class ArabicPipeline {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    this.detector = options.detector || new ArabicDetector();
    this.repository = options.repository || new QuranRepository(options.repositoryOptions);
    this.classifier = options.classifier || new ArabicClassifier();
    this.outputStore = options.outputStore || new LocalOutputStore(options.outputStoreOptions);
  }

  /**
   * Process one transcribed segment through Arabic detection/classification.
   * @param {{ id: string, text: string, languageProbability?: number }} input
   * @returns {object}
   */
  process(input) {
    const sourceText = String(input.text || '').trim();
    const detectorResult = this.detector.detect(sourceText);
    const quranLookup = detectorResult.isArabic ? this.repository.lookup(sourceText) : { found: false, confidence: 0, found_in_db: false };
    const classification = this.classifier.classify(sourceText, detectorResult, quranLookup);

    let displayText = sourceText;
    let displayScript = 'latin';

    if (classification.category === 'quran' && quranLookup.found) {
      displayText = quranLookup.text_ar;
      displayScript = 'arabic';
    } else if (classification.category === 'uncertain_arabic') {
      displayText = '[Arab - belum terverifikasi]';
    } else if (classification.category === 'dua' || classification.category === 'hadith') {
      displayText = sourceText;
    }

    const output = {
      id: input.id,
      sourceText,
      category: classification.category,
      displayText,
      displayScript,
      confidence: Number(Math.max(classification.confidence, input.languageProbability || 0).toFixed(2)),
      foundInDb: Boolean(quranLookup.found),
    };

    if (quranLookup.found) {
      output.surahName = quranLookup.surah_name;
      output.surahNumber = quranLookup.surah_number;
      output.ayahNumber = quranLookup.ayah_number;
    }

    const saveResult = this.outputStore.append({
      id: output.id,
      source_text: output.sourceText,
      category: output.category,
      display_text: output.displayText,
      display_script: output.displayScript,
      confidence: output.confidence,
      found_in_db: output.foundInDb,
      surah_name: output.surahName,
      surah_number: output.surahNumber,
      ayah_number: output.ayahNumber,
      detector_evidence: detectorResult.evidence,
      classifier_reason: classification.reason,
    });

    return {
      ...output,
      savedToLocal: saveResult.saved,
      outputFile: saveResult.filePath,
      detector: detectorResult,
      classifierReason: classification.reason,
    };
  }
}

module.exports = {
  ArabicPipeline,
};
