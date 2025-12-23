import { GoogleGenAI, Type } from "@google/genai";
import { Photo } from '../types';

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Remove data url prefix (e.g. "data:image/jpeg;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export interface GeminiAnalysisResult {
  description: string;
  location?: string;
  landmarks?: {
    name: string;
    description: string;
    url: string;
  }[];
}

export const analyzePhoto = async (photo: Photo): Promise<GeminiAnalysisResult> => {
  try {
    const base64Data = await blobToBase64(photo.blob);

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: photo.mimeType,
              data: base64Data
            }
          },
          {
            text: `Analyze this photo for a personal photo album.
            1. Write a very concise caption (1 sentence) focusing on the location, environment, and vibe.
               - Ignore specific details about people (do not mention "two men", "a woman in a dress", etc.).
               - Instead of "Two men standing in front of the Eiffel Tower", say "At the Eiffel Tower".
               - Instead of "People drinking beer at a bar", say "Drinks at [Bar Name/Location]".
               - Capture the atmosphere (e.g., "Sunny afternoon", "Rainy day", "Busy market") combined with the place.
               - If the location is unknown, describe the setting simply (e.g., "Relaxing in the garden", "Mountain view").
            2. Identify the specific location if possible (City, Country, or Landmark).
            3. If there is a famous landmark, museum, or monument, provide its name, a very brief fact, and a valid Google Search URL for it.
            
            Return ONLY JSON.`
          }
        ]
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING, description: "A concise, location-focused caption." },
            location: { type: Type.STRING, description: "The identified location, city, or country." },
            landmarks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  description: { type: Type.STRING },
                  url: { type: Type.STRING }
                }
              }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");
    
    return JSON.parse(text) as GeminiAnalysisResult;
  } catch (error) {
    console.error("Error analyzing photo:", error);
    return {
      description: "Photo content analysis unavailable.",
    };
  }
};