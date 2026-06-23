const { performance } = require('perf_hooks');
const { WhisperBridge } = require('./whisperBridge');

function generateDummyAudio(durationSeconds = 3, sampleRate = 16000) {
  const totalSamples = Math.floor(durationSeconds * sampleRate);
  const audio = new Array(totalSamples);

  for (let index = 0; index < totalSamples; index += 1) {
    const time = index / sampleRate;
    audio[index] = 0.2 * Math.sin(2 * Math.PI * 440 * time);
  }

  return audio;
}

async function main() {
  console.log('=== Whisper Bridge Test ===');
  console.log('Bridge starting...');

  const bridge = new WhisperBridge();

  try {
    const readyInfo = await bridge.start();
    console.log('OK Python sidecar ready');
    console.log(`Model   : ${readyInfo.model}`);
    console.log(`Device  : ${readyInfo.device}`);
    console.log(`Compute : ${readyInfo.computeType}`);
    console.log('');

    console.log('Sending test audio...');
    const startedAt = performance.now();
    const result = await bridge.transcribe(generateDummyAudio(), 'demo-seg-1');
    const latencyMs = Math.round(performance.now() - startedAt);

    if (!result.ok) {
      console.log(`ERROR: ${result.error}`);
      process.exitCode = 1;
      return;
    }

    console.log(`OK Result: "${result.text}"`);
    console.log(`Language: ${result.language} (${result.languageProbability.toFixed(2)})`);
    console.log(`Duration: ${result.durationMs}ms`);
    console.log(`Bridge latency: ${latencyMs}ms`);
    console.log('');
    console.log('Test completed successfully!');
  } finally {
    await bridge.stop();
  }
}

main().catch((error) => {
  console.error('Bridge test failed');
  console.error(error);
  process.exit(1);
});
