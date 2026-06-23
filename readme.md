# Khutbah Translator

Khutbah Translator adalah project live translator khutbah Jumat yang berjalan **fully offline**. Berdasarkan big picture di `docs/khutbah-backend-architecture-v3-offline.md`, alur utamanya adalah:

- browser client melakukan VAD untuk mengambil segmen audio per kalimat
- server Node.js mengirim audio ke Python sidecar Faster-Whisper untuk transkripsi Bahasa Indonesia
- hasil transkripsi diproses lebih lanjut dan diterjemahkan oleh Ollama lokal ke Bahasa Jerman
- hasil akhir ditampilkan ke layar TV secara realtime

## Documentation

- Big picture architecture: `docs/khutbah-backend-architecture-v3-offline.md`
- AI Product Requirements Document: `docs/.agent/`

## Installation

Jalankan dari **normal user PowerShell**, bukan Administrator:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Optional flags:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -SkipOllama
powershell -ExecutionPolicy Bypass -File .\install.ps1 -SkipWhisper
```

## Running

Saat ini bagian yang sudah bisa dites langsung adalah Python Whisper sidecar.

Test mode dengan dummy audio:

```powershell
python python\whisper_sidecar.py --test --dummy
```

Test mode dengan file WAV:

```powershell
python python\whisper_sidecar.py --test --audio path\to\audio.wav
```

Mode sidecar untuk integrasi dengan Node.js nanti:

```powershell
python python\whisper_sidecar.py
```

Jika perlu regenerate Quran DB:

```powershell
node scripts\downloadQuranDB.js
```
