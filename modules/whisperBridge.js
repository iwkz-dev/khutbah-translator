const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

function createDeferred() {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

class WhisperBridge {
  /**
   * @param {object} [options]
   * @param {string} [options.pythonCommand]
   * @param {string} [options.sidecarPath]
   */
  constructor(options = {}) {
    this.pythonCommand = options.pythonCommand || process.env.PYTHON_EXECUTABLE || 'python';
    this.sidecarPath =
      options.sidecarPath ||
      process.env.WHISPER_SIDECAR_PATH ||
      path.join(process.cwd(), 'python', 'whisper_sidecar.py');

    this.process = null;
    this.readline = null;
    this.ready = false;
    this.readyInfo = null;
    this.started = false;
    this.stopped = false;
    this.queue = [];
    this.inFlight = null;
    this.requestCounter = 0;
    this.startDeferred = null;
  }

  /**
   * Start the Python sidecar and wait until it reports ready.
   * @returns {Promise<object>}
   */
  async start() {
    if (this.ready && this.process) {
      return this.readyInfo;
    }

    if (this.startDeferred) {
      return this.startDeferred.promise;
    }

    this.startDeferred = createDeferred();
    this.stopped = false;

    this.process = spawn(this.pythonCommand, [this.sidecarPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.started = true;
    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');

    this.readline = readline.createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });

    this.readline.on('line', (line) => {
      this._handleStdoutLine(line);
    });

    this.process.stderr.on('data', (chunk) => {
      const message = String(chunk).trim();
      if (message) {
        console.error(`[whisper-sidecar] ${message}`);
      }
    });

    this.process.on('error', (error) => {
      this._handleProcessFailure(error);
    });

    this.process.on('exit', (code, signal) => {
      this._handleProcessFailure(
        new Error(`Python sidecar exited unexpectedly (code=${code}, signal=${signal})`)
      );
    });

    return this.startDeferred.promise;
  }

  /**
   * Stop the Python sidecar.
   * @returns {Promise<void>}
   */
  async stop() {
    this.stopped = true;
    this.ready = false;

    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    if (!this.process) {
      return;
    }

    const proc = this.process;
    this.process = null;

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
        resolve();
      }, 3000);

      proc.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      proc.kill('SIGTERM');
    });
  }

  /**
   * Send one transcription request to the sidecar.
   * @param {number[]|Float32Array} audio
   * @param {string} [requestId]
   * @returns {Promise<object>}
   */
  async transcribe(audio, requestId) {
    if (!this.ready) {
      throw new Error('WhisperBridge is not ready');
    }

    const normalizedAudio = this._normalizeAudio(audio);
    const id = requestId || `seg-${++this.requestCounter}`;

    const deferred = createDeferred();
    this.queue.push({
      id,
      audio: normalizedAudio,
      deferred,
    });

    this._pumpQueue();
    return deferred.promise;
  }

  _normalizeAudio(audio) {
    if (!audio) {
      throw new Error('audio is required');
    }

    if (!Array.isArray(audio) && !(audio instanceof Float32Array)) {
      throw new Error('audio must be an array of numbers or Float32Array');
    }

    const array = Array.from(audio);
    if (array.length === 0) {
      throw new Error('audio must not be empty');
    }

    for (const sample of array) {
      if (typeof sample !== 'number' || Number.isNaN(sample) || !Number.isFinite(sample)) {
        throw new Error('audio contains non-numeric sample');
      }
    }

    return array;
  }

  _pumpQueue() {
    if (!this.process || this.inFlight || this.queue.length === 0) {
      return;
    }

    const request = this.queue.shift();
    this.inFlight = request;
    this.process.stdin.write(
      `${JSON.stringify({ id: request.id, audio: request.audio })}\n`,
      'utf8'
    );
  }

  _handleStdoutLine(line) {
    if (!line.trim()) {
      return;
    }

    let payload;
    try {
      payload = JSON.parse(line);
    } catch (error) {
      this._handleProcessFailure(new Error(`Invalid JSON from sidecar: ${line}`));
      return;
    }

    if (payload.status === 'ready') {
      this.ready = true;
      this.readyInfo = {
        status: 'ready',
        model: payload.model,
        device: payload.device,
        computeType: payload.compute_type,
      };
      if (this.startDeferred) {
        this.startDeferred.resolve(this.readyInfo);
        this.startDeferred = null;
      }
      return;
    }

    if (!this.inFlight) {
      return;
    }

    const request = this.inFlight;
    this.inFlight = null;

    if (payload.id !== request.id) {
      request.deferred.reject(
        new Error(`Mismatched response id: expected ${request.id}, received ${payload.id}`)
      );
      this._rejectQueue(new Error('queue aborted due to mismatched response id'));
      return;
    }

    if (payload.error) {
      request.deferred.resolve({
        id: request.id,
        ok: false,
        error: payload.error,
      });
      this._pumpQueue();
      return;
    }

    request.deferred.resolve({
      id: payload.id,
      text: payload.text || '',
      language: payload.language || 'id',
      languageProbability: Number(payload.language_probability || 0),
      durationMs: Number(payload.duration_ms || 0),
      ok: true,
    });
    this._pumpQueue();
  }

  _handleProcessFailure(error) {
    if (this.stopped) {
      return;
    }

    this.ready = false;

    if (this.startDeferred) {
      this.startDeferred.reject(error);
      this.startDeferred = null;
    }

    if (this.inFlight) {
      this.inFlight.deferred.reject(error);
      this.inFlight = null;
    }

    this._rejectQueue(error);
  }

  _rejectQueue(error) {
    while (this.queue.length > 0) {
      const request = this.queue.shift();
      request.deferred.reject(error);
    }
  }
}

module.exports = {
  WhisperBridge,
};
