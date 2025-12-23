import Dexie, { Table } from 'dexie';
import { Album, Photo } from '../types';

// We use Dexie (IndexedDB wrapper) because standard SQLite via WASM 
// is difficult to persist in a browser-only environment without a backend.
// This provides the persistent SQL-like experience requested.

class NostalgiaDatabase extends Dexie {
  albums!: Table<Album>;
  photos!: Table<Photo>;

  constructor() {
    super('NostalgiaDB');
    (this as any).version(1).stores({
      albums: '++id, title, createdAt',
      photos: '++id, albumId, timestamp, processed'
    });
  }
}

export const db = new NostalgiaDatabase();

export const createAlbum = async (title: string, theme: Album['theme'] = 'vintage'): Promise<number> => {
  return await db.albums.add({
    title,
    createdAt: new Date(),
    theme
  });
};

export const updateAlbum = async (id: number, changes: Partial<Album>) => {
  await db.albums.update(id, changes);
};

export const deleteAlbum = async (id: number) => {
  // Fix: Cast db to any to access transaction method which TS thinks is missing on the subclass
  await (db as any).transaction('rw', db.albums, db.photos, async () => {
    await db.photos.where('albumId').equals(id).delete();
    await db.albums.delete(id);
  });
};

export const addPhotoToAlbum = async (albumId: number, file: File): Promise<number> => {
  return await db.photos.add({
    albumId,
    blob: file,
    mimeType: file.type,
    timestamp: new Date(file.lastModified),
    processed: false,
    filter: 'original' // Default filter
  });
};

export const deletePhoto = async (id: number) => {
  await db.photos.delete(id);
};

export const getAlbumPhotos = async (albumId: number): Promise<Photo[]> => {
  return await db.photos.where('albumId').equals(albumId).toArray();
};

export const getAlbums = async (): Promise<Album[]> => {
  return await db.albums.toArray();
};

export const updatePhotoMetadata = async (
  id: number, 
  metadata: { 
    description?: string; 
    location?: string; 
    timestamp?: Date;
    landmarks?: { name: string; url: string; description: string }[];
    filter?: 'original' | 'vintage' | 'bw' | 'sepia' | 'polaroid' | 'cool' | 'warm' | 'dramatic';
  }
) => {
  await db.photos.update(id, {
    ...metadata,
    processed: true
  });
};

export const setAlbumCover = async (albumId: number, photoId: number) => {
  await db.albums.update(albumId, { coverPhotoId: photoId });
};