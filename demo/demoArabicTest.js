const { ArabicPipeline } = require('../modules/arabicPipeline');

async function main() {
  console.log('=== Arabic Pipeline Test ===');
  console.log('');

  const pipeline = new ArabicPipeline();
  const samples = [
    { id: 'seg-1', text: 'Qul huwallahu ahad', languageProbability: 0.94 },
    { id: 'seg-2', text: 'Marilah kita bertakwa kepada Allah', languageProbability: 0.98 },
    { id: 'seg-3', text: 'Allahumma inni as aluka ilman nafi an', languageProbability: 0.81 },
    { id: 'seg-4', text: 'Qala rasulullah shallallahu alaihi wasallam', languageProbability: 0.76 },
  ];

  let lastOutputFile = null;

  for (const sample of samples) {
    const result = pipeline.process(sample);
    lastOutputFile = result.outputFile;

    console.log(`Input: ${sample.text}`);
    console.log(
      `Detector: Arabic ${result.detector.isArabic ? 'yes' : 'no'} (${result.detector.confidence.toFixed(2)})`
    );
    console.log(`Classifier: ${result.category}`);
    console.log(`Quran DB: ${result.foundInDb ? 'found' : 'not found'}`);
    console.log(`Display: ${result.displayText}`);
    console.log(`Saved to: ${result.outputFile}`);
    console.log('');
  }

  if (lastOutputFile) {
    console.log(`Latest output file: ${lastOutputFile}`);
  }
  console.log('Test completed successfully!');
}

main().catch((error) => {
  console.error('Arabic pipeline test failed');
  console.error(error);
  process.exit(1);
});

