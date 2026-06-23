# AI CODING PROMPT — Khutbah Translator: Arabic Detector, Classifier, Quran DB, and Local Output Logging

## Context & Goal

Kamu adalah senior Node.js developer. Project Khutbah Live Translator sudah memiliki:

1. Python STT sidecar yang working
2. Node.js Whisper bridge yang working

Sekarang kita lanjut ke modul inti untuk handling teks Arab.

### Tujuan Modul Ini
Kita ingin:
- mendeteksi apakah hasil transkripsi mengandung bahasa Arab / transliterasi Arab / teks umum,
- mengklasifikasikan apakah itu Quran, hadits, atau doa,
- melakukan lookup ke Quran DB lokal,
- menampilkan output Arab asli jika match,
- menyimpan semua hasil ke file lokal agar bisa direview manual.

---

## Output Behavior yang Diinginkan

### Jika teks biasa Bahasa Indonesia
Output tetap Latin, lalu nanti bisa diteruskan ke translator Jerman.

Contoh:
```json
{
  "id": "seg-12",
  "source_text": "Marilah kita bertakwa kepada Allah",
  "category": "normal",
  "display_text": "Marilah kita bertakwa kepada Allah",
  "display_script": "latin",
  "confidence": 0.98,
  "saved_to_local": true
}
```

### Jika teks Quran / Hadits / Doa
Untuk sekarang, tampilkan **teks Arab asli** jika memungkinkan, supaya bisa direview apakah hasil mapping-nya benar.

Contoh:
```json
{
  "id": "seg-13",
  "source_text": "Qul huwallahu ahad",
  "category": "quran",
  "display_text": "قُلْ هُوَ اللَّهُ أَحَدٌ",
  "display_script": "arabic",
  "surah_name": "Al-Ikhlas",
  "surah_number": 112,
  "ayah_number": 1,
  "confidence": 0.94,
  "found_in_db": true,
  "saved_to_local": true
}
```

### Jika tidak yakin / tidak match
Boleh tetap keluarkan label sementara, tapi simpan detailnya ke local log untuk review.

Contoh:
```json
{
  "id": "seg-14",
  "source_text": "...",
  "category": "uncertain_arabic",
  "display_text": "[Arab — belum terverifikasi]",
  "display_script": "latin",
  "confidence": 0.51,
  "found_in_db": false,
  "saved_to_local": true
}
```

---

## Scope Tugas

Fokus hanya pada modul backend berikut:
- Arabic detector
- Arabic classifier
- Quran DB repository
- local output logging
- demo/test console

Jangan buat frontend dulu. Jangan buat WebSocket broadcast.

---

## Directory Target

Buat modul yang clean dan mudah dipakai modul berikutnya.

Rekomendasi struktur:

```
modules/
├── arabicDetector.js
├── arabicClassifier.js
├── quranRepository.js
├── localOutputStore.js
└── demoArabicTest.js
```

Kalau menurutmu bisa digabung, silakan gabungkan 1–2 file selama tetap bersih. Tapi jangan over-engineer.

---

## Arabic Detector Requirements

### Goal
Detektor harus cepat dan ringan. Gunakan heuristik, bukan ML besar.

### Input
String hasil transkripsi dari Whisper.

### Output
```javascript
{
  isArabic: boolean,
  confidence: number,
  evidence: string[]
}
```

### Heuristik yang diharapkan
Gunakan kombinasi:
1. Unicode range Arab: `؀-ۿ`
2. Kata/frasa transliterasi umum: `bismillah`, `alhamdulillah`, `allahu akbar`, dll
3. Rasio karakter Arab terhadap total karakter
4. Pattern kata pendek yang khas khotbah / doa / ayat

### Minimal class/function
```javascript
class ArabicDetector {
  detect(text) { ... }
}
```

---

## Arabic Classifier Requirements

### Goal
Mengklasifikasikan hasil deteksi menjadi:
- `quran`
- `hadith`
- `dua`
- `normal`
- `uncertain_arabic`

### Input
- text hasil transkripsi
- hasil detektor

### Output
```javascript
{
  category: 'quran' | 'hadith' | 'dua' | 'normal' | 'uncertain_arabic',
  confidence: number,
  reason: string
}
```

### Heuristik yang diharapkan
- Jika ada match ke Quran DB → `quran`
- Jika ada frasa doa umum → `dua`
- Jika ada pola hadits / sanad / redaksi naratif → `hadith`
- Jika Arabic detected tapi tidak jelas → `uncertain_arabic`
- Jika tidak Arab → `normal`

Jangan pakai model besar. Cukup heuristik + lookup.

---

## Quran Repository Requirements

### Source Data
Gunakan Quran DB lokal yang sudah disiapkan dari HuggingFace `quran_multilingual_parallel`.

### File JSON Lokal
Misalnya:
```text
data/quran-de.json
```

### Data yang Harus Ada per ayat
- `text_ar`
- `text_de`
- `text_id`
- `surah_name`
- `surah_number`
- `ayah_number`

### Repository Behavior
Buat class atau module repository yang bisa:
- load JSON sekali saat startup,
- fuzzy search berdasarkan teks transkripsi,
- return hasil terbaik dengan confidence,
- beri `found_in_db: true/false`

### Output Lookup
```javascript
{
  found: true,
  confidence: 0.93,
  surah_name: 'Al-Ikhlas',
  surah_number: 112,
  ayah_number: 1,
  text_ar: 'قُلْ هُوَ اللَّهُ أَحَدٌ',
  text_de: 'Sag: Er ist Allah, ein Einziger',
  text_id: 'Katakanlah: Dia-lah Allah, Yang Maha Esa.'
}
```

### Jika tidak match
```javascript
{
  found: false,
  confidence: 0.0
}
```

### Fuzzy Search
Boleh gunakan library ringan seperti Fuse.js atau implementasi sederhana.

---

## Local Output Store Requirements

Kita ingin semua hasil disimpan lokal untuk review manual.

### Format File yang Diinginkan
Gunakan JSON Lines (`.jsonl`) supaya mudah append per event.

Contoh file:
```text
outputs/session-2026-06-23.jsonl
```

### Tiap baris JSON
```json
{"timestamp":"2026-06-23T13:49:48Z","id":"seg-13","source_text":"Qul huwallahu ahad","category":"quran","display_text":"قُلْ هُوَ اللَّهُ أَحَدٌ","display_script":"arabic","confidence":0.94,"found_in_db":true}
```

### Requirement
Buat module yang bisa:
- create file output jika belum ada,
- append satu baris JSON per hasil,
- aman jika dipanggil berkali-kali,
- tidak crash jika folder output belum ada.

---

## Demo / Test Console

Buat script demo agar modul ini bisa dites tanpa frontend.

### File test disarankan
```text
demo/demoArabicTest.js
```

### Test yang diharapkan
- load Quran DB
- test beberapa input sample
- print hasil detektor, classifier, lookup, dan local save
- bisa test dari console

### Contoh command
```bash
node demo/demoArabicTest.js
```

### Contoh output
```text
=== Arabic Pipeline Test ===

Input: Qul huwallahu ahad
Detector: Arabic yes (0.94)
Classifier: quran
Quran DB: found
Display: قُلْ هُوَ اللَّهُ أَحَدٌ
Saved to: outputs/session-2026-06-23.jsonl

Input: Marilah kita bertakwa kepada Allah
Detector: Arabic no (0.12)
Classifier: normal
Display: Marilah kita bertakwa kepada Allah
Saved to: outputs/session-2026-06-23.jsonl

Test completed successfully!
```

---

## Clean Code Requirements

1. Pakai CommonJS atau ES Modules, konsisten.
2. Pisahkan logic detector, classifier, repository, dan output store dengan jelas.
3. Jangan over-engineer, tapi tetap maintainable.
4. Gunakan type hints / JSDoc untuk public functions.
5. Semua file harus bisa dipakai modul berikutnya tanpa refactor besar.
6. Error handling jelas.
7. Logging ke console seperlunya.
8. `localOutputStore` jangan blocking terlalu lama, tapi untuk tahap ini cukup simple dan reliable.

---

## Output Ideal yang Diharapkan

### Normal text
```javascript
{
  id: 'seg-12',
  sourceText: 'Marilah kita bertakwa kepada Allah',
  category: 'normal',
  displayText: 'Marilah kita bertakwa kepada Allah',
  displayScript: 'latin',
  confidence: 0.98,
  foundInDb: false,
  savedToLocal: true
}
```

### Quran / Hadith / Dua
```javascript
{
  id: 'seg-13',
  sourceText: 'Qul huwallahu ahad',
  category: 'quran',
  displayText: 'قُلْ هُوَ اللَّهُ أَحَدٌ',
  displayScript: 'arabic',
  surahName: 'Al-Ikhlas',
  surahNumber: 112,
  ayahNumber: 1,
  confidence: 0.94,
  foundInDb: true,
  savedToLocal: true
}
```

### Uncertain Arabic
```javascript
{
  id: 'seg-14',
  sourceText: '...',
  category: 'uncertain_arabic',
  displayText: '[Arab — belum terverifikasi]',
  displayScript: 'latin',
  confidence: 0.51,
  foundInDb: false,
  savedToLocal: true
}
```

---

## Non-Goals

Jangan buat:
- frontend / browser / VAD
- WebSocket broadcast
- Ollama translation
- STT
- REST API publik

Fokus hanya pada pipeline Arabic detection + classifier + Quran DB lookup + local logging.

---

## Final Note

Utamakan hasil yang stabil, mudah dipakai, dan mudah di-review. Kalau perlu gabungkan 2 file untuk menjaga kode lebih sederhana, itu boleh. Tapi pastikan alur jelas dan outputnya konsisten.

