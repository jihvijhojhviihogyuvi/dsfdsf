/**
 * Handles Web Audio interactions, including the "Karaoke Effect"
 * (Vocal suppression using Mid-Side processing with Bass Preservation).
 */

export class AudioEngine {
  private audioContext: AudioContext;
  private backingSource: AudioBufferSourceNode | null = null;
  private gainNode: GainNode;
  
  // Mixer Nodes
  private backingGainNode: GainNode | null = null;
  
  private analyser: AnalyserNode;
  private isPlaying: boolean = false;
  private startTime: number = 0;
  private pauseTime: number = 0;

  constructor() {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.gainNode = this.audioContext.createGain();
    
    // Master Compressor (Glue) - kept to prevent clipping
    const compressorNode = this.audioContext.createDynamicsCompressor();
    compressorNode.threshold.value = -24;
    compressorNode.knee.value = 30;
    compressorNode.ratio.value = 12;
    compressorNode.attack.value = 0.003;
    compressorNode.release.value = 0.25;

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    
    // Chain: Main Gain -> Compressor -> Analyser -> Dest
    this.gainNode.connect(compressorNode);
    compressorNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);
  }

  async decodeAudio(file: File): Promise<AudioBuffer> {
    const arrayBuffer = await file.arrayBuffer();
    return await this.audioContext.decodeAudioData(arrayBuffer);
  }

  detectVocalStartTime(buffer: AudioBuffer): number {
    const maxSamples = Math.min(buffer.length, buffer.sampleRate * 60);
    const left = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const windowSize = Math.floor(sampleRate * 0.1); 
    let maxRms = 0;
    const energies: number[] = [];

    for (let i = 0; i < maxSamples; i += windowSize) {
        let sumSq = 0;
        for (let j = 0; j < windowSize && (i + j) < maxSamples; j++) {
            sumSq += left[i + j] * left[i + j];
        }
        const rms = Math.sqrt(sumSq / windowSize);
        energies.push(rms);
        if (rms > maxRms) maxRms = rms;
    }

    const threshold = maxRms * 0.15;
    let sustainedCount = 0;
    for (let i = 0; i < energies.length; i++) {
        if (energies[i] > threshold) {
            sustainedCount++;
            if (sustainedCount >= 3) {
                return Math.max(0, i - 2) * 0.1; 
            }
        } else {
            sustainedCount = 0;
        }
    }
    return 0;
  }

  createKaraokeBuffer(originalBuffer: AudioBuffer, context?: BaseAudioContext): AudioBuffer {
    const ctx = context || this.audioContext;
    if (originalBuffer.numberOfChannels < 2) return originalBuffer; 

    const length = originalBuffer.length;
    const sampleRate = originalBuffer.sampleRate;
    const newBuffer = ctx.createBuffer(2, length, sampleRate);
    
    const leftIn = originalBuffer.getChannelData(0);
    const rightIn = originalBuffer.getChannelData(1);
    const leftOut = newBuffer.getChannelData(0);
    const rightOut = newBuffer.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const l = leftIn[i];
      const r = rightIn[i];
      // Mid-Side processing: Side channel often has less lead vocals
      const side = l - r; 
      const mixed = side; 
      leftOut[i] = mixed;
      rightOut[i] = mixed;
    }
    return newBuffer;
  }

  play(
    buffer: AudioBuffer, 
    useKaraokeMode: boolean,
    volume: number = 1.0
  ) {
    if (this.isPlaying) this.stop();
    this.resume();

    const now = this.audioContext.currentTime;
    const offset = this.pauseTime % buffer.duration;

    const trackToPlay = useKaraokeMode 
      ? this.createKaraokeBuffer(buffer) 
      : buffer;

    this.backingSource = this.audioContext.createBufferSource();
    this.backingSource.buffer = trackToPlay;
    
    this.backingGainNode = this.audioContext.createGain();
    this.backingGainNode.gain.value = volume;

    // Optional EQ to help vocal suppression perception
    if (useKaraokeMode) {
        const eq = this.createVocalSuppressionEQ(this.backingSource);
        eq.connect(this.backingGainNode);
    } else {
        this.backingSource.connect(this.backingGainNode);
    }

    this.backingGainNode.connect(this.gainNode);

    this.backingSource.start(now, offset);
    
    this.startTime = now - offset;
    this.isPlaying = true;
    
    this.backingSource.onended = () => {
        if (this.audioContext.currentTime > this.startTime + buffer.duration - 0.5) {
            this.isPlaying = false;
            this.pauseTime = 0;
        }
    };
  }

  createVocalSuppressionEQ(source: AudioNode, context?: BaseAudioContext): AudioNode {
      const ctx = context || this.audioContext;
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = 1000;
      filter.gain.value = -4; 
      source.connect(filter);
      return filter; 
  }
  
  setVolume(volume: number) {
      if (this.backingGainNode) this.backingGainNode.gain.setTargetAtTime(volume, this.audioContext.currentTime, 0.1);
  }

  stop() {
    if (this.backingSource) { try { this.backingSource.stop(); } catch(e) {} this.backingSource = null; }
    if (this.isPlaying) {
        this.pauseTime = this.audioContext.currentTime - this.startTime;
        this.isPlaying = false;
    }
  }

  resume() { if(this.audioContext.state === 'suspended') this.audioContext.resume(); }

  getCurrentTime(): number {
      if (this.isPlaying && this.startTime > 0) {
          return this.audioContext.currentTime - this.startTime;
      }
      return this.pauseTime;
  }

  getAnalyser() { return this.analyser; }

  reset() { this.stop(); this.pauseTime = 0; }

  async exportTrack(
      buffer: AudioBuffer,
      useKaraoke: boolean,
      volume: number
  ): Promise<Blob> {
      const duration = buffer.duration;
      const sampleRate = 44100;
      const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
      
      const trackToPlay = useKaraoke 
        ? this.createKaraokeBuffer(buffer, offlineCtx) 
        : buffer; 

      const source = offlineCtx.createBufferSource();
      source.buffer = trackToPlay;
      
      const gain = offlineCtx.createGain();
      gain.gain.value = volume;
      
      if (useKaraoke) {
         const eq = this.createVocalSuppressionEQ(source, offlineCtx);
         eq.connect(gain);
      } else {
         source.connect(gain);
      }

      gain.connect(offlineCtx.destination);
      source.start(0);

      const renderedBuffer = await offlineCtx.startRendering();
      return this.bufferToWav(renderedBuffer);
  }

  bufferToWav(buffer: AudioBuffer): Blob {
      const numOfChan = buffer.numberOfChannels;
      const length = buffer.length * numOfChan * 2 + 44;
      const bufferArr = new ArrayBuffer(length);
      const view = new DataView(bufferArr);
      const channels = [];
      let i;
      let sample;
      let offset = 0;
      let pos = 0;

      function setUint16(data: any) { view.setUint16(pos, data, true); pos += 2; }
      function setUint32(data: any) { view.setUint32(pos, data, true); pos += 4; }

      setUint32(0x46464952); // "RIFF"
      setUint32(length - 8); 
      setUint32(0x45564157); // "WAVE"
      setUint32(0x20746d66); // "fmt "
      setUint32(16); 
      setUint16(1); 
      setUint16(numOfChan);
      setUint32(buffer.sampleRate);
      setUint32(buffer.sampleRate * 2 * numOfChan); 
      setUint16(numOfChan * 2); 
      setUint16(16); 
      setUint32(0x61746164); // "data"
      setUint32(length - pos - 4); 

      for(i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));

      while(pos < buffer.length) {
          for(i = 0; i < numOfChan; i++) {
              sample = Math.max(-1, Math.min(1, channels[i][pos])); 
              sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; 
              view.setInt16(44 + offset, sample, true);
              offset += 2;
          }
          pos++;
      }
      return new Blob([bufferArr], { type: 'audio/wav' });
  }
}