/**
 * Service to interact with ElevenLabs API for high-quality vocal and music generation.
 */

const BASE_URL = "https://api.elevenlabs.io/v1";

/**
 * Generates Speech using the Text-to-Speech API (Singing/Speech)
 */
export async function generateElevenLabsAudio(
  text: string,
  voiceId: string,
  apiKey: string
): Promise<ArrayBuffer | null> {
  if (!apiKey) throw new Error("ElevenLabs API Key is missing");

  const cleanText = text.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
  const modelId = "eleven_multilingual_v2"; 

  try {
    const response = await fetch(`${BASE_URL}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: modelId,
        voice_settings: {
          stability: 0.30,       
          similarity_boost: 0.8, 
          style: 1.0,           
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err?.detail?.message || "Failed to generate audio via ElevenLabs TTS");
    }
    return await response.arrayBuffer();
  } catch (error) {
    console.error("ElevenLabs TTS Error:", error);
    throw error;
  }
}

/**
 * Generates Audio using the Sound Generation API (Music/SFX)
 * Equivalent to elevenlabs.music.compose()
 */
export async function generateElevenLabsMusic(
  prompt: string,
  apiKey: string,
  durationSeconds: number = 10
): Promise<ArrayBuffer | null> {
  if (!apiKey) throw new Error("ElevenLabs API Key is missing");

  try {
    const response = await fetch(`${BASE_URL}/sound-generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text: prompt,
        duration_seconds: durationSeconds,
        prompt_influence: 0.5 
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err?.detail?.message || "Failed to generate music via ElevenLabs");
    }

    return await response.arrayBuffer();

  } catch (error) {
    console.error("ElevenLabs Music Error:", error);
    throw error;
  }
}