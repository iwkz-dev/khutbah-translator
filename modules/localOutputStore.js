const fs = require('fs');
const path = require('path');

class LocalOutputStore {
  /**
   * @param {object} [options]
   * @param {string} [options.outputDir]
   */
  constructor(options = {}) {
    this.outputDir = options.outputDir || path.join(process.cwd(), 'outputs');
  }

  /**
   * Append one JSON line to today's session file.
   * @param {object} payload
   * @returns {{ saved: boolean, filePath: string }}
   */
  append(payload) {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const sessionDate = new Date().toISOString().slice(0, 10);
    const filePath = path.join(this.outputDir, `session-${sessionDate}.jsonl`);
    const record = {
      timestamp: new Date().toISOString(),
      ...payload,
    };

    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
    return { saved: true, filePath };
  }
}

module.exports = {
  LocalOutputStore,
};
