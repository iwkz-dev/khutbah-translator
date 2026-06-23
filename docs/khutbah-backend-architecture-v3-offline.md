# Khutbah Live Translator — Backend Architecture v3.0 (Fully Offline)

---

## 1. Ringkasan Perubahan dari v2.1

| Komponen             | v2.1               | v3.0                       | Alasan Perubahan        |
| -------------------- | ------------------ | -------------------------- | ----------------------- |
| STT                  | OpenAI API (cloud) | Faster-Whisper (lokal)     | Gratis, offline, privat |
| Translation primary  | Ollama lokal       | Ollama lokal               | Tidak berubah           |
| Translation fallback | DeepL API          | ~~DeepL~~ Tidak diperlukan | 100% offline            |
| Audio segmentation   | VAD browser        | VAD browser                | Tidak berubah           |
| Quran DB             | Lokal offline      | Lokal offline              | Tidak berubah           |
| Biaya per bulan      | ~$0.30             | **$0.00**                  | Gratis selamanya        |
| Internet required    | Ya (STT)           | **Tidak**                  | Bisa jalan tanpa WiFi   |

---

## 2. Pipeline Lengkap v3.0

```
┌──────────────────────────────────────────────────────────────────────┐
│                         BROWSER CLIENT                               │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  VAD ENGINE (@ricky0123/vad-web, WebAssembly, ~1MB)          │   │
│  │                                                              │   │
│  │  Microphone → Float32Array frames (setiap 30ms)             │   │
│  │       ↓                                                      │   │
│  │  Silero VAD model → speech probability (0.0–1.0)            │   │
│  │       ↓                                                      │   │
│  │  onSpeechStart → tampilkan "🎙 Mendengarkan..."             │   │
│  │  onSpeechEnd   → kirim audio Float32Array via WebSocket      │   │
│  │                  (kalimat dijamin UTUH)                      │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ WebSocket binary (Float32Array — kalimat utuh)
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    SERVER (Node.js + Python sidecar)                 │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  MODULE 1: STT — Faster-Whisper (Python sidecar, lokal)       │  │
│  │                                                               │  │
│  │  Model   : whisper medium (1.5GB, didownload sekali)         │  │
│  │  Runtime : CTranslate2 (CPU-optimized)                       │  │
│  │  Language: "id" (Indonesia)                                  │  │
│  │  Prompt  : kosakata Arab khutbah (60+ frasa)                 │  │
│  │  Latency : 310–500ms (CPU), <200ms (GPU jika ada)            │  │
│  │  Output  : { text: string, language: string }                │  │
│  │                                                               │  │
│  │  Node ←→ Python via stdin/stdout JSON-RPC                    │  │
│  │  (Python process dijalankan sekali saat server start)        │  │
│  └───────────────────────┬───────────────────────────────────────┘  │
│                          │ teks transkripsi                          │
│  ┌───────────────────────▼───────────────────────────────────────┐  │
│  │  MODULE 2: ARABIC DETECTOR (3 layer paralel, <1ms)            │  │
│  │                                                               │  │
│  │  L1: Unicode range /[\u0600-\u06FF]/                         │  │
│  │  L2: Transliterasi dictionary (60+ frasa umum)               │  │
│  │  L3: Rasio karakter Arab > 30%                               │  │
│  │                                                               │  │
│  │  Output: { isArabic: bool, confidence: float, raw: string }  │  │
│  └───────────────────────┬───────────────────────────────────────┘  │
│                          │                                           │
│           ┌──────────────┴───────────────────┐                      │
│           │ isArabic = true                   │ isArabic = false     │
│           ▼                                   ▼                      │
│  ┌─────────────────────────┐      ┌────────────────────────────┐    │
│  │  MODULE 3A:             │      │  MODULE 3B:                │    │
│  │  ARABIC HANDLER         │      │  OLLAMA STREAMING          │    │
│  │                         │      │                            │    │
│  │  classify():            │      │  POST /api/generate        │    │
│  │  → quran                │      │  model: qwen2.5:7b         │    │
│  │  → hadits               │      │  stream: true              │    │
│  │  → doa                  │      │  temperature: 0.3          │    │
│  │                         │      │         ↓                  │    │
│  │  [quran]                │      │  NDJSON token stream       │    │
│  │  Quran DB fuzzy match   │      │  {"response":"Lasst"}      │    │
│  │  confidence ≥ 80%?      │      │  {"response":" uns"}       │    │
│  │  → YES: terjemahan DE   │      │  {"response":" Allah"}     │    │
│  │  → NO: label saja       │      │  {"done":true}             │    │
│  │                         │      │                            │    │
│  │  [hadits/doa]           │      │  Fallback: TIDAK ADA       │    │
│  │  → label saja           │      │  (Ollama wajib jalan)      │    │
│  │  (tidak diterjemahkan)  │      │                            │    │
│  └────────────┬────────────┘      └──────────────┬─────────────┘    │
│               │                                  │                   │
│               └─────────────────┬────────────────┘                   │
│                                 ▼                                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  MODULE 4: WEBSOCKET BROADCASTER                             │   │
│  │                                                              │   │
│  │  Arabic result  → send once { type: "arabic", ... }        │   │
│  │  Ollama token   → send per token { type: "token", ... }    │   │
│  │  Status update  → send { type: "status", ... }             │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                            │ WebSocket JSON
                            ▼
              ┌─────────────────────────┐
              │   TV BROWSER DISPLAY    │
              │   Teks DE muncul        │
              │   kata per kata         │
              │   (teleprompter style)  │
              └─────────────────────────┘
```

---

## 3. Faster-Whisper: Konfigurasi Detail

### Pemilihan Model

| Model        | Disk      | RAM     | WER Indonesia | Latency (CPU) | Rekomendasi                 |
| ------------ | --------- | ------- | ------------- | ------------- | --------------------------- |
| `tiny`       | 75MB      | 390MB   | ~15%          | <100ms        | ❌ Terlalu banyak error     |
| `base`       | 145MB     | 500MB   | ~10%          | ~150ms        | ❌ Masih sering salah       |
| `small`      | 461MB     | 1GB     | ~8%           | ~200ms        | ⚠️ Backup jika RAM terbatas |
| **`medium`** | **1.5GB** | **2GB** | **~7%**       | **310–500ms** | **✅ Recommended**          |
| `large-v3`   | 3GB       | 4GB     | ~6%           | 800ms–2s      | ✅ Jika ada GPU             |

**Pilihan default: `medium`** — sweet spot antara akurasi dan kecepatan untuk laptop biasa tanpa GPU.

### Python Sidecar: `whisper_sidecar.py`

```python
import sys
import json
import numpy as np
from faster_whisper import WhisperModel

# Load model sekali saat startup
model = WhisperModel(
    "medium",
    device="cpu",          # ganti "cuda" jika ada NVIDIA GPU
    compute_type="int8",   # int8 = 2x lebih cepat, akurasi sama
)

INITIAL_PROMPT = """
Bismillahirrahmanirrahim. Assalamualaikum warahmatullahi wabarakatuh.
Alhamdulillah, Subhanallah, Allahu Akbar, Masya Allah, Insya Allah,
Rasulullah, Shallallahu alaihi wasallam, Inna lillahi wa inna ilaihi raji'un,
Quran, Hadits, Shalat, Zakat, Puasa, Haji, Taqwa, Iman, Islam,
Surah Al-Fatihah, Al-Baqarah, Al-Ikhlas, An-Nas, Al-Falaq
"""

# Baca request dari stdin (JSON per baris)
for line in sys.stdin:
    request = json.loads(line.strip())
    audio_array = np.array(request["audio"], dtype=np.float32)

    segments, info = model.transcribe(
        audio_array,
        language="id",
        initial_prompt=INITIAL_PROMPT,
        vad_filter=False,       # VAD sudah di browser, tidak perlu dobel
        word_timestamps=False,
        beam_size=5,
    )

    text = " ".join([seg.text for seg in segments]).strip()

    response = {
        "id": request["id"],
        "text": text,
        "language": info.language,
        "language_probability": info.language_probability
    }

    sys.stdout.write(json.dumps(response) + "\n")
    sys.stdout.flush()
```

### Komunikasi Node.js ↔ Python (JSON-RPC via stdio)

```
Node.js                          Python sidecar
   │                                   │
   │  spawn("python whisper_sidecar.py")│
   │──────────────────────────────────>│ (startup, load model ~3–5 detik)
   │                                   │
   │  {"id":"seg-12","audio":[...]}    │
   │──────────────────────────────────>│ (stdin)
   │                                   │ transcribe (~350ms)
   │  {"id":"seg-12","text":"Marilah"} │
   │<──────────────────────────────────│ (stdout)
   │                                   │
```

Model hanya diload **sekali** saat server start — tidak ada overhead loading per request.

---

## 4. Spesifikasi Hardware Minimum

| Komponen    | Minimum                                       | Recommended                           |
| ----------- | --------------------------------------------- | ------------------------------------- |
| **CPU**     | Intel i5 gen 8 / AMD Ryzen 5                  | Intel i7 gen 10+ / Ryzen 7            |
| **RAM**     | 8GB (4GB untuk OS + 2GB Whisper + 2GB Ollama) | 16GB                                  |
| **Disk**    | 10GB free (model Whisper + Ollama)            | 20GB SSD                              |
| **GPU**     | Tidak wajib                                   | NVIDIA GPU ≥4GB VRAM (3x lebih cepat) |
| **OS**      | Windows 10, macOS 12, Ubuntu 20.04            | Ubuntu 22.04 LTS                      |
| **Python**  | 3.9+                                          | 3.11                                  |
| **Node.js** | 18 LTS                                        | 20 LTS                                |

### Estimasi Latency Berdasarkan Hardware

```
Laptop biasa (i5, tanpa GPU):
  VAD trigger       =    0ms
  Audio kirim WS    =   10ms
  Faster-Whisper    =  400ms  ← model medium, int8
  Arabic Detector   =    1ms
  Ollama first token=   80ms  ← qwen2.5:7b, CPU
  ──────────────────────────
  Penonton baca     =  491ms ✅

Laptop gaming (i7 + NVIDIA GPU):
  Faster-Whisper    =  150ms  ← CUDA acceleration
  Ollama first token=   30ms  ← GPU inference
  ──────────────────────────
  Penonton baca     =  191ms ✅✅
```

---

## 5. VAD: Konfigurasi untuk Kondisi Masjid

### Library: `@ricky0123/vad-web` (Silero VAD, WebAssembly)

```javascript
const vad = await MicVAD.new({
    // Threshold probabilitas — lebih tinggi = filter lebih ketat
    positiveSpeechThreshold: 0.85, // default 0.50 — dinaikkan untuk noise masjid
    negativeSpeechThreshold: 0.35,

    // 1 frame = 30ms. 20 frame = 600ms hening = kalimat selesai
    redemptionFrames: 20,

    // Filter batuk/dehem (< 150ms bukan kalimat valid)
    minSpeechFrames: 5,

    // Padding audio sebelum speech dimulai
    preSpeechPadFrames: 5,

    onSpeechStart: () => {
        showStatus('🎙 Mendengarkan...');
    },

    onSpeechEnd: (audioFloat32) => {
        sendAudioToServer(audioFloat32);
        showStatus('⏳ Memproses...');
    },
});
```

### Panduan Threshold per Kondisi Masjid

| Kondisi                | `positiveSpeechThreshold` | `redemptionFrames` | Keterangan             |
| ---------------------- | ------------------------- | ------------------ | ---------------------- |
| Ruangan kecil, tenang  | 0.70                      | 15 (450ms)         | Threshold rendah cukup |
| Sedang, ada AC         | 0.80                      | 18 (540ms)         | Filter hum AC          |
| Besar, ada gema        | 0.85                      | 22 (660ms)         | Recommended default    |
| Outdoor / banyak noise | 0.90                      | 25 (750ms)         | Threshold tinggi       |

**Tambahkan slider threshold di UI admin** agar bisa di-adjust real-time tanpa restart.

---

## 6. Ollama Streaming: Konfigurasi Detail

### System Prompt

```
Kamu adalah penerjemah resmi khutbah Jumat dari Bahasa Indonesia ke Bahasa Jerman.

Aturan wajib:
1. Gunakan Bahasa Jerman formal (Hochdeutsch)
2. Pertahankan istilah Islam dalam bahasa Arab tanpa terjemahan:
   Allah, Rasulullah, Iman, Islam, Quran, Shalat, Zakat, Haji, Taqwa,
   Subhanallah, Alhamdulillah, Allahu Akbar, Insya Allah, Masya Allah
3. Kalimat harus pendek dan mudah dibaca dari jarak 3–5 meter di layar TV
4. JANGAN tambahkan penjelasan, catatan kaki, atau komentar apapun
5. Kembalikan HANYA teks terjemahan Jerman, tidak ada yang lain

Contoh:
Input:  "Marilah kita bertakwa kepada Allah Subhanahu wa Ta'ala"
Output: "Lasst uns Allah, dem Erhabenen, gehorchen"
```

### Parameter Ollama

```javascript
{
  model: "qwen2.5:7b",
  stream: true,
  options: {
    temperature: 0.3,    // rendah = konsisten, tidak kreatif
    num_predict: 200,    // batas maksimal token output
    top_p: 0.9,
    repeat_penalty: 1.1
  }
}
```

### Challenge & Solusinya

| Challenge                                 | Solusi                                             |
| ----------------------------------------- | -------------------------------------------------- |
| Token pertama kadang tidak tepat          | Buffer 3 token sebelum mulai tampil di TV          |
| Kalimat baru masuk sebelum stream selesai | `AbortController` — cancel stream lama, mulai baru |
| Ollama tidak merespons > 500ms            | Timeout handler + pesan error di TV                |
| Teks bertambah menggeser layout TV        | Fixed-height container, teks lama fade out         |

---

## 7. WebSocket Message Protocol v3.0

### Server → TV Client

```jsonc
// Streaming translation — satu token Ollama per message
{
  "type": "translation_token",
  "token": "Lasst",
  "done": false,
  "segment": 12
}

// Translation selesai
{
  "type": "translation_done",
  "text_id": "Marilah kita bertakwa kepada Allah",
  "text_de": "Lasst uns Allah gehorchen",
  "latency_stt_ms": 380,
  "latency_translate_ms": 210,
  "segment": 12
}

// Konten Arab — Quran dengan terjemahan
{
  "type": "arabic",
  "category": "quran",
  "text_ar": "قُلْ هُوَ اللَّهُ أَحَدٌ",
  "translation_de": "Sag: Er ist Allah, ein Einziger",
  "surah": "Al-Ikhlas",
  "ayah": "112:1",
  "confidence": 0.94,
  "segment": 13
}

// Konten Arab — tidak diterjemahkan
{
  "type": "arabic",
  "category": "hadits",
  "label_de": "[Hadith — Arabisch]",
  "segment": 14
}

// Status server
{
  "type": "status",
  "whisper": "ready",    // ready | loading | busy
  "ollama": "ready",     // ready | busy | error
  "segment_count": 14
}

// Error
{
  "type": "error",
  "code": "WHISPER_TIMEOUT" | "OLLAMA_DOWN" | "AUDIO_TOO_SHORT",
  "message": "...",
  "segment": 15
}
```

### TV Client → Server

```jsonc
// Control
{ "type": "start", "config": { "vadThreshold": 0.85 } }
{ "type": "stop" }
{ "type": "ping" }

// [Binary WebSocket frame] — Float32Array audio dari VAD
// Kalimat dijamin utuh karena dikirim setelah VAD silence
```

---

## 8. Struktur File Project v3.0

```
khutbah-translator/
│
├── server.js                      ← Entry point, WebSocket handler
├── package.json
├── .env                           ← OLLAMA_MODEL, WHISPER_MODEL
│
├── modules/
│   ├── whisperBridge.js           ← Spawn + komunikasi Python sidecar
│   ├── arabicDetector.js          ← 3-layer detection (<1ms)
│   ├── arabicClassifier.js        ← quran / hadits / doa
│   ├── quranDB.js                 ← Fuzzy match + terjemahan DE resmi
│   └── translator.js              ← Ollama streaming (tidak ada fallback)
│
├── python/
│   ├── whisper_sidecar.py         ← Faster-Whisper, JSON-RPC via stdio
│   └── requirements.txt           ← faster-whisper, numpy
│
├── data/
│   └── quran.json                 ← DB offline ~15MB
│
├── scripts/
│   └── setup.sh                   ← Install Python deps + download model
│
├── recordings/                    ← Audio sesi tersimpan (opsional)
│
└── public/
    └── index.html                 ← VAD + streaming UI untuk TV
```

---

## 9. Setup & Installation

### `scripts/setup.sh`

```bash
#!/bin/bash
echo "=== Khutbah Translator Setup ==="

# 1. Install Python dependencies
pip install faster-whisper numpy

# 2. Download Whisper model (hanya sekali, ~1.5GB)
python -c "
from faster_whisper import WhisperModel
print('Downloading whisper medium model...')
model = WhisperModel('medium', device='cpu', compute_type='int8')
print('Model ready!')
"

# 3. Install Node dependencies
npm install

# 4. Download Quran DB
node scripts/downloadQuranDB.js

echo "=== Setup selesai! Jalankan: npm start ==="
```

### `.env`

```
OLLAMA_MODEL=qwen2.5:7b
WHISPER_MODEL=medium
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
PORT=3000
```

---

## 10. Estimasi Latency v3.0 (End-to-End)

```
t=0ms      Khatib selesai kalimat, VAD deteksi silence (600ms threshold)
t=0ms      Browser kirim Float32Array via WebSocket
t=10ms     Server (Node.js) terima audio
t=10ms     Kirim ke Python sidecar via stdin
t=410ms    Faster-Whisper selesai → teks Indonesia
t=411ms    Arabic Detector berjalan (<1ms)
t=411ms    Kirim ke Ollama streaming
t=461ms    Token PERTAMA dari Ollama ← penonton mulai baca di TV ✅
t=660ms    Terjemahan 100% selesai di layar TV

Latency total yang dirasakan penonton: ~461ms
(dari khatib selesai kalimat sampai penonton mulai baca)
```

---

## 11. Keputusan Arsitektur Final v3.0

| Keputusan            | Pilihan                     | Alasan                                          |
| -------------------- | --------------------------- | ----------------------------------------------- |
| Audio segmentation   | VAD Silero (browser)        | Kalimat selalu utuh, tidak perlu timer          |
| STT                  | Faster-Whisper medium lokal | Gratis, offline, privat, latency <500ms         |
| Translation          | Ollama qwen2.5:7b streaming | Lokal, token per token, first token ~50ms       |
| Fallback translation | Tidak ada                   | Sistem 100% offline, tidak perlu fallback cloud |
| Quran                | DB lokal offline            | Akurasi 100%, terjemahan resmi Jerman           |
| Hadits & Doa         | Label saja                  | Keamanan teologis                               |
| Arabic detection     | 3-layer lokal               | <1ms, tanpa API                                 |
| Node ↔ Python        | JSON-RPC stdio              | Simple, reliable, tanpa HTTP overhead           |
| Internet requirement | **Tidak perlu**             | Robust untuk kondisi masjid                     |
| Biaya                | **$0.00/bulan**             | Sepenuhnya gratis                               |

---

## 12. Roadmap Implementasi v3.0

| Fase  | Yang Dibangun                                         | Estimasi    | Dependency       |
| ----- | ----------------------------------------------------- | ----------- | ---------------- |
| **0** | `scripts/setup.sh` + test Faster-Whisper standalone   | 0.5 hari    | Python 3.9+      |
| **1** | `whisperBridge.js` — Node ↔ Python JSON-RPC           | 1 hari      | Fase 0           |
| **2** | `arabicDetector.js` + `arabicClassifier.js`           | 1 hari      | —                |
| **3** | `translator.js` — Ollama streaming                    | 1 hari      | Ollama installed |
| **4** | `quranDB.js` + `downloadQuranDB.js`                   | 1.5 hari    | —                |
| **5** | `server.js` — integrasi semua modul                   | 1 hari      | Fase 1–4         |
| **6** | `public/index.html` — VAD + streaming teleprompter UI | 2 hari      | Fase 5           |
| **7** | Testing end-to-end + VAD threshold tuning             | 1 hari      | Fase 1–6         |
|       | **Total**                                             | **~9 hari** |                  |

---

## 13. Clean Architecture & Class Separation

Kita akan mengadopsi pola pemisahan fungsi seperti project tutorial yang kamu suka, tetapi disesuaikan untuk kebutuhan khutbah. Tujuannya adalah: setiap class punya satu tanggung jawab, mudah dites, mudah diganti, dan mudah di-scale.

### Prinsip Desain

- Single Responsibility: satu class satu tugas.
- Dependency Injection: modul inti tidak membuat dependency sendiri jika bisa disuntik dari luar.
- Interface kecil dan jelas: method sedikit, nama eksplisit.
- Async boundary jelas: audio, STT, translate, dan broadcast dipisah di batas async masing-masing.
- Stateless bila mungkin: state hanya disimpan di session manager.

### Struktur Kelas yang Disarankan

```text
AppBootstrap
├── ConfigLoader
├── WebSocketGateway
├── SessionManager
├── AudioSegmentRouter
├── WhisperBridge
├── ArabicDetector
├── ArabicClassifier
├── QuranRepository
└── TranslationService
    ├── OllamaClient
    └── TokenStreamBroadcaster
```

### Tanggung Jawab Tiap Class

| Class                    | Tugas                                    | Catatan                               |
| ------------------------ | ---------------------------------------- | ------------------------------------- |
| `ConfigLoader`           | Baca env, validasi config                | Tidak boleh punya logic bisnis        |
| `WebSocketGateway`       | Handle koneksi client TV/browser         | Hanya transport layer                 |
| `SessionManager`         | Simpan state per sesi khutbah            | Segment counter, status, buffer       |
| `AudioSegmentRouter`     | Terima audio dari VAD lalu route ke STT  | Tidak tahu detail STT/translate       |
| `WhisperBridge`          | Komunikasi Node ↔ Python sidecar         | Semua detail Faster-Whisper di sini   |
| `ArabicDetector`         | Deteksi apakah teks Arab                 | Pure function / cepat                 |
| `ArabicClassifier`       | Klasifikasi quran/hadits/doa             | Menggunakan heuristik + confidence    |
| `QuranRepository`        | Fuzzy lookup terjemahan Quran            | Hanya baca data lokal                 |
| `TranslationService`     | Orkestrasi terjemahan Indonesia → Jerman | Memanggil Ollama streaming            |
| `OllamaClient`           | HTTP client ke Ollama                    | Tidak tahu WebSocket TV               |
| `TokenStreamBroadcaster` | Kirim token ke seluruh client            | Hanya broadcast, tidak transform data |

### Contoh Alur Eksekusi

```text
VAD end-of-speech
  -> AudioSegmentRouter
  -> WhisperBridge.transcribe()
  -> ArabicDetector.detect()
  -> if Arabic: ArabicClassifier.classify()
  -> if Quran: QuranRepository.lookup()
  -> else: TranslationService.translateStream()
  -> TokenStreamBroadcaster.broadcast()
```

### Aturan Refactor

- `server.js` harus tetap tipis, hanya bootstrap dan wiring.
- Logic STT tidak boleh bercampur dengan logic translate.
- Logic Quran lookup tidak boleh bercampur dengan WebSocket.
- Session state harus ada di satu tempat saja.
- Semua output yang ke client harus melalui broadcaster.

---

## 14. Penyesuaian untuk Mini PC

Mini PC yang kamu pilih sangat kuat untuk stack ini, jadi kita bisa mendesain sistem tanpa kompromi besar. Dengan CPU Ryzen 7 kelas 8 core / 16 thread dan RAM 32GB, bottleneck utama bukan hardware, tetapi disiplin arsitektur dan pemrosesan async.

### Prinsip Optimasi untuk Mini PC

- Gunakan `faster-whisper medium` sebagai default.
- Jalankan `Ollama qwen2.5:7b` di CPU dahulu, baru naikkan model jika performa cukup.
- Hindari model yang terlalu besar di tahap awal.
- Batasi jumlah client TV aktif agar broadcast tetap stabil.
- Jangan jalankan proses latar belakang yang tidak perlu.

### Rekomendasi Operating Mode

| Mode             | Kondisi                       | Saran                                      |
| ---------------- | ----------------------------- | ------------------------------------------ |
| CPU-only stable  | Ingin setup simpel dan stabil | Paling direkomendasikan                    |
| Hybrid optimized | Mau performa lebih tinggi     | CPU untuk STT, GPU bila tersedia untuk LLM |
| Experimental     | Ingin tuning maksimum         | Gunakan bila sudah stabil di CPU-only      |

### Estimasi Resource Saat Semua Jalan

| Komponen                     | RAM kira-kira  | CPU load             |
| ---------------------------- | -------------- | -------------------- |
| Browser VAD                  | 100–200MB      | Rendah               |
| Node.js server               | 200–400MB      | Rendah–sedang        |
| Python Faster-Whisper medium | 1.5–2.5GB      | Sedang               |
| Ollama qwen2.5:7b            | 5–8GB          | Sedang–tinggi        |
| Quran DB                     | <100MB         | Sangat rendah        |
| Total aman                   | sekitar 8–12GB | Masih nyaman di 32GB |

### Saran Praktis

Untuk fase awal, kita fokus pada stabilitas dulu, bukan model terbesar. Mini PC kamu cukup kuat untuk produksi awal, jadi kita bisa desain codebase yang bersih dan scalable tanpa khawatir kehabisan resource.

---

## 15. Target Skala Jangka Panjang

Arsitektur ini disiapkan supaya nanti mudah berkembang ke beberapa arah: multi-masjid, multi-display, log session, admin dashboard, dan opsi model LLM yang bisa diganti. Karena tiap service dipisah jelas, kita bisa melakukan scaling tanpa mengubah semua bagian sekaligus.

- `WhisperBridge` bisa diganti ke GPU mode tanpa ubah layer lain.
- `TranslationService` bisa diganti ke model yang lebih cepat atau lebih akurat.
- `WebSocketGateway` bisa ditingkatkan untuk multi-room atau multi-screen.
- `SessionManager` bisa ditambah logging dan audit trail.

## 16. Big Picture — Technical Documentation Structure

Dokumen ini adalah **big picture technical documentation** untuk arsitektur sistem khutbah live translator. Fokusnya adalah:

- gambaran besar alur data,
- struktur dan tanggung jawab tiap modul/class,
- hubungan antar komponen,
- penyesuaian untuk hardware,
- dan target skala jangka panjang.

Detail implementasi (isi kode, percakapan Wi‑Socket, dll) **tidak** ditulis penuh di sini, dan akan diimplementasi saat coding fase.

---

### 1. Alu

**Quran DB Source (UPDATED — HuggingFace):**

- **Source**: HuggingFace `quran_multilingual_parallel`
- **Format**: CSV → convert ke JSON
- **German translation**: ✅ **Langsung ada (official)**
- **Indonesian translation**: ✅ Ada
- **Total bahasa**: 54+ (multilingual)
- **Size**: ~2MB

**Download URL:**

```
https://huggingface.co/datasets/freococo/quran_multilingual_parallel/resolve/main/quran.csv
```

**Convert script**: `scripts/downloadQuranDB.js` (CSV → JSON, tanpa translate manual)r Data Utama (High Level)

```text
VAD (browser)
  → audio segment (kalimat utuh) via WebSocket
  → WhisperBridge (Faster-Whisper lokal)
  → teks Indonesia + Arab
  → ArabicDetector → ArabicClassifier
  → if Quran: QuranRepository.lookup()
  → else: TranslationService.translateStream()
  → TokenStreamBroadcaster
  → TV client (teleprompter streaming teks Jerman)
```

Jika ada Arab & mismatch Quran DB, hasil akhir berupa label saja, tidak diterjemahkan.

---

### 2. Struktur Layer & Gateway

```text
+-------------------+
|  Client Browser   |  ← VAD, audio capture, streaming UI
+-------------------+
        WebSocket
+-------------------+
|  WebSocketGateway |  ← koneksi, room, broadcast
+-------------------+
        ↓
+-------------------+
|  SessionManager   |  ← state sesi, segment counter, buffer
+-------------------+
        ↓
+-------------------+
| AudioSegmentRouter|  ← route audio ke STT
+-------------------+
        ↓
+-------------------+
|   WhisperBridge   |  ← faster-whisper via Python sidecar
+-------------------+
        ↓
+-------------------+
|  ArabicDetector   |  ← deteksi Arab (3 layer)
+-------------------+
        ↓
+-------------------+
| ArabicClassifier  |  ← quran / hadits / doa
+-------------------+
     ↓         ↓
QuranRepo   TranslationService
     ↓         ↓
ilar DB   OllamaClient + TokenStreamBroadcaster
```

---

### 3. Prinsip Clean Architecture

- **Single Responsibility**: tiap class 1 tugas.
- **Interface kecil**: method sedikit, nama eksplisit.
- **Dependency Injection**: jangan buat dependency di dalam class.
- **Stateless bila mungkin**: state di SessionManager.
- **Async boundary jelas**: audio → STT → translate → broadcast terpisah jelas.

`server.js` hanya untuk:

- load config,
- wiring modul,
- men-start server & WebSocket.

---

### 4. Adaptasi untuk Mini PC

- STT: `medium` sebagai default.
- LLM: `qwen2.5:7b` di CPU.
- Mode: CPU-only stable dulu.
- Fokus: stabilitas dan kualitas kode, bukan hanya performa maksimum.

---

### 5. Target Skala Jangka Panjang

Arsitektur ini sudah siap untuk:

- ganti Whisper model (CPU → GPU).
- ganti model LLM (lebih cepat/akurat).
- multi-room / multi-screen.
- logging session & audit trail.
