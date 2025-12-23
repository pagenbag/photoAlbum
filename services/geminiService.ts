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

const resizeImage = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      
      // Target max dimension 800px to save tokens and bandwidth
      // while maintaining enough detail for scene analysis
      const MAX_SIZE = 800;
      let width = img.width;
      let height = img.height;

      if (width > MAX_SIZE || height > MAX_SIZE) {
        if (width > height) {
          height = Math.round(height * (MAX_SIZE / width));
          width = MAX_SIZE;
        } else {
          width = Math.round(width * (MAX_SIZE / height));
          height = MAX_SIZE;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        // Fallback to original if canvas fails
        blobToBase64(blob).then(resolve).catch(reject);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      // Compress to JPEG 70% which is sufficient for AI analysis
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      resolve(dataUrl.split(',')[1]);
    };

    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };

    img.src = url;
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
    // Use resizeImage instead of raw blobToBase64
    const base64Data = await resizeImage(photo.blob);

    // Prepare location context from metadata if available
    let locationContext = "";
    if (photo.latitude !== undefined && photo.longitude !== undefined) {
        locationContext = `The photo metadata indicates it was taken at GPS coordinates: ${photo.latitude}, ${photo.longitude}. Use this to help identify the location/city/country.`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg', // Resized image is always JPEG
              data: base64Data
            }
          },
          {
            text: `Analyze this photo for a personal photo album.
            ${locationContext}
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