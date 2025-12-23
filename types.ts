export interface Album {
  id?: number;
  title: string;
  coverPhotoId?: number;
  createdAt: Date;
  theme: 'vintage' | 'minimal' | 'notebook';
}

export interface Photo {
  id?: number;
  albumId: number;
  blob: Blob; // Storing the image data locally
  mimeType: string;
  timestamp: Date;
  description?: string; // AI generated description
  location?: string; // AI identified location
  landmarks?: {
    name: string;
    url: string;
    description: string;
  }[];
  processed: boolean; // Has Gemini processed this?
  filter?: 'original' | 'vintage' | 'bw' | 'sepia';
}

// For Dexie
export interface DatabaseSchema {
  albums: Album;
  photos: Photo;
}