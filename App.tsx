import React, { useState, useEffect } from 'react';
import AlbumShelf from './components/AlbumShelf';
import AlbumBook from './components/AlbumBook';
import { Album } from './types';
import { getAlbums } from './services/db';
import { UIProvider } from './components/UIContext';

const App: React.FC = () => {
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null);
  const [currentAlbum, setCurrentAlbum] = useState<Album | null>(null);

  // Sync current album data when selected ID changes
  useEffect(() => {
    const fetchAlbum = async () => {
      if (selectedAlbumId) {
        const albums = await getAlbums();
        const found = albums.find(a => a.id === selectedAlbumId);
        setCurrentAlbum(found || null);
      } else {
        setCurrentAlbum(null);
      }
    };
    fetchAlbum();
  }, [selectedAlbumId]);

  return (
    <UIProvider>
        <div className="w-full h-full">
        {selectedAlbumId && currentAlbum ? (
            <AlbumBook 
            album={currentAlbum} 
            onBack={() => setSelectedAlbumId(null)} 
            />
        ) : (
            <AlbumShelf onSelectAlbum={setSelectedAlbumId} />
        )}
        </div>
    </UIProvider>
  );
};

export default App;