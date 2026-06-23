#!/usr/bin/env python3
"""
Whisper STT Sidecar - Khutbah Translator.
Komunikasi via stdin/stdout JSON-RPC dengan Node.js server.

Usage:
  python whisper_sidecar.py                         # sidecar mode
  python whisper_sidecar.py --test --dummy         # test mode dengan dummy audio
  python whisper_sidecar.py --test --audio file    # test mode dengan file wav

Environment Variables:
  WHISPER_MODEL        : whisper model size (default: medium)
  WHISPER_DEVICE       : cpu atau cuda (default: cpu)
  WHISPER_COMPUTE_TYPE : int8, float16, float32 (default: int8)
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import signal
import sys
import time
import wave
from dataclasses import dataclass
from typing import Any

import numpy as np
from faster_whisper import WhisperModel


LOGGER = logging.getLogger("whisper_sidecar")
SAMPLE_RATE = 16000
MIN_AUDIO_SAMPLES = 1600
INITIAL_PROMPT = (
    "Bismillahirrahmanirrahim. Assalamualaikum warahmatullahi wabarakatuh. "
    "Alhamdulillah, Subhanallah, Allahu Akbar, Masya Allah, Insya Allah, "
    "Rasulullah, Shallallahu alaihi wasallam, Inna lillahi wa inna ilaihi raji'un, "
    "Quran, Hadits, Shalat, Zakat, Puasa, Haji, Taqwa, Iman, Islam, "
    "Surah Al-Fatihah, Al-Baqarah, Al-Ikhlas, An-Nas, Al-Falaq, Al-Baqarah, "
    "Astaghfirullah, Subhanallahi wabihamdihi, La ilaha illallah"
)


@dataclass
class TranscriptionResult:
    """Structured transcription output."""

    text: str
    language: str
    language_probability: float
    duration_ms: int


class WhisperTranscriber:
    """Loads and runs Faster-Whisper transcription."""

    def __init__(self, model_name: str, device: str, compute_type: str) -> None:
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type
        self.model: WhisperModel | None = None

    def load_model(self) -> float:
        """Load the Whisper model and return load duration in seconds."""
        started_at = time.perf_counter()
        LOGGER.info(
            "Loading Whisper model name=%s device=%s compute_type=%s",
            self.model_name,
            self.device,
            self.compute_type,
        )
        self.model = WhisperModel(
            self.model_name,
            device=self.device,
            compute_type=self.compute_type,
        )
        elapsed = time.perf_counter() - started_at
        LOGGER.info("Whisper model loaded in %.2fs", elapsed)
        return elapsed

    def transcribe(self, audio: np.ndarray) -> TranscriptionResult:
        """Transcribe a mono 16kHz float32 PCM audio buffer."""
        if self.model is None:
            raise RuntimeError("model is not loaded")

        if audio.size < MIN_AUDIO_SAMPLES:
            raise ValueError("audio too short")

        audio_array = np.asarray(audio, dtype=np.float32)
        started_at = time.perf_counter()
        segments, info = self.model.transcribe(
            audio_array,
            language="id",
            initial_prompt=INITIAL_PROMPT,
            vad_filter=False,
            word_timestamps=False,
            beam_size=5,
            best_of=3,
            temperature=(0.0, 0.2, 0.4),
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        duration_ms = int((time.perf_counter() - started_at) * 1000)

        return TranscriptionResult(
            text=text,
            language=(info.language or "id"),
            language_probability=float(info.language_probability or 0.0),
            duration_ms=duration_ms,
        )


class SidecarRunner:
    """Handles stdin/stdout JSON-RPC loop for the sidecar process."""

    def __init__(self, transcriber: WhisperTranscriber) -> None:
        self.transcriber = transcriber
        self._running = True

    def run(self) -> None:
        """Start the persistent sidecar loop."""
        self._install_signal_handlers()
        self.transcriber.load_model()
        self._write_stdout_json({"status": "ready"})

        for raw_line in sys.stdin:
            if not self._running:
                break

            line = raw_line.strip()
            if not line:
                continue

            response = self._process_request(line)
            self._write_stdout_json(response)

        self._shutdown()

    def _process_request(self, line: str) -> dict[str, Any]:
        """Process one JSON-RPC request line and return a response object."""
        request_id = "unknown"

        try:
            payload = json.loads(line)
            if not isinstance(payload, dict):
                raise ValueError("request must be a JSON object")

            request_id = str(payload.get("id", "unknown"))
            audio_payload = payload.get("audio")
            if audio_payload is None:
                raise ValueError("missing 'audio' field")
            if not isinstance(audio_payload, list):
                raise ValueError("'audio' must be a JSON array")
            if len(audio_payload) == 0:
                raise ValueError("audio is empty")

            audio = np.asarray(audio_payload, dtype=np.float32)
            result = self.transcriber.transcribe(audio)
            return {
                "id": request_id,
                "text": result.text,
                "language": result.language,
                "language_probability": result.language_probability,
                "duration_ms": result.duration_ms,
            }
        except json.JSONDecodeError as exc:
            LOGGER.warning("Invalid JSON input: %s", exc)
            return {"id": request_id, "error": f"invalid json: {exc.msg}"}
        except Exception as exc:  # noqa: BLE001
            LOGGER.exception("Transcription request failed")
            return {"id": request_id, "error": f"transcription failed: {exc}"}

    def _install_signal_handlers(self) -> None:
        """Install SIGINT/SIGTERM handlers for graceful shutdown."""

        def handler(signum: int, _frame: Any) -> None:
            signal_name = signal.Signals(signum).name
            LOGGER.info("Received %s, shutting down", signal_name)
            self._running = False

        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, handler)

    def _shutdown(self) -> None:
        """Clean shutdown hook."""
        self._running = False
        LOGGER.info("Sidecar stopped")

    @staticmethod
    def _write_stdout_json(payload: dict[str, Any]) -> None:
        """Write one JSON object to stdout as a single line."""
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def configure_logging() -> None:
    """Configure stderr logging."""
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(description="Whisper STT sidecar")
    parser.add_argument("--test", action="store_true", help="run in console test mode")
    parser.add_argument("--audio", type=str, help="path to wav audio file for test mode")
    parser.add_argument("--dummy", action="store_true", help="generate dummy sine-wave audio")
    return parser.parse_args()


def read_wav_audio(path: str) -> np.ndarray:
    """Read a WAV file and return mono float32 PCM audio at 16kHz."""
    with wave.open(path, "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        frame_count = wav_file.getnframes()
        raw_frames = wav_file.readframes(frame_count)

    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"unsupported sample rate: {sample_rate} (expected {SAMPLE_RATE})")
    if channels != 1:
        raise ValueError(f"unsupported channel count: {channels} (expected mono)")
    if sample_width != 2:
        raise ValueError("unsupported WAV sample width; expected 16-bit PCM")

    audio_int16 = np.frombuffer(raw_frames, dtype=np.int16)
    return (audio_int16.astype(np.float32) / 32768.0).copy()


def generate_dummy_audio(duration_seconds: float = 3.0) -> np.ndarray:
    """Generate a 440Hz sine wave for setup verification."""
    total_samples = int(SAMPLE_RATE * duration_seconds)
    timeline = np.arange(total_samples, dtype=np.float32) / SAMPLE_RATE
    sine_wave = 0.2 * np.sin(2.0 * math.pi * 440.0 * timeline)
    return sine_wave.astype(np.float32)


def print_test_banner(model_name: str, device: str, compute_type: str) -> None:
    """Print test mode header."""
    print("=== Whisper Sidecar Test Mode ===")
    print(f"Model    : {model_name}")
    print(f"Device   : {device}")
    print(f"Compute  : {compute_type}")
    print("")


def run_test_mode(transcriber: WhisperTranscriber, audio: np.ndarray) -> int:
    """Run console test mode and print a human-readable result."""
    print("Loading model...")
    load_seconds = transcriber.load_model()
    print(f"OK Model loaded in {load_seconds:.1f}s")
    print("")
    print("Running transcription...")

    result = transcriber.transcribe(audio)
    audio_len_seconds = audio.size / SAMPLE_RATE
    printable_text = result.text if result.text else "[empty transcription]"

    print(f'OK Result: "{printable_text}"')
    print(f"   Language  : {result.language} (confidence: {result.language_probability:.2f})")
    print(f"   Duration  : {result.duration_ms}ms")
    print(f"   Audio len : {audio_len_seconds:.1f}s")
    print("")
    print("Test completed successfully!")
    return 0


def build_transcriber_from_env() -> WhisperTranscriber:
    """Create a transcriber using environment configuration."""
    return WhisperTranscriber(
        model_name=os.getenv("WHISPER_MODEL", "medium"),
        device=os.getenv("WHISPER_DEVICE", "cpu"),
        compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
    )


def main() -> int:
    """Program entrypoint."""
    configure_logging()
    args = parse_args()
    transcriber = build_transcriber_from_env()

    if args.test:
        if args.audio and args.dummy:
            print("Choose only one of --audio or --dummy", file=sys.stderr)
            return 2
        if not args.audio and not args.dummy:
            print("Test mode requires either --audio or --dummy", file=sys.stderr)
            return 2

        print_test_banner(
            transcriber.model_name,
            transcriber.device,
            transcriber.compute_type,
        )

        try:
            if args.audio:
                audio = read_wav_audio(args.audio)
            else:
                audio = generate_dummy_audio()
            return run_test_mode(transcriber, audio)
        except Exception as exc:  # noqa: BLE001
            LOGGER.exception("Test mode failed")
            print(f"ERROR: {exc}", file=sys.stderr)
            return 1

    try:
        runner = SidecarRunner(transcriber)
        runner.run()
        return 0
    except Exception as exc:  # noqa: BLE001
        LOGGER.exception("Sidecar crashed")
        sys.stdout.write(json.dumps({"status": "error", "error": str(exc)}) + "\n")
        sys.stdout.flush()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
