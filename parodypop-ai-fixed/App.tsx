import React, { useState, useEffect, useRef } from 'react';
import { Upload, Mic, Wand2, Play, Pause, Settings, Loader2, Volume2, VolumeX, CheckCircle2, Music2, Download, Edit2, ListMusic } from 'lucide-react';
import { AudioEngine } from './services/audioService';
import { generateParodyLyrics } from './services/geminiService';
import { Visualizer } from './components/Visualizer';
import { AppState, ParodyConfig, LyricSegment } from './types';

const audioEngine = new AudioEngine();

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
        const result = reader.result as string;
        if (result.includes(',')) {
             resolve(result.split(',')[1]);
        } else {
             resolve(result);
        }
    };
    reader.onerror = error => reject(error);
  });
}

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [backingFile, setBackingFile] = useState<File | null>(null);
  const [backingBuffer, setBackingBuffer] = useState<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  
  // Config
  const [parodyConfig, setParodyConfig] = useState<ParodyConfig>({
    topic: '',
    style: 'Funny',
  });
  
  // Lyrics State
  const [lyricSegments, setLyricSegments] = useState<LyricSegment[]>([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState<number>(-1);
  const [isEditingLyrics, setIsEditingLyrics] = useState(false);
  
  const [autoMatchedInfo, setAutoMatchedInfo] = useState<{style: string, analysis?: string} | null>(null);
  
  // Audio Controls
  const [karaokeMode, setKaraokeMode] = useState(true);
  const [backingVolume, setBackingVolume] = useState(0.8);
  const [vocalStart, setVocalStart] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => audioEngine.stop();
  }, []);

  // Playback Loop for Time Tracking
  useEffect(() => {
    let rafId: number;
    const loop = () => {
        if (isPlaying) {
            const time = audioEngine.getCurrentTime();
            setCurrentTime(time);
            
            // Find active lyric
            const index = lyricSegments.findIndex(seg => time >= seg.startTime && time <= seg.endTime);
            if (index !== -1 && index !== currentLyricIndex) {
                setCurrentLyricIndex(index);
            } else if (index === -1) {
                // Check if between lines (highlight next or keep previous?)
                // For now, just keep previous if reasonable, or clear.
                // Better UX: Highlight the UPCOMING line if closely approaching? 
                // Let's just unset if we are far away, or keep the last one active until next starts.
                
                // Let's check if we are in a gap. If so, maybe no highlight.
                // But typically karaoke highlights the line being sung.
                const nextIndex = lyricSegments.findIndex(seg => seg.startTime > time);
                // If we are waiting for a line, maybe no highlight?
                if (nextIndex !== -1 && lyricSegments[nextIndex].startTime - time > 5) {
                    setCurrentLyricIndex(-1);
                }
            }

            rafId = requestAnimationFrame(loop);
        }
    };
    if (isPlaying) {
        loop();
    } else {
        cancelAnimationFrame(rafId!);
    }
    return () => cancelAnimationFrame(rafId!);
  }, [isPlaying, lyricSegments, currentLyricIndex]);

  // Auto Scroll
  useEffect(() => {
      if (activeLyricRef.current && lyricsContainerRef.current && !isEditingLyrics) {
          activeLyricRef.current.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
          });
      }
  }, [currentLyricIndex, isEditingLyrics]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAppState(AppState.ANALYZING);
      setLoadingMessage("Decoding Audio...");
      try {
        const buffer = await audioEngine.decodeAudio(file);
        setBackingFile(file);
        setBackingBuffer(buffer);
        
        const detectedOnset = audioEngine.detectVocalStartTime(buffer);
        setVocalStart(detectedOnset);

        setAppState(AppState.EDITING);
        setLoadingMessage("");
      } catch (err) {
        console.error(err);
        alert("Error processing audio file.");
        setAppState(AppState.IDLE);
      }
    }
  };

  const handleGenerateLyrics = async () => {
    if (!parodyConfig.topic) return alert("Please enter a topic!");
    
    setAppState(AppState.ANALYZING);
    setLoadingMessage("Analyzing track & writing time-synced lyrics...");
    
    try {
      let audioBase64 = undefined;
      let mimeType = "audio/mp3";

      if (backingFile) {
        audioBase64 = await fileToBase64(backingFile);
        mimeType = backingFile.type || "audio/mp3";
        if (!mimeType) mimeType = "audio/mp3";
      }

      const result = await generateParodyLyrics(parodyConfig.topic, audioBase64, mimeType);
      
      setLyricSegments(result.segments);
      
      setAutoMatchedInfo({
        style: result.performanceStyle,
        analysis: result.voiceAnalysis
      });

      setAppState(AppState.EDITING);
      setLoadingMessage("");
    } catch (e) {
      alert("Failed to generate lyrics. Please try again.");
      setAppState(AppState.EDITING);
      setLoadingMessage("");
    }
  };

  const handleExport = async () => {
      if (!backingBuffer) return;
      setIsExporting(true);
      try {
          const blob = await audioEngine.exportTrack(
              backingBuffer,
              karaokeMode,
              backingVolume
          );
          
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `ParodyPop_Karaoke_${Date.now()}.wav`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
      } catch (e) {
          console.error(e);
          alert("Export failed.");
      }
      setIsExporting(false);
  };

  const togglePlay = () => {
    if (isPlaying) {
      audioEngine.stop();
      setIsPlaying(false);
    } else {
      audioEngine.resume();
      if (backingBuffer) {
        audioEngine.play(backingBuffer, karaokeMode, backingVolume);
        setIsPlaying(true);
      }
    }
  };
  
  const updateBackingVolume = (vol: number) => {
      setBackingVolume(vol);
      audioEngine.setVolume(vol);
  };
  
  const resetAll = () => {
    audioEngine.reset();
    setBackingFile(null);
    setBackingBuffer(null);
    setLyricSegments([]);
    setAppState(AppState.IDLE);
    setIsPlaying(false);
    setAutoMatchedInfo(null);
    setBackingVolume(0.8);
    setLoadingMessage("");
    setVocalStart(0);
    setCurrentTime(0);
  };

  // Helper to update segment text in edit mode
  const updateSegmentText = (index: number, newText: string) => {
      const newSegments = [...lyricSegments];
      newSegments[index].text = newText;
      setLyricSegments(newSegments);
  };

  const updateSegmentTime = (index: number, field: 'startTime' | 'endTime', val: string) => {
      const num = parseFloat(val);
      if (!isNaN(num)) {
        const newSegments = [...lyricSegments];
        newSegments[index][field] = num;
        setLyricSegments(newSegments);
      }
  };

  return (
    <div className="min-h-screen bg-dark-bg text-gray-200 p-4 md:p-8 font-sans selection:bg-neon-purple selection:text-white">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex justify-between items-center border-b border-dark-border pb-6">
          <div>
            <h1 className="text-4xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-neon-purple via-neon-pink to-neon-blue">
              ParodyPop<span className="text-neon-green">.AI</span>
            </h1>
            <p className="text-gray-500 mt-1 font-mono text-sm">
              The Intelligent Parody Karaoke Studio
            </p>
          </div>
          <button 
            onClick={resetAll}
            className="text-xs text-gray-500 hover:text-white underline"
          >
            Start Over
          </button>
        </header>

        {/* Main Interface */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Config (4 Cols) */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Step 1: Upload */}
            <div className={`p-6 rounded-2xl border transition-all duration-300 ${
              !backingFile 
                ? 'bg-dark-surface border-neon-purple shadow-[0_0_20px_rgba(176,38,255,0.1)]' 
                : 'bg-dark-surface/50 border-green-900/50'
            }`}>
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-neon-purple/10 rounded-lg text-neon-purple">
                  <Upload size={20} />
                </div>
                <h3 className="font-bold">1. Base Track</h3>
              </div>
              
              {!backingFile ? (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer border-2 border-dashed border-gray-700 hover:border-neon-purple hover:bg-neon-purple/5 rounded-xl p-8 text-center transition-colors"
                >
                  <p className="text-sm text-gray-400">Click to upload MP3/WAV</p>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileUpload} 
                    accept="audio/*" 
                    className="hidden" 
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-black/40 p-3 rounded-lg flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm truncate max-w-[150px]">{backingFile.name}</span>
                      <span className="text-neon-green text-xs font-mono">LOADED</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 text-[10px] text-gray-400 bg-black/20 p-2 rounded border border-white/5">
                    <CheckCircle2 size={12} className="text-neon-green" />
                    <span>Detection: Vocals start approx <span className="text-white">{vocalStart.toFixed(1)}s</span></span>
                  </div>
                </div>
              )}

              {/* Karaoke Toggle */}
              {backingFile && (
                <div className="mt-4 flex items-center justify-between p-3 bg-black/20 rounded-lg border border-dark-border">
                  <div className="flex items-center gap-2">
                    {karaokeMode ? <VolumeX size={16} className="text-neon-pink"/> : <Volume2 size={16} className="text-gray-400"/>}
                    <div className="flex flex-col">
                        <span className="text-sm font-semibold">Vocal Remover</span>
                        <span className="text-[10px] text-gray-500">Bass-Preserved Algorithm</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => setKaraokeMode(!karaokeMode)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${karaokeMode ? 'bg-neon-pink' : 'bg-gray-700'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-200 ${karaokeMode ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
              )}
            </div>

            {/* Step 2: Parody Config */}
            <div className={`p-6 rounded-2xl border bg-dark-surface border-dark-border ${!backingFile ? 'opacity-50 pointer-events-none' : ''}`}>
               <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-neon-blue/10 rounded-lg text-neon-blue">
                  <Wand2 size={20} />
                </div>
                <h3 className="font-bold">2. Parody Topic</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1">What is your parody about?</label>
                  <input 
                    type="text" 
                    placeholder="e.g., Losing my wifi, My cat's ego..." 
                    className="w-full bg-black/50 border border-dark-border rounded-lg p-3 text-sm focus:border-neon-blue outline-none transition-colors"
                    value={parodyConfig.topic}
                    onChange={(e) => setParodyConfig({...parodyConfig, topic: e.target.value})}
                  />
                </div>
                
                {autoMatchedInfo && (
                    <div className="p-3 bg-neon-blue/5 rounded-lg border border-neon-blue/20 text-xs text-gray-300">
                        <p className="font-semibold text-neon-blue mb-1">AI Song Analysis:</p>
                        <p className="italic mb-2">"{autoMatchedInfo.style}"</p>
                         {autoMatchedInfo.analysis && (
                             <p className="text-[10px] text-gray-400 border-t border-neon-blue/20 pt-2">
                                 AI Reasoning: {autoMatchedInfo.analysis}
                             </p>
                         )}
                    </div>
                )}

                <button 
                  onClick={handleGenerateLyrics}
                  disabled={appState === AppState.ANALYZING}
                  className="w-full bg-neon-blue hover:bg-neon-blue/80 text-black font-bold py-3 rounded-lg transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(38,198,255,0.3)]"
                >
                  {appState === AppState.ANALYZING ? <Loader2 className="animate-spin" size={18}/> : <Settings size={18}/>}
                  {appState === AppState.ANALYZING ? "Writing Lyrics..." : "Generate Parody Lyrics"}
                </button>
              </div>
            </div>

          </div>

          {/* Right Column: Player & Lyrics (8 Cols) */}
          <div className="lg:col-span-8 space-y-6 flex flex-col h-full">
            
            {/* Visualizer & Playback */}
            <div className="bg-dark-surface border border-dark-border rounded-2xl p-6 relative overflow-hidden flex-shrink-0">
               <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-neon-purple via-neon-pink to-neon-blue"></div>
               
               <Visualizer analyser={audioEngine.getAnalyser()} isPlaying={isPlaying} />

               <div className="mt-6 flex flex-col items-center justify-center gap-4">
                 
                 {/* Main Play Button */}
                 <div className="flex items-center gap-6">
                    <button 
                        onClick={togglePlay}
                        disabled={!backingBuffer}
                        className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                        backingBuffer 
                            ? 'bg-white text-black hover:scale-105 shadow-[0_0_30px_rgba(255,255,255,0.2)]' 
                            : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                        }`}
                    >
                        {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-2"/>}
                    </button>
                    
                    {backingBuffer && (
                        <div className="flex flex-col gap-2">
                             <div className="flex items-center gap-2">
                                 <Volume2 size={16} className="text-gray-400"/>
                                 <input 
                                     type="range" 
                                     min="0" 
                                     max="1" 
                                     step="0.05" 
                                     value={backingVolume}
                                     onChange={(e) => updateBackingVolume(parseFloat(e.target.value))}
                                     className="w-24 accent-white h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                                 />
                             </div>
                             <div className="flex items-center gap-2">
                                <span className="text-xs font-mono text-gray-500 w-12 text-right">{currentTime.toFixed(1)}s</span>
                                <button 
                                    onClick={handleExport}
                                    disabled={isExporting}
                                    className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white transition-colors border border-gray-700 rounded px-2 py-1"
                                >
                                    {isExporting ? <Loader2 className="animate-spin" size={10}/> : <Download size={10}/>}
                                    WAV
                                </button>
                             </div>
                        </div>
                    )}
                 </div>

                 <div className="flex gap-4 text-xs font-mono text-gray-500">
                    <span className={karaokeMode ? "text-neon-pink" : ""}>
                        REMOVER: {karaokeMode ? "ON" : "OFF"}
                    </span>
                    {backingBuffer && <span>DURATION: {backingBuffer.duration.toFixed(0)}s</span>}
                 </div>
               </div>
            </div>

            {/* Lyrics View */}
            <div className="bg-dark-surface border border-dark-border rounded-2xl p-6 flex-1 flex flex-col min-h-[400px] relative">
              <div className="flex justify-between items-center mb-4 pb-4 border-b border-dark-border">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-neon-green/10 rounded-lg text-neon-green">
                    <Mic size={20} />
                  </div>
                  <h3 className="font-bold">3. Karaoke View</h3>
                </div>
                
                <div className="flex items-center gap-3">
                    {isPlaying && (
                        <div className="flex items-center gap-2 animate-pulse text-neon-pink text-xs font-bold uppercase tracking-wider">
                            <Music2 size={14} />
                            Now Playing
                        </div>
                    )}
                    {lyricSegments.length > 0 && (
                        <button 
                            onClick={() => setIsEditingLyrics(!isEditingLyrics)}
                            className={`p-2 rounded hover:bg-gray-800 transition-colors ${isEditingLyrics ? 'text-neon-blue' : 'text-gray-500'}`}
                            title="Toggle Edit Mode"
                        >
                            {isEditingLyrics ? <ListMusic size={18} /> : <Edit2 size={18} />}
                        </button>
                    )}
                </div>
              </div>

              {lyricSegments.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-gray-600 italic">
                      Upload a song and generate lyrics to start singing...
                  </div>
              ) : (
                  <div 
                    ref={lyricsContainerRef}
                    className="flex-1 overflow-y-auto space-y-6 px-4 py-8 relative scroll-smooth max-h-[500px]"
                  >
                      {isEditingLyrics ? (
                          // Edit Mode
                          <div className="space-y-4">
                              {lyricSegments.map((seg, idx) => (
                                  <div key={idx} className="flex gap-2 items-start bg-black/20 p-2 rounded">
                                      <div className="flex flex-col gap-1 w-20">
                                        <input 
                                            type="number" 
                                            className="bg-transparent border-b border-gray-700 text-xs text-neon-blue outline-none"
                                            value={seg.startTime}
                                            onChange={(e) => updateSegmentTime(idx, 'startTime', e.target.value)}
                                        />
                                        <input 
                                            type="number" 
                                            className="bg-transparent border-b border-gray-700 text-xs text-neon-purple outline-none"
                                            value={seg.endTime}
                                            onChange={(e) => updateSegmentTime(idx, 'endTime', e.target.value)}
                                        />
                                      </div>
                                      <textarea
                                          className="flex-1 bg-transparent text-sm text-gray-300 outline-none resize-none border-b border-transparent focus:border-gray-600"
                                          rows={2}
                                          value={seg.text}
                                          onChange={(e) => updateSegmentText(idx, e.target.value)}
                                      />
                                  </div>
                              ))}
                          </div>
                      ) : (
                          // Playback Mode
                          lyricSegments.map((seg, idx) => {
                              const isActive = idx === currentLyricIndex;
                              const isPast = currentLyricIndex > -1 && idx < currentLyricIndex;
                              
                              return (
                                <div 
                                    key={idx} 
                                    ref={isActive ? activeLyricRef : null}
                                    className={`text-center transition-all duration-500 ease-out p-4 rounded-xl ${
                                        isActive 
                                            ? 'scale-110 bg-black/40 shadow-[0_0_30px_rgba(57,255,20,0.1)] border border-neon-green/20' 
                                            : 'scale-100 opacity-40 hover:opacity-60'
                                    }`}
                                >
                                    <p className={`font-black tracking-tight leading-tight transition-all duration-300 ${
                                        isActive 
                                            ? 'text-3xl md:text-4xl text-transparent bg-clip-text bg-gradient-to-r from-neon-green to-neon-blue' 
                                            : 'text-xl md:text-2xl text-gray-500'
                                    }`}>
                                        {seg.text}
                                    </p>
                                    {isActive && (
                                        <div className="mt-2 flex justify-center gap-1">
                                            <div className="w-1 h-1 rounded-full bg-neon-green animate-bounce" style={{animationDelay: '0ms'}}></div>
                                            <div className="w-1 h-1 rounded-full bg-neon-green animate-bounce" style={{animationDelay: '150ms'}}></div>
                                            <div className="w-1 h-1 rounded-full bg-neon-green animate-bounce" style={{animationDelay: '300ms'}}></div>
                                        </div>
                                    )}
                                </div>
                              );
                          })
                      )}
                      
                      {/* Spacer for bottom scrolling */}
                      <div className="h-32"></div>
                  </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default App;