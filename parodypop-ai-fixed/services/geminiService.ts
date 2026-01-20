import { GoogleGenAI, Type } from "@google/genai";
import { ParodyGenerationResult } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

export { type ParodyGenerationResult };

/**
 * Generates time-synced lyrics and analyzes the audio.
 */
export async function generateParodyLyrics(
  topic: string, 
  audioBase64?: string,
  mimeType: string = "audio/mp3"
): Promise<ParodyGenerationResult> {
  const ai = getAI();
  const model = "gemini-3-flash-preview"; 

  // Initialize parts array
  const parts: any[] = [];
  
  // Base Instructions
  let baseInstructions = `You are an expert music producer and parody songwriter.
  TOPIC: "${topic}"
  
  Instructions:
  1. Analyze the provided audio file to detect the exact start and end times of the original vocal lines.
  2. Write parody lyrics about the TOPIC that match the rhythm and syllable count of the original song.
  3. Map your new parody lyrics to the detected timestamps of the original vocals.
  4. Ensure every line has a 'startTime' and 'endTime'.
  5. The lyrics must be funny, specific, and rhyme perfectly.
  `;

  if (audioBase64) {
      parts.push({ text: baseInstructions });
      parts.push({
        inlineData: {
          mimeType: mimeType, 
          data: audioBase64
        }
      });
  } else {
      parts.push({ text: baseInstructions + "\n(Note: No audio provided, please generate generic timestamps for a 3-minute song structure)." });
  }

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      segments: {
        type: Type.ARRAY,
        description: "Array of time-synced lyric segments",
        items: {
          type: Type.OBJECT,
          properties: {
            startTime: { type: Type.NUMBER, description: "Start time of the line in seconds (e.g., 12.5)" },
            endTime: { type: Type.NUMBER, description: "End time of the line in seconds (e.g., 15.2)" },
            text: { type: Type.STRING, description: "The parody lyric text for this line" }
          },
          required: ["startTime", "endTime", "text"]
        }
      },
      performanceStyle: { type: Type.STRING, description: "A detailed description of how the vocals should be performed." },
      voiceAnalysis: { type: Type.STRING, description: "Brief analysis of the original song's style." }
    },
    required: ["segments", "performanceStyle", "voiceAnalysis"]
  };

  try {
    const response = await ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    
    return JSON.parse(text) as ParodyGenerationResult;
  } catch (err) {
    console.error("Lyrics Generation Error:", err);
    // Fallback if generation fails
    return {
      segments: [
          { startTime: 0, endTime: 5, text: "Error generating lyrics." },
          { startTime: 5, endTime: 10, text: "Please try again with a clear audio file." }
      ],
      performanceStyle: "Spoken word",
      voiceAnalysis: "Error analyzing audio."
    };
  }
}