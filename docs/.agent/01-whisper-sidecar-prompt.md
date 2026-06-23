# AI CODING PROMPT — Khutbah Translator: Python STT Module

## Context & Goal

Kamu adalah senior Python developer. Kamu diminta membuat Python script untuk Speech-to-Text (STT) yang akan digunakan sebagai "sidecar process" dalam project Khutbah Live Translator.

Project ini adalah sistem real-time translator khutbah Jumat dari Bahasa Indonesia ke Bahasa Jerman. Pipeline-nya:

```
Browser VAD → [audio segment] → Node.js server → Python STT sidecar → teks → Ollama translate → TV display
```

Tugas kamu HANYA membuat bagian Python STT sidecar. Node.js belum dibuat, frontend belum dibuat.

---

## Spesifikasi Teknis

### Library yang Digunakan
- faster-whisper (sudah terinstall via pip)
- numpy
- Python 3.11+

### Cara Kerja Sidecar

Python process ini berjalan terus-menerus (persistent process). Node.js akan komunikasi via stdin/stdout JSON-RPC.

```
Node.js                          Python sidecar
   │                                   │
   │  spawn("python whisper_sidecar.py")│
   │──────────────────────────────────>│ (startup, load model ~3-5 detik)
   │                                   │ ready: kirim {"status":"ready"} ke stdout
   │  {"id":"seg-1","audio":[...]}     │
   │──────────────────────────────────>│ (stdin, per baris)
   │                                   │ transcribe (~350ms)
   │  {"id":"seg-1","text":"Marilah"}  │
   │<──────────────────────────────────│ (stdout, per baris)
```

### Input Format (dari stdin, per baris, JSON)
```json
{"id": "seg-12", "audio": [0.0012, -0.0034, ...]}
```
- `id`: string unik per segment
- `audio`: Float32Array sebagai JSON array (PCM audio 16kHz mono)

### Output Format (ke stdout, per baris, JSON)
```json
{"id": "seg-12", "text": "Marilah kita bertakwa kepada Allah", "language": "id", "language_probability": 0.98, "duration_ms": 380}
```

### Error Output Format
```json
{"id": "seg-12", "error": "transcription failed: [detail]"}
```

---

## Konfigurasi Whisper

- Model: dibaca dari ENV `WHISPER_MODEL` (default: "medium")
- Device: dibaca dari ENV `WHISPER_DEVICE` (default: "cpu")
- Compute type: dibaca dari ENV `WHISPER_COMPUTE_TYPE` (default: "int8")
- Language: "id" (Indonesia, fixed)

### Initial Prompt (penting untuk akurasi Arab)
```
Bismillahirrahmanirrahim. Assalamualaikum warahmatullahi wabarakatuh.
Alhamdulillah, Subhanallah, Allahu Akbar, Masya Allah, Insya Allah,
Rasulullah, Shallallahu alaihi wasallam, Inna lillahi wa inna ilaihi raji'un,
Quran, Hadits, Shalat, Zakat, Puasa, Haji, Taqwa, Iman, Islam,
Surah Al-Fatihah, Al-Baqarah, Al-Ikhlas, An-Nas, Al-Falaq, Al-Baqarah,
Astaghfirullah, Subhanallahi wabihamdihi, La ilaha illallah
```

### Transcribe Parameters
```python
model.transcribe(
    audio_array,
    language="id",
    initial_prompt=INITIAL_PROMPT,
    vad_filter=False,      # VAD sudah di browser
    word_timestamps=False,
    beam_size=5,
    best_of=3,
    temperature=(0.0, 0.2, 0.4),  # retry jika confidence rendah
)
```

---

## Struktur File yang Harus Dibuat

```
python/
├── whisper_sidecar.py     ← MAIN FILE yang harus dibuat
└── requirements.txt       ← SUDAH ADA, jangan ubah
```

---

## Clean Code Requirements

1. **Class-based**: Buat class `WhisperTranscriber` dengan method yang jelas
2. **Single Responsibility**: Pisahkan loading model, transcribing, dan I/O handling
3. **Error handling**: Semua exception harus di-catch dan return error JSON (jangan crash process)
4. **Logging**: Gunakan Python `logging` ke stderr (BUKAN stdout, karena stdout untuk JSON-RPC)
5. **Graceful shutdown**: Handle SIGINT/SIGTERM dengan bersih
6. **Type hints**: Semua function harus punya type hints
7. **Docstring**: Class dan method utama harus punya docstring singkat

### Contoh Struktur Class

```python
class WhisperTranscriber:
    def __init__(self, model_name: str, device: str, compute_type: str): ...
    def load_model(self) -> None: ...
    def transcribe(self, audio: np.ndarray) -> dict: ...

class SidecarRunner:
    def __init__(self, transcriber: WhisperTranscriber): ...
    def run(self) -> None: ...
    def _process_request(self, line: str) -> str: ...
    def _shutdown(self) -> None: ...
```

---

## Mode Testing (Console Mode)

Script ini HARUS bisa ditest tanpa Node.js. Tambahkan argumen CLI:

```bash
# Mode normal (sidecar - baca dari stdin)
python whisper_sidecar.py

# Mode test dengan file audio
python whisper_sidecar.py --test --audio test_audio.wav

# Mode test dengan generate dummy audio (untuk verify setup)
python whisper_sidecar.py --test --dummy
```

### Test Mode Output (ke console, bukan JSON-RPC)

```
=== Whisper Sidecar Test Mode ===
Model    : medium
Device   : cpu
Compute  : int8

Loading model...
✅ Model loaded in 3.2s

Running transcription...
✅ Result: "Marilah kita bertakwa kepada Allah"
   Language  : id (confidence: 0.98)
   Duration  : 380ms
   Audio len : 2.4s

Test completed successfully!
```

### Dummy Audio Test

Buat function `generate_dummy_audio()` yang generate 3 detik sine wave (440Hz) sebagai audio dummy untuk verify bahwa Whisper bisa load dan run tanpa crash, meskipun hasilnya tidak bermakna.

---

## File Lengkap yang Diharapkan: `python/whisper_sidecar.py`

```python
#!/usr/bin/env python3
"""
Whisper STT Sidecar - Khutbah Translator
Komunikasi via stdin/stdout JSON-RPC dengan Node.js server.

Usage:
  python whisper_sidecar.py              # sidecar mode
  python whisper_sidecar.py --test --dummy    # test mode dengan dummy audio
  python whisper_sidecar.py --test --audio path/to/audio.wav  # test dengan file

Environment Variables:
  WHISPER_MODEL       : whisper model size (default: medium)
  WHISPER_DEVICE      : cpu atau cuda (default: cpu)
  WHISPER_COMPUTE_TYPE: int8, float16, float32 (default: int8)
"""

# ... implementasi lengkap
```

---

## Checklist Output yang Diharapkan

Pastikan script yang kamu buat:

- [ ] Bisa dijalankan: `python whisper_sidecar.py --test --dummy` tanpa error
- [ ] Load model dari ENV variable
- [ ] Baca stdin per baris (JSON), proses, tulis stdout per baris (JSON)
- [ ] Logging ke stderr (bukan stdout)
- [ ] Startup signal: kirim `{"status":"ready"}` ke stdout setelah model loaded
- [ ] Handle input JSON invalid → return error JSON (tidak crash)
- [ ] Handle audio kosong / terlalu pendek → return error JSON
- [ ] Handle SIGINT / SIGTERM dengan graceful shutdown
- [ ] Test mode dengan --dummy bisa jalan tanpa audio file

---

## Yang TIDAK Perlu Dibuat

- ❌ WebSocket
- ❌ HTTP server
- ❌ Frontend / HTML
- ❌ Node.js code
- ❌ Ollama / translation
- ❌ Arabic detection

Fokus HANYA pada whisper_sidecar.py yang bisa jalan standalone dan bisa di-test via console.

---

## Final Note

Setelah selesai, developer akan test dengan command:
```bash
python python/whisper_sidecar.py --test --dummy
```

Output yang diharapkan adalah model berhasil load dan dummy audio berhasil diproses tanpa error. Hasilnya tidak perlu benar (karena dummy audio), yang penting tidak ada exception.
