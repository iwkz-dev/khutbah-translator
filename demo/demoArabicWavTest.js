const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { WhisperBridge } = require('../modules/whisperBridge');
const { ArabicPipeline } = require('../modules/arabicPipeline');

const SAMPLE_RATE = 16000;

function parseArgs(argv) {
  const args = [...argv];
  let audioPath = path.join(process.cwd(), 'tmp', 'test_2min.wav');

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--audio' && args[index + 1]) {
      audioPath = path.resolve(args[index + 1]);
      index += 1;
    }
  }

  return { audioPath };
}

function readWavAudio(filePath) {
  const buffer = fs.readFileSync(filePath);

  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('unsupported WAV file: missing RIFF/WAVE header');
  }

  let offset = 12;
  let fmt = null;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkDataStart),
        channels: buffer.readUInt16LE(chunkDataStart + 2),
        sampleRate: buffer.readUInt32LE(chunkDataStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkDataStart + 14),
      };
    }

    if (chunkId === 'data') {
      dataStart = chunkDataStart;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (!fmt) {
    throw new Error('unsupported WAV file: missing fmt chunk');
  }
  if (dataStart < 0) {
    throw new Error('unsupported WAV file: missing data chunk');
  }
  if (fmt.audioFormat !== 1) {
    throw new Error(`unsupported WAV format: expected PCM, got ${fmt.audioFormat}`);
  }
  if (fmt.channels !== 1) {
    throw new Error(`unsupported channel count: ${fmt.channels} (expected mono)`);
  }
  if (fmt.sampleRate !== SAMPLE_RATE) {
    throw new Error(`unsupported sample rate: ${fmt.sampleRate} (expected ${SAMPLE_RATE})`);
  }
  if (fmt.bitsPerSample !== 16) {
    throw new Error(`unsupported bit depth: ${fmt.bitsPerSample} (expected 16-bit PCM)`);
  }

  const sampleCount = dataSize / 2;
  const audio = new Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = buffer.readInt16LE(dataStart + index * 2);
    audio[index] = sample / 32768;
  }

  return {
    audio,
    sampleRate: fmt.sampleRate,
    durationSeconds: sampleCount / fmt.sampleRate,
  };
}

async function main() {
  const { audioPath } = parseArgs(process.argv.slice(2));

  console.log('=== Arabic Pipeline WAV Test ===');
  console.log(`Audio: ${audioPath}`);
  console.log('');

  const wav = readWavAudio(audioPath);
  const bridge = new WhisperBridge();
  const pipeline = new ArabicPipeline();

  try {
    console.log('Bridge starting...');
    const readyInfo = await bridge.start();
    console.log('OK Python sidecar ready');
    console.log(`Model   : ${readyInfo.model}`);
    console.log(`Device  : ${readyInfo.device}`);
    console.log(`Compute : ${readyInfo.computeType}`);
    console.log(`Audio len: ${wav.durationSeconds.toFixed(1)}s @ ${wav.sampleRate}Hz`);
    console.log('');

    console.log('Transcribing WAV audio...');
    const startedAt = performance.now();
    const bridgeResult = await bridge.transcribe(wav.audio, 'wav-pipeline-1');
    const latencyMs = Math.round(performance.now() - startedAt);

    if (!bridgeResult.ok) {
      console.log(`ERROR: ${bridgeResult.error}`);
      process.exitCode = 1;
      return;
    }

    const pipelineResult = pipeline.process({
      id: bridgeResult.id,
      text: bridgeResult.text,
      languageProbability: bridgeResult.languageProbability,
    });

    console.log(`Source Text: ${bridgeResult.text}`);
    console.log(`Language   : ${bridgeResult.language} (${bridgeResult.languageProbability.toFixed(2)})`);
    console.log(`STT Time   : ${bridgeResult.durationMs}ms`);
    console.log(`Bridge Time: ${latencyMs}ms`);
    console.log('');
    console.log(`Detector   : Arabic ${pipelineResult.detector.isArabic ? 'yes' : 'no'} (${pipelineResult.detector.confidence.toFixed(2)})`);
    console.log(`Category   : ${pipelineResult.category}`);
    console.log(`Found DB   : ${pipelineResult.foundInDb ? 'yes' : 'no'}`);
    console.log(`Display    : ${pipelineResult.displayText}`);
    console.log(`Saved to   : ${pipelineResult.outputFile}`);
    console.log('');
    console.log('Test completed successfully!');
  } finally {
    await bridge.stop();
  }
}

main().catch((error) => {
  console.error('Arabic WAV pipeline test failed');
  console.error(error.message || error);
  process.exit(1);
});

