class PCMProcessor extends AudioWorkletProcessor {
  buffer = new Float32Array();
  bufferSize = 0;
  targetSampleRate;
  sourceSampleRate;
  ratio;

  constructor(options) {
    super();
    this.targetSampleRate = options.processorOptions?.targetSampleRate || 16000;
    this.sourceSampleRate = sampleRate;
    this.ratio = this.sourceSampleRate / this.targetSampleRate;
    
    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        this.flush();
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0];
    if (!channelData || channelData.length === 0) return true;

    this.buffer = this.appendBuffer(this.buffer, channelData);
    this.bufferSize += channelData.length;

    while (this.bufferSize >= this.ratio * 4096) {
      const downsampled = this.downsample(this.buffer.subarray(0, Math.floor(this.ratio * 4096)));
      const pcm = this.float32ToInt16(downsampled);
      
      this.port.postMessage({
        type: 'pcm',
        buffer: pcm.buffer
      }, [pcm.buffer]);

      this.buffer = this.buffer.subarray(Math.floor(this.ratio * 4096));
      this.bufferSize = this.buffer.length;
    }

    return true;
  }

  appendBuffer(buffer1, buffer2) {
    const result = new Float32Array(buffer1.length + buffer2.length);
    result.set(buffer1);
    result.set(buffer2, buffer1.length);
    return result;
  }

  downsample(buffer) {
    const outputLength = Math.round(buffer.length / this.ratio);
    const result = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = Math.floor(i * this.ratio);
      result[i] = buffer[srcIndex];
    }
    
    return result;
  }

  float32ToInt16(buffer) {
    const result = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const s = Math.max(-1, Math.min(1, buffer[i]));
      result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return result;
  }

  flush() {
    if (this.bufferSize > 0) {
      const downsampled = this.downsample(this.buffer.subarray(0, this.bufferSize));
      const pcm = this.float32ToInt16(downsampled);
      
      this.port.postMessage({
        type: 'pcm',
        buffer: pcm.buffer
      }, [pcm.buffer]);
      
      this.buffer = new Float32Array();
      this.bufferSize = 0;
    }
  }
}

registerProcessor('pcm-processor', PCMProcessor);