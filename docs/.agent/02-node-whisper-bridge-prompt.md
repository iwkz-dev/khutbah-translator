# AI CODING PROMPT — Khutbah Translator: Node.js Whisper Bridge

## Context & Goal

Kamu adalah senior Node.js developer. Kamu diminta membuat backend bridge untuk project Khutbah Live Translator.

Project ini sudah memiliki Python STT sidecar yang sudah working dan bisa diuji dengan:

```bash
python python/whisper_sidecar.py --test --dummy
```

Output sidecar sudah terbukti jalan dan mengembalikan hasil seperti:

```text
=== Whisper Sidecar Test Mode ===
Model    : medium
Device   : cpu
Compute  : int8

Loading model...
OK Model loaded in 3.6s

Running transcription...
OK Result: "Al-Fatiha"
   Language  : id (confidence: 1.00)
   Duration  : 5425ms
   Audio len : 3.0s

Test completed successfully!
```

Sekarang tugas kamu adalah membuat **Node.js backend bridge** yang menghubungkan audio segment dari upstream ke Python sidecar, lalu menyiapkan output JSON yang rapi untuk pipeline berikutnya.

---

## Scope Tugas

Fokus hanya pada backend bridge. Jangan buat frontend/web app dulu.

Yang harus dibuat:
- Node.js process yang spawn Python sidecar
- komunikasi stdin/stdout JSON line-based
- queue/request handling sederhana
- parsing hasil transkripsi
- API internal yang mudah dipakai module berikutnya
- test mode via console (tanpa browser)

---

## Arsitektur yang Diinginkan

Kita tidak perlu terlalu banyak class kalau bisa dibuat lebih simple tanpa mengorbankan kualitas. Karena ini masih tahap awal, kamu boleh gabungkan class jika itu membuat code lebih bersih.

Rekomendasi struktur minimal:
- 1 file utama untuk bridge
- 1 file test runner atau demo CLI di `demo/`

Jika kamu tetap merasa class diperlukan, gunakan maksimum 2-3 class saja dan jangan over-engineer.

---

## Directory Target

```
modules/
├── whisperBridge.js      ← utama
└── demoWhisperTest.js    ← test console sederhana (opsional tapi disarankan)
```

Atau jika lebih rapi, boleh juga buat:

```
modules/
└── whisperBridge.js      ← termasuk test harness internal
```

Pilih struktur yang paling clean menurutmu, jangan memaksa banyak file kalau tidak perlu.

---

## Requirement Fungsional

### 1. Spawn Python Sidecar
Node.js harus spawn process:

```bash
python python/whisper_sidecar.py
```

- Path Python script harus configurable via ENV, default ke `python/whisper_sidecar.py`
- Python executable juga configurable via ENV, default `python`

### 2. Load State
Saat sidecar start, Node.js harus menunggu pesan ready dari stdout:

```json
{"status":"ready","model":"medium","device":"cpu","compute_type":"int8"}
```

Node.js harus menyimpan status ready dan menolak request sebelum siap.

### 3. Request/Response JSON
Input dari Node.js ke Python:

```json
{"id":"seg-12","audio":[0.001,-0.003,...]}
```

Output dari Python ke Node.js:

```json
{"id":"seg-12","text":"Marilah kita bertakwa kepada Allah","language":"id","language_probability":0.98,"duration_ms":380}
```

Jika error:

```json
{"id":"seg-12","error":"transcription failed: ..."}
```

### 4. Queue Handling
Bridge harus aman untuk beberapa request berurutan.

Gunakan satu-antrian sederhana:
- request masuk ke queue
- kirim ke Python satu per satu
- tunggu response sebelum kirim request berikutnya

Tidak perlu paralel dulu. Prioritaskan stabilitas.

### 5. Internal API
Buat API internal yang simple, misalnya:

```javascript
const bridge = new WhisperBridge();
await bridge.start();
const result = await bridge.transcribe(audioArray, 'seg-12');
await bridge.stop();
```

Atau API equivalent yang menurutmu paling clean.

---

## Mode Testing Console

Script harus bisa diuji langsung dari console, tanpa browser, misalnya:

```bash
node demo/demoWhisperTest.js
```

### Test Mode Minimal
- load bridge
- kirim dummy audio array atau file wav pendek
- print hasil transkripsi ke console
- print waktu proses

### Contoh output yang diharapkan

```text
=== Whisper Bridge Test ===
Bridge starting...
✅ Python sidecar ready

Sending test audio...
✅ Result: "Al-Fatiha"
Language: id (1.00)
Duration: 5425ms
Bridge latency: 380ms

Test completed successfully!
```

### Dummy Audio Test
Kalau tidak ada file audio, buat dummy audio kecil supaya kita bisa verify flow end-to-end.

---

## Clean Code / Quality Requirements

1. Gunakan CommonJS atau ES Modules — pilih salah satu, konsisten.
2. Gunakan async/await, hindari callback style yang berantakan.
3. Error handling harus jelas.
4. Logging seperlunya saja.
5. Jangan hardcode path kalau bisa di-env-kan.
6. Jaga file tetap pendek dan mudah dibaca.
7. Tambahkan JSDoc pada public method.
8. Validasi input audio array.
9. Jangan crash kalau Python sidecar error — return error object dengan rapi.

---

## Output Yang Diinginkan

### File Utama
`modules/whisperBridge.js`

### File Test (disarankan)
`demo/demoWhisperTest.js`

### Ekspor yang diharapkan

```javascript
module.exports = {
  WhisperBridge
};
```

Atau jika kamu pakai fungsi langsung, pastikan API-nya tetap rapi dan mudah dipakai modul berikutnya.

---

## Integration Notes

Bridge ini nanti akan dipakai oleh modul berikutnya:
- audio segment router
- Arabic detector
- classifier Quran/Hadits/Doa
- translator Ollama

Jadi output yang kamu buat harus bersih dan mudah dipass ke layer berikutnya.

### Output result ideal:

```javascript
{
  id: 'seg-12',
  text: 'Marilah kita bertakwa kepada Allah',
  language: 'id',
  languageProbability: 0.98,
  durationMs: 380,
  ok: true
}
```

### Output error ideal:

```javascript
{
  id: 'seg-12',
  ok: false,
  error: 'transcription failed: ...'
}
```

---

## Non-Goals

Jangan buat:
- frontend / browser / VAD
- WebSocket broadcast ke TV
- Arabic detection
- Ollama translation
- Quran DB
- REST API publik

Fokus hanya pada bridge Node.js ↔ Python STT sidecar.

---

## Final Note

Buat solusi yang paling clean dan pragmatic. Kalau menurutmu satu class + satu demo file cukup, itu boleh. Kalau lebih bagus tanpa class, tetap boleh selama API tetap rapi dan maintainable.

