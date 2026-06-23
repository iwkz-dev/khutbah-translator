class ArabicClassifier {
  /**
   * Classify Arabic-related text using heuristics and optional Quran lookup.
   * @param {string} text
   * @param {{ isArabic: boolean, confidence: number, evidence: string[] }} detection
   * @param {{ found?: boolean, confidence?: number, exactAlias?: boolean }} [quranLookup]
   * @returns {{ category: 'quran'|'hadith'|'dua'|'normal'|'uncertain_arabic', confidence: number, reason: string }}
   */
  classify(text, detection, quranLookup = { found: false, confidence: 0, exactAlias: false }) {
    const source = String(text || '').trim();
    const lowered = source.toLowerCase();

    if (!detection.isArabic) {
      return {
        category: 'normal',
        confidence: Number((1 - Math.min(detection.confidence, 0.9)).toFixed(2)),
        reason: 'detector did not find strong Arabic evidence',
      };
    }

    if (/(allahumma|rabbana|ya\s+allah|subhanaka|amin\b|aamiin\b|as\s+aluka)/i.test(lowered)) {
      return {
        category: 'dua',
        confidence: Number(Math.max(detection.confidence, 0.7).toFixed(2)),
        reason: 'matched common dua phrases',
      };
    }

    if (/(qala\s+rasul|rasulullah\s+bersabda|dari\s+abu|rawahu|shallallahu)/i.test(lowered)) {
      return {
        category: 'hadith',
        confidence: Number(Math.max(detection.confidence, 0.68).toFixed(2)),
        reason: 'matched common hadith narration patterns',
      };
    }

    if (quranLookup.found && (quranLookup.exactAlias || (quranLookup.confidence || 0) >= 0.9)) {
      return {
        category: 'quran',
        confidence: Number(Math.max(detection.confidence, quranLookup.confidence || 0).toFixed(2)),
        reason: 'matched quran repository',
      };
    }

    return {
      category: 'uncertain_arabic',
      confidence: Number(Math.max(detection.confidence, 0.5).toFixed(2)),
      reason: 'arabic evidence found but no strong quran/hadith/dua classification',
    };
  }
}

module.exports = {
  ArabicClassifier,
};
