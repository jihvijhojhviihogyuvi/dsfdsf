export interface LyricLine {
  original: string;
  parody: string;
}

export interface LyricSegment {
  startTime: number;
  endTime: number;
  text: string;
}

export enum AppState {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  EDITING = 'EDITING',
  GENERATING_AUDIO = 'GENERATING_AUDIO',
  READY_TO_PLAY = 'READY_TO_PLAY',
}

export interface AudioVisualizationData {
  buffer: AudioBuffer | null;
  blob: Blob | null;
  url: string | null;
}

export interface ParodyConfig {
  topic: string;
  style: string;
}

export interface ParodyGenerationResult {
  segments: LyricSegment[];
  performanceStyle: string;
  voiceAnalysis: string;
}
