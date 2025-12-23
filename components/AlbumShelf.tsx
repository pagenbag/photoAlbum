import React, { useEffect, useState, useRef } from 'react';
import { db, createAlbum, addPhotoToAlbum, getAlbums, setAlbumCover, getAlbumPhotos, updateAlbum } from '../services/db';
import { Album } from '../types';

interface AlbumShelfProps {
  onSelectAlbum: (albumId: number) => void;
}

const AlbumShelf: React.FC<AlbumShelfProps> = ({ onSelectAlbum }) => {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<Album['theme']>('vintage');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAlbums();
  }, []);

  const loadAlbums = async () => {
    const loaded = await getAlbums();
    setAlbums(loaded);
  };

  const handleStartCreate = () => {
    setIsModalOpen(true);
    setSelectedTheme('vintage');
  };

  const handleContinueCreate = () => {
    fileInputRef.current?.click();
    setIsModalOpen(false);
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    setIsImporting(true);
    const files = Array.from(e.target.files) as File[];
    
    // Filter strictly for images
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      alert("No images found in selection.");
      setIsImporting(false);
      return;
    }

    // Use directory name as album title if available, else 'New Album'
    const path = imageFiles[0].webkitRelativePath;
    const folderName = path ? path.split('/')[0] : `Album ${new Date().toLocaleDateString()}`;

    try {
      const albumId = await createAlbum(folderName, selectedTheme);
      
      const photoIds = await Promise.all(imageFiles.map(file => addPhotoToAlbum(albumId, file)));
      
      // Set the first photo as cover
      if (photoIds.length > 0) {
        await setAlbumCover(albumId, photoIds[0]);
      }

      await loadAlbums();
    } catch (err) {
      console.error("Failed to create album", err);
      alert("Failed to create album. Please try again.");
    } finally {
      setIsImporting(false);
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const AlbumCover: React.FC<{ album: Album }> = ({ album }) => {
    const [coverUrl, setCoverUrl] = useState<string | null>(null);
    const [dateLabel, setDateLabel] = useState<string>("");
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState(album.title);

    useEffect(() => {
      const loadData = async () => {
        if (!album.id) return;
        const photos = await getAlbumPhotos(album.id);
        
        // Load Cover
        if (album.coverPhotoId) {
            const cover = photos.find(p => p.id === album.coverPhotoId);
            if (cover) {
                setCoverUrl(URL.createObjectURL(cover.blob));
            }
        } else if (photos.length > 0) {
            // Fallback to first photo if no specific cover set (helps visual consistency)
             setCoverUrl(URL.createObjectURL(photos[0].blob));
        }

        // Calculate Date Label
        if (photos.length > 0) {
             const timestamps = photos.map(p => p.timestamp.getTime()).sort((a, b) => a - b);
             const minTime = timestamps[0];
             const maxTime = timestamps[timestamps.length - 1];
             const minDate = new Date(minTime);
             const maxDate = new Date(maxTime);

             const diffTime = Math.abs(maxTime - minTime);
             const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

             // Check if same day (ignoring time)
             const isSameDay = minDate.toDateString() === maxDate.toDateString();

             if (isSameDay) {
                 setDateLabel(minDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }));
             } else if (diffDays < 60) {
                 setDateLabel(minDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }));
             } else {
                 setDateLabel(minDate.getFullYear().toString());
             }
        }
      };
      loadData();
    }, [album]);

    const handleSaveTitle = async (e: React.FormEvent) => {
        e.stopPropagation();
        if (album.id) {
            await updateAlbum(album.id, { title: editTitle });
            setIsEditing(false);
            loadAlbums();
        }
    };

    // Theme badge colors
    const themeBadgeColor = {
        vintage: 'bg-amber-800 text-amber-200',
        minimal: 'bg-stone-200 text-stone-800',
        notebook: 'bg-blue-800 text-blue-100'
    }[album.theme || 'vintage'];

    return (
      <div 
        onClick={() => !isEditing && album.id && onSelectAlbum(album.id)}
        className="group relative w-48 h-64 cursor-pointer transform transition-transform duration-300 hover:-translate-y-2 hover:rotate-1"
      >
        {/* Spine/Binding effect */}
        <div className="absolute left-0 top-0 bottom-0 w-4 bg-stone-800 rounded-l-md z-20 shadow-lg"></div>
        
        {/* Cover */}
        <div className="absolute inset-0 left-4 bg-[#8b5a2b] rounded-r-md shadow-xl overflow-hidden border-t border-b border-r border-[#6d4621] flex flex-col">
            {/* Title Area */}
            <div className="h-1/3 p-2 flex flex-col items-center justify-center border-b border-[#6d4621] bg-[#7a4e25] relative">
                {isEditing ? (
                    <div className="flex flex-col items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
                        <input 
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full text-center text-sm font-playfair p-1 rounded bg-stone-100 text-stone-900"
                            autoFocus
                        />
                        <button onClick={handleSaveTitle} className="text-xs bg-stone-800 text-white px-2 py-0.5 rounded">Save</button>
                    </div>
                ) : (
                    <div className="group/title w-full h-full flex flex-col items-center justify-center relative">
                        <h3 className="font-playfair text-white text-center text-lg leading-tight line-clamp-2">
                            {album.title}
                        </h3>
                        {dateLabel && (
                            <span className="text-stone-300 font-caveat text-sm mt-1">{dateLabel}</span>
                        )}
                        <span className={`absolute top-1 right-1 text-[8px] px-1 rounded uppercase tracking-wide opacity-50 ${themeBadgeColor}`}>
                            {album.theme}
                        </span>
                        <button 
                            onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                            className="absolute top-0 right-0 p-1 opacity-0 group-hover/title:opacity-100 text-stone-300 hover:text-white"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                    </div>
                )}
            </div>
            
            {/* Photo Preview Area */}
            <div className="flex-1 bg-stone-900 relative overflow-hidden">
                {coverUrl ? (
                    <img src={coverUrl} alt="Cover" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-stone-500 text-xs">No Cover</div>
                )}
            </div>
            
            {/* Bottom decoration */}
            <div className="h-4 bg-[#5c3a21] border-t border-[#6d4621]"></div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 leather-texture p-8 overflow-y-auto relative">
      <div className="max-w-6xl mx-auto">
        <header className="mb-12 text-center">
            <h1 className="font-playfair text-5xl text-stone-200 mb-2 drop-shadow-md">My Collection</h1>
            <p className="font-caveat text-xl text-stone-400">Memories preserved in ink & pixel</p>
        </header>

        <div className="flex flex-wrap gap-12 justify-center items-end min-h-[400px]">
             {/* Shelf Row */}
             <div className="w-full flex flex-wrap gap-12 justify-center pb-8 border-b-8 border-[#3e2716] shadow-[0_10px_20px_rgba(0,0,0,0.5)] bg-[url('https://www.transparenttextures.com/patterns/wood-pattern.png')]">
                {albums.map(album => (
                    <AlbumCover key={album.id} album={album} />
                ))}

                {/* Add New Album Placeholder */}
                <div 
                    onClick={handleStartCreate}
                    className="w-48 h-64 cursor-pointer flex flex-col items-center justify-center border-4 border-dashed border-stone-600 rounded-lg hover:border-stone-400 hover:bg-white/5 transition-colors group"
                >
                    <div className="text-6xl text-stone-600 group-hover:text-stone-400 font-light mb-2">+</div>
                    <span className="font-playfair text-stone-500 group-hover:text-stone-300">Create Album</span>
                    {isImporting && <span className="text-xs text-amber-500 mt-2 font-bold animate-pulse">Importing...</span>}
                </div>
             </div>
        </div>

        {/* Hidden Input for Directory Selection */}
        <input
            type="file"
            ref={fileInputRef}
            onChange={handleFilesSelected}
            className="hidden"
            // @ts-ignore - directory support is non-standard but widely supported
            webkitdirectory=""
            directory=""
            multiple
        />

        {/* Create Album Modal */}
        {isModalOpen && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                <div className="bg-[#fdfbf7] p-8 rounded-lg shadow-2xl max-w-md w-full relative border border-stone-300">
                    <button 
                        onClick={() => setIsModalOpen(false)}
                        className="absolute top-2 right-2 text-stone-400 hover:text-stone-600"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                    
                    <h2 className="font-playfair text-3xl text-stone-800 mb-6 text-center">New Album Theme</h2>
                    
                    <div className="flex flex-col gap-4 mb-8">
                        {/* Vintage Option */}
                        <div 
                            onClick={() => setSelectedTheme('vintage')}
                            className={`p-4 border-2 rounded-lg cursor-pointer flex items-center gap-4 transition-all ${selectedTheme === 'vintage' ? 'border-amber-600 bg-amber-50' : 'border-stone-200 hover:border-stone-400'}`}
                        >
                            <div className="w-12 h-12 bg-[#fdfbf7] border border-stone-300 rounded shadow-sm flex items-center justify-center">
                                <span className="font-caveat text-xl text-stone-800">Aa</span>
                            </div>
                            <div>
                                <h3 className="font-playfair font-bold text-stone-800">Vintage</h3>
                                <p className="text-stone-500 text-sm">Classic textured paper & handwritten notes.</p>
                            </div>
                        </div>

                        {/* Minimal Option */}
                        <div 
                            onClick={() => setSelectedTheme('minimal')}
                            className={`p-4 border-2 rounded-lg cursor-pointer flex items-center gap-4 transition-all ${selectedTheme === 'minimal' ? 'border-stone-800 bg-stone-50' : 'border-stone-200 hover:border-stone-400'}`}
                        >
                            <div className="w-12 h-12 bg-white border border-gray-200 rounded shadow-sm flex items-center justify-center">
                                <span className="font-sans text-xl text-gray-800">Aa</span>
                            </div>
                            <div>
                                <h3 className="font-inter font-bold text-gray-800">Minimal</h3>
                                <p className="text-gray-500 text-sm">Clean, modern lines with sans-serif type.</p>
                            </div>
                        </div>

                        {/* Notebook Option */}
                        <div 
                            onClick={() => setSelectedTheme('notebook')}
                            className={`p-4 border-2 rounded-lg cursor-pointer flex items-center gap-4 transition-all ${selectedTheme === 'notebook' ? 'border-blue-600 bg-blue-50' : 'border-stone-200 hover:border-stone-400'}`}
                        >
                            <div className="w-12 h-12 bg-white border border-stone-200 rounded shadow-sm flex items-center justify-center" style={{backgroundImage: 'linear-gradient(#e5e7eb 1px, transparent 1px)', backgroundSize: '100% 1rem'}}>
                                <span className="font-caveat text-xl text-blue-800">Aa</span>
                            </div>
                            <div>
                                <h3 className="font-playfair font-bold text-stone-800">Notebook</h3>
                                <p className="text-stone-500 text-sm">Lined paper style with a casual feel.</p>
                            </div>
                        </div>
                    </div>

                    <button 
                        onClick={handleContinueCreate}
                        className="w-full bg-stone-800 text-white font-playfair py-3 rounded hover:bg-stone-700 transition-colors text-lg"
                    >
                        Select Photos & Create
                    </button>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

export default AlbumShelf;