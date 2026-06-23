const TRANSLITERATION_PATTERNS = [
  /bismill(?:a|ah|ahir?)/i,
  /alhamdulillah/i,
  /subhanallah/i,
  /allahu\s+akbar/i,
  /masya\s*allah/i,
  /insya\s*allah/i,
  /astaghfirullah/i,
  /la\s+ilaha\s+illallah/i,
  /assalamu(?:'|’)alaikum|assalamualaikum/i,
  /rahman/i,
  /rahim/i,
  /rasulullah/i,
  /shallallahu/i,
  /surah/i,
  /ayat/i,
  /quran/i,
  /huwallahu/i,
  /qul\s+hu/i,
  /iyyaka/i,
  /na'budu|nasta'in/i,
  /allahumma/i,
  /rabbana/i,
  /qala/i,
  /ya\s+allah/i,
  /as\s+aluka/i,
];

const COMMON_ARABIC_TOKEN_PATTERN = /(\u0627\u0644\u0644\u0647|\u0627\u0644\u0631\u062d\u0645\u0646|\u0627\u0644\u0631\u062d\u064a\u0645|\u0642\u0644|\u0647\u0648|\u0623\u062d\u062f|\u0625\u064a\u0627\u0643)/u;

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function stripArabicDiacritics(text) {
  return text.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');
}

class ArabicDetector {
  /**
   * Detect whether a transcription likely contains Arabic content.
   * @param {string} text
   * @returns {{ isArabic: boolean, confidence: number, evidence: string[] }}
   */
  detect(text) {
    const source = normalizeWhitespace(text);
    if (!source) {
      return { isArabic: false, confidence: 0, evidence: [] };
    }

    const evidence = [];
    const arabicMatches = source.match(/[\u0600-\u06FF]/g) || [];
    const arabicRatio = source.length > 0 ? arabicMatches.length / source.length : 0;
    let confidence = 0;

    if (arabicMatches.length > 0) {
      evidence.push('arabic_unicode');
      confidence += 0.7 + Math.min(arabicRatio, 0.3);
    }

    const transliterationHits = TRANSLITERATION_PATTERNS.filter((pattern) => pattern.test(source));
    if (transliterationHits.length > 0) {
      evidence.push(`transliteration:${transliterationHits.length}`);
      confidence += Math.min(0.24 * transliterationHits.length, 0.72);
    }

    const normalizedArabic = stripArabicDiacritics(source);
    if (COMMON_ARABIC_TOKEN_PATTERN.test(normalizedArabic)) {
      evidence.push('common_arabic_tokens');
      confidence += 0.2;
    }

    confidence = Math.min(1, confidence);
    const isArabic = arabicMatches.length > 0 || confidence >= 0.45;

    return {
      isArabic,
      confidence: Number(confidence.toFixed(2)),
      evidence,
    };
  }
}

module.exports = {
  ArabicDetector,
  normalizeWhitespace,
  stripArabicDiacritics,
};
