const fs = require('fs');
const path = require('path');
const Fuse = require('fuse.js');
const { normalizeWhitespace, stripArabicDiacritics } = require('./arabicDetector');

const DEFAULT_ALIASES = {
  '1:1': ['bismillahirrahmanirrahim', 'bismillah hirrahman nirrahim'],
  '1:2': ['alhamdulillahi rabbil alamin', 'alhamdulillah rabbil alamin'],
  '1:5': ['iyyaka nabudu waiyyaka nasta in', 'iyyaka nabudu wa iyyaka ??????', 'iyyaka na budu'],
  '112:1': ['qul huwallahu ahad', 'qul huwa allahu ahad', 'kul huwallahu ahad'],
  '112:2': ['allahu samad', 'allahus samad'],
  '112:3': ['lam yalid walam yulad'],
  '112:4': ['walam yakun lahu kufuwan ahad'],
  '113:1': ['qul audzu birabbil falaq', 'kul audzu birabbil falaq'],
  '114:1': ['qul audzu birabbin nas', 'kul audzu birabbin nas'],
};

function normalizeSearchText(text) {
  return normalizeWhitespace(String(text || ''))
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class QuranRepository {
  /**
   * @param {object} [options]
   * @param {string} [options.dbPath]
   */
  constructor(options = {}) {
    this.dbPath =
      options.dbPath ||
      process.env.QURAN_DB_PATH ||
      path.join(process.cwd(), 'data', 'quran.json');
    this.entries = [];
    this.fuse = null;
    this.loaded = false;
  }

  /**
   * Load the Quran JSON repository once.
   * @returns {void}
   */
  load() {
    if (this.loaded) {
      return;
    }

    const raw = fs.readFileSync(this.dbPath, 'utf8');
    const data = JSON.parse(raw);
    const entries = [];

    for (const surahNumber of Object.keys(data)) {
      const surah = data[surahNumber];
      for (const ayahNumber of Object.keys(surah)) {
        const verse = surah[ayahNumber];
        const key = `${verse.surah_number}:${verse.ayah_number}`;
        const aliases = DEFAULT_ALIASES[key] || [];
        const searchText = [
          verse.text_ar,
          stripArabicDiacritics(verse.text_ar || ''),
          verse.text_id,
          verse.text_de,
          verse.surah_name,
          aliases.join(' '),
        ]
          .filter(Boolean)
          .map(normalizeSearchText)
          .join(' ');

        entries.push({
          ...verse,
          searchText,
          aliases,
        });
      }
    }

    this.entries = entries;
    this.fuse = new Fuse(entries, {
      includeScore: true,
      threshold: 0.28,
      ignoreLocation: true,
      minMatchCharLength: 4,
      keys: ['searchText'],
    });
    this.loaded = true;
  }

  /**
   * Fuzzy lookup against the local Quran repository.
   * @param {string} text
   * @returns {{ found: boolean, confidence: number, found_in_db?: boolean, exactAlias?: boolean, surah_name?: string, surah_number?: number, ayah_number?: number, text_ar?: string, text_de?: string, text_id?: string }}
   */
  lookup(text) {
    this.load();

    const query = normalizeSearchText(text);
    if (!query) {
      return { found: false, confidence: 0, found_in_db: false, exactAlias: false };
    }

    for (const entry of this.entries) {
      for (const alias of entry.aliases) {
        const normalizedAlias = normalizeSearchText(alias);
        if (query === normalizedAlias || query.includes(normalizedAlias) || normalizedAlias.includes(query)) {
          return this._toResult(entry, 0.97, true);
        }
      }
    }

    const [bestMatch] = this.fuse.search(query, { limit: 1 });
    if (!bestMatch) {
      return { found: false, confidence: 0, found_in_db: false, exactAlias: false };
    }

    const confidence = Number((1 - (bestMatch.score || 1)).toFixed(2));
    if (confidence < 0.86 || query.split(' ').length < 4) {
      return { found: false, confidence: 0, found_in_db: false, exactAlias: false };
    }

    return this._toResult(bestMatch.item, confidence, false);
  }

  _toResult(entry, confidence, exactAlias) {
    return {
      found: true,
      found_in_db: true,
      exactAlias,
      confidence,
      surah_name: entry.surah_name,
      surah_number: Number(entry.surah_number),
      ayah_number: Number(entry.ayah_number),
      text_ar: entry.text_ar,
      text_de: entry.text_de,
      text_id: entry.text_id,
    };
  }
}

module.exports = {
  QuranRepository,
  normalizeSearchText,
};
