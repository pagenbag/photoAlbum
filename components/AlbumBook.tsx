import React, { useEffect, useState, useMemo, useRef } from 'react';
import { jsPDF } from "jspdf";
import { getAlbumPhotos, updatePhotoMetadata, setAlbumCover, addPhotoToAlbum, deletePhoto } from '../services/db';
import { analyzePhoto, GeminiAnalysisResult, blobToBase64 } from '../services/geminiService';
import { Photo, Album } from '../types';
import { useUI } from './UIContext';

interface AlbumBookProps {
  album: Album;
  onBack: () => void;
}

const AlbumBook: React.FC<AlbumBookProps> = ({ album, onBack }) => {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [analyzingIds, setAnalyzingIds] = useState<Set<number>>(new Set());
  const [editingPhotoId, setEditingPhotoId] = useState<number | null>(null);
  const [isAddingPhotos, setIsAddingPhotos] = useState(false);
  const [isAutoAnalyzing, setIsAutoAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<Photo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAnalysisTime = useRef<number>(0);
  const { showToast, confirm } = useUI();

  // Edit state buffers
  const [editDescription, setEditDescription] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editDate, setEditDate] = useState('');

  // Theme configuration
  const themeStyles = useMemo(() => {
    switch (album.theme) {
      case 'minimal':
        return {
          bg: 'bg-gray-100',
          page: 'bg-white shadow-none border-none',
          font: 'font-inter',
          headingFont: 'font-inter',
          text: 'text-gray-800',
          accent: 'text-gray-500',
          coverText: 'text-gray-800',
          shadow: 'shadow-xl'
        };
      case 'notebook':
        return {
          bg: 'bg-slate-700',
          page: 'notebook-texture shadow-md',
          font: 'font-caveat',
          headingFont: 'font-caveat',
          text: 'text-blue-900',
          accent: 'text-blue-700',
          coverText: 'text-white',
          shadow: 'shadow-[0_10px_20px_rgba(0,0,0,0.2)]'
        };
      case 'vintage':
      default:
        return {
          bg: 'bg-stone-800',
          page: 'paper-texture border-r border-stone-300',
          font: 'font-caveat',
          headingFont: 'font-playfair',
          text: 'text-stone-800',
          accent: 'text-stone-500',
          coverText: 'text-stone-300',
          shadow: 'shadow-[0_20px_50px_rgba(0,0,0,0.5)]'
        };
    }
  }, [album.theme]);

  // Filter styles mapping
  const filterStyles: Record<string, string> = {
      original: "",
      vintage: "sepia(0.3) contrast(1.1) brightness(1.05) saturate(0.85)",
      bw: "grayscale(1) contrast(1.15) brightness(1.05)",
      sepia: "sepia(0.8) contrast(1.1) brightness(0.95)",
      polaroid: "contrast(1.2) brightness(1.1) saturate(1.1) sepia(0.2)",
      cool: "contrast(1.1) brightness(1.1) saturate(0.9) hue-rotate(180deg) sepia(0.1)",
      warm: "sepia(0.4) contrast(1.1) brightness(1.05) saturate(1.2)",
      dramatic: "contrast(1.4) brightness(0.9) saturate(1.2) sepia(0.2)"
  };

  useEffect(() => {
    loadPhotos();
  }, [album]);

  // Auto-Analyze Effect Loop
  useEffect(() => {
    let timeoutId: number;

    const processNext = async () => {
        if (!isAutoAnalyzing) return;

        // Find next photo that isn't processed and isn't currently being analyzed
        const nextPhoto = photos.find(p => !p.processed && !analyzingIds.has(p.id!));

        if (!nextPhoto) {
            // All done
            setIsAutoAnalyzing(false);
            showToast("Auto-analysis complete", "success");
            return;
        }

        // Record start time for rate limiting
        lastAnalysisTime.current = Date.now();

        // Trigger analysis
        await handleAnalyze(nextPhoto);
    };

    if (isAutoAnalyzing) {
        // Only schedule next if we aren't currently busy
        if (analyzingIds.size === 0) {
            const now = Date.now();
            const timeSinceLast = now - lastAnalysisTime.current;
            // 20000ms = 20s = 3 per minute. Adding 2s buffer for safety = 22s.
            const RATE_LIMIT_DELAY = 22000;
            const delay = Math.max(0, RATE_LIMIT_DELAY - timeSinceLast);

            timeoutId = window.setTimeout(processNext, delay);
        }
    }

    return () => {
        if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isAutoAnalyzing, photos, analyzingIds]);

  const loadPhotos = async () => {
    if (!album.id) return;
    const data = await getAlbumPhotos(album.id);
    // Sort by timestamp
    data.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    setPhotos(data);
  };

  const handleAddPhotosClick = () => {
    fileInputRef.current?.click();
  };

  const handlePhotosAdded = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !album.id) return;

    setIsAddingPhotos(true);
    const files = Array.from(e.target.files) as File[];
    const imageFiles = files.filter(f => f.type.startsWith('image/'));

    if (imageFiles.length > 0) {
        try {
            await Promise.all(imageFiles.map(file => addPhotoToAlbum(album.id!, file)));
            await loadPhotos();
            showToast(`${imageFiles.length} photos added successfully`, "success");
        } catch (error) {
            console.error("Error adding photos", error);
            showToast("Failed to add photos.", "error");
        }
    }
    
    setIsAddingPhotos(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemovePhoto = async (photoId: number) => {
    confirm({
        title: "Remove Photo?",
        message: "Are you sure you want to remove this photo from the album?\nThis will not delete the original file.",
        confirmText: "Remove",
        isDangerous: true,
        onConfirm: async () => {
            try {
                await deletePhoto(photoId);
                setPhotos(prev => prev.filter(p => p.id !== photoId));
                showToast("Photo removed", "info");
                
                // Adjust pagination if necessary
                if (currentPhotos.length === 1 && currentPage > 0) {
                    setCurrentPage(p => p - 1);
                }
            } catch (error) {
                console.error("Failed to remove photo", error);
                showToast("Failed to remove photo", "error");
            }
        }
    });
  };

  // Pagination logic: 2 photos per page to simulate an open book
  const photosPerPage = 2;
  const totalPages = Math.ceil(photos.length / photosPerPage);

  const currentPhotos = useMemo(() => {
    const start = currentPage * photosPerPage;
    return photos.slice(start, start + photosPerPage);
  }, [photos, currentPage]);

  const handleAnalyze = async (photo: Photo) => {
    if (!photo.id || analyzingIds.has(photo.id)) return;
    
    setAnalyzingIds(prev => new Set(prev).add(photo.id!));
    
    try {
      const result = await analyzePhoto(photo);
      
      // If result exists (success), update metadata
      if (result) {
          await updatePhotoMetadata(photo.id, result);
          setPhotos(prev => prev.map(p => {
            if (p.id === photo.id) {
              return { ...p, ...result, processed: true };
            }
            return p;
          }));
      } else {
          // If result is null (failed but not fatal), mark as processed 
          // to prevent infinite loops, but do not overwrite notes.
          await updatePhotoMetadata(photo.id, {}); 
          setPhotos(prev => prev.map(p => {
            if (p.id === photo.id) {
              return { ...p, processed: true };
            }
            return p;
          }));
      }
    } catch (err: any) {
      console.error(err);
      if (err.message === "FATAL_QUOTA_EXCEEDED") {
          setIsAutoAnalyzing(false);
          showToast("Auto-analysis stopped: Quota exceeded (API 429).", "error");
      }
    } finally {
      setAnalyzingIds(prev => {
        const next = new Set(prev);
        next.delete(photo.id!);
        return next;
      });
    }
  };

  const handleUpdateFilter = async (photoId: number, filter: Photo['filter']) => {
      try {
          await updatePhotoMetadata(photoId, { filter });
          setPhotos(prev => prev.map(p => {
              if (p.id === photoId) {
                  return { ...p, filter };
              }
              return p;
          }));
      } catch (e) {
          console.error("Failed to update filter", e);
      }
  };

  const startEditing = (photo: Photo) => {
    setEditingPhotoId(photo.id || null);
    setEditDescription(photo.description || '');
    setEditLocation(photo.location || '');
    setEditDate(photo.timestamp.toISOString().split('T')[0]); // YYYY-MM-DD
  };

  const saveEditing = async (photoId: number) => {
    try {
        const newDate = new Date(editDate);
        await updatePhotoMetadata(photoId, {
            description: editDescription,
            location: editLocation,
            timestamp: isNaN(newDate.getTime()) ? new Date() : newDate
        });

        setPhotos(prev => prev.map(p => {
            if (p.id === photoId) {
                return { 
                    ...p, 
                    description: editDescription, 
                    location: editLocation,
                    timestamp: isNaN(newDate.getTime()) ? p.timestamp : newDate,
                    processed: true 
                };
            }
            return p;
        }));
    } catch(e) {
        console.error("Failed to save", e);
    } finally {
        setEditingPhotoId(null);
    }
  };

  const handleSetCover = async (photoId: number) => {
    if (album.id) {
        await setAlbumCover(album.id, photoId);
        showToast("Album cover updated!", "success");
    }
  };

  const applyFilterToImage = async (blob: Blob, filterType: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        // Resize for PDF to prevent huge base64 strings (RangeError)
        // A4 PDF doesn't need more than ~1200px width for screen viewing
        const MAX_DIMENSION = 1200; 
        let width = img.width;
        let height = img.height;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            if (width > height) {
                height = Math.round(height * (MAX_DIMENSION / width));
                width = MAX_DIMENSION;
            } else {
                width = Math.round(width * (MAX_DIMENSION / height));
                height = MAX_DIMENSION;
            }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Map filterType to CSS filter string
          const filterMap: Record<string, string> = {
              original: "none",
              vintage: "sepia(0.3) contrast(1.1) brightness(1.05) saturate(0.85)",
              bw: "grayscale(1) contrast(1.15) brightness(1.05)",
              sepia: "sepia(0.8) contrast(1.1) brightness(0.95)",
              polaroid: "contrast(1.2) brightness(1.1) saturate(1.1) sepia(0.2)",
              cool: "contrast(1.1) brightness(1.1) saturate(0.9) hue-rotate(180deg) sepia(0.1)",
              warm: "sepia(0.4) contrast(1.1) brightness(1.05) saturate(1.2)",
              dramatic: "contrast(1.4) brightness(0.9) saturate(1.2) sepia(0.2)"
          };
          ctx.filter = filterMap[filterType] || "none";
          ctx.drawImage(img, 0, 0, width, height);
          
          // Using compressed JPEG quality 0.75 for PDF export
          resolve(canvas.toDataURL('image/jpeg', 0.75)); 
        } else {
          resolve(url); // Fallback
        }
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
          resolve(url);
          URL.revokeObjectURL(url);
      }
      img.src = url;
    });
  };

  const handleExportPDF = async () => {
    if (!album.id) return;
    setIsExporting(true);
    
    try {
      const allPhotos = [...photos]; 

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      
      const pageWidth = 297;
      const pageHeight = 210;
      const halfWidth = pageWidth / 2;
      
      // Theme configs
      let bgColor = '#fdfbf7';
      let textColor = '#292524';
      let fontName = 'times'; // jsPDF standard font
      
      if (album.theme === 'minimal') {
        bgColor = '#ffffff';
        textColor = '#1f2937';
        fontName = 'helvetica';
      } else if (album.theme === 'notebook') {
        bgColor = '#f8fafc'; // slate-50
        textColor = '#1e3a8a'; // blue-900
        fontName = 'courier';
      }

      // Add cover page
      doc.setFillColor(bgColor);
      doc.rect(0, 0, pageWidth, pageHeight, 'F');
      
      doc.setFont(fontName, 'bold');
      doc.setFontSize(32);
      doc.setTextColor(textColor);
      doc.text(album.title, pageWidth / 2, pageHeight / 2 - 10, { align: 'center' });
      
      doc.setFontSize(14);
      doc.setFont(fontName, 'normal');
      doc.text(`Created on ${album.createdAt.toLocaleDateString()}`, pageWidth / 2, pageHeight / 2 + 10, { align: 'center' });
      
      // Photos
      for (let i = 0; i < allPhotos.length; i += 2) {
        doc.addPage();
        doc.setFillColor(bgColor);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');
        
        // Draw decorative center line (spine)
        doc.setDrawColor(200, 200, 200);
        doc.line(halfWidth, 10, halfWidth, pageHeight - 10);
        
        const photosOnPage = [allPhotos[i], allPhotos[i+1]].filter(Boolean);
        
        for (let j = 0; j < photosOnPage.length; j++) {
            const photo = photosOnPage[j];
            const xOffset = j === 0 ? 0 : halfWidth;
            const contentWidth = halfWidth - 20; // 10mm padding each side
            const startX = xOffset + 10;
            const startY = 20;
            
            // Image with applied filter
            const filterToUse = photo.filter || 'original';
            const base64DataUrl = await applyFilterToImage(photo.blob, filterToUse);
            
            // Calculate aspect ratio
            const imgProps = doc.getImageProperties(base64DataUrl);
            const imgRatio = imgProps.width / imgProps.height;
            let imgW = contentWidth;
            let imgH = imgW / imgRatio;
            
            if (imgH > 100) {
                imgH = 100;
                imgW = imgH * imgRatio;
            }
            
            // Center image in the top half
            const imgX = startX + (contentWidth - imgW) / 2;
            
            try {
                // jsPDF handles format detection usually, but we can hint it
                doc.addImage(base64DataUrl, 'JPEG', imgX, startY, imgW, imgH);
            } catch (err) {
                console.error("Failed to add image to PDF", err);
                doc.setFontSize(8);
                doc.text("Image Error", imgX, startY + 10);
            }
            
            // Frame/Border for image (except minimal)
            if (album.theme !== 'minimal') {
                doc.setDrawColor(textColor);
                doc.setLineWidth(0.5);
                doc.rect(imgX - 1, startY - 1, imgW + 2, imgH + 2);
            }

            // Text Metadata
            let textY = startY + imgH + 10;
            
            doc.setFont(fontName, 'italic');
            doc.setFontSize(10);
            doc.setTextColor(textColor);
            
            // Date | Location
            const dateStr = photo.timestamp.toLocaleDateString();
            const locStr = photo.location ? ` • ${photo.location}` : '';
            doc.text(`${dateStr}${locStr}`, startX + contentWidth / 2, textY, { align: 'center' });
            
            textY += 8;
            
            // Description
            if (photo.description) {
                doc.setFont(fontName, 'normal');
                doc.setFontSize(12);
                const splitDesc = doc.splitTextToSize(photo.description, contentWidth);
                doc.text(splitDesc, startX, textY);
                textY += (splitDesc.length * 5) + 2;
            }
            
            // Landmarks
            if (photo.landmarks && photo.landmarks.length > 0) {
                textY += 5;
                doc.setFontSize(10);
                photo.landmarks.forEach(lm => {
                    doc.setFont(fontName, 'bold');
                    doc.text(lm.name, startX, textY);
                    textY += 5;
                    doc.setFont(fontName, 'normal');
                    const splitLm = doc.splitTextToSize(lm.description, contentWidth);
                    doc.text(splitLm, startX, textY);
                    textY += (splitLm.length * 4) + 3;
                });
            }
        }
      }
      
      const fileName = `${album.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`;
      doc.save(fileName);
      showToast("PDF exported successfully", "success");
    } catch (e) {
      console.error("PDF Generation failed", e);
      showToast("Failed to generate PDF. Check console.", "error");
    } finally {
      setIsExporting(false);
    }
  };

  const PhotoViewer: React.FC<{ photo: Photo; onClose: () => void }> = ({ photo, onClose }) => {
    const [imgUrl, setImgUrl] = useState<string | undefined>(undefined);
    
    useEffect(() => {
        const url = URL.createObjectURL(photo.blob);
        setImgUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [photo]);

    // Use default theme or minimal if standard, just generic clean look for overlay
    // For the filter style:
    const currentFilterStyle = photo.filter ? filterStyles[photo.filter] : '';

    return (
        <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]" onClick={onClose}>
             {/* Close Button */}
            <button 
                onClick={onClose}
                className="absolute top-4 right-4 z-[110] text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
            >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>

            <div className="w-full max-w-7xl max-h-screen flex flex-col md:flex-row gap-6 items-center justify-center" onClick={e => e.stopPropagation()}>
               
               {/* Large Image */}
               <div className="flex-1 w-full h-full flex items-center justify-center relative min-h-[50vh]">
                   <img 
                        src={imgUrl} 
                        alt="Full view" 
                        className={`max-w-full max-h-[85vh] w-auto h-auto object-contain shadow-2xl rounded-sm ${currentFilterStyle}`} 
                   />
               </div>
               
               {/* Side Panel (Metadata) */}
               <div className="w-full md:w-80 lg:w-96 bg-stone-900/50 backdrop-blur-md text-stone-200 p-6 rounded-lg border border-white/10 overflow-y-auto max-h-[30vh] md:max-h-[85vh] flex flex-col gap-4">
                   <div>
                       <h3 className="text-sm font-bold uppercase tracking-wider text-stone-400 mb-1">Date</h3>
                       <p className="font-playfair text-xl">{photo.timestamp.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                       <p className="text-sm text-stone-500">{photo.timestamp.toLocaleTimeString()}</p>
                   </div>
                   
                   {photo.location && (
                       <div>
                           <h3 className="text-sm font-bold uppercase tracking-wider text-stone-400 mb-1">Location</h3>
                           <div className="flex items-center gap-2">
                                <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                <p className="font-medium text-lg">{photo.location}</p>
                           </div>
                       </div>
                   )}

                   {photo.description && (
                       <div className="border-t border-white/10 pt-4">
                           <h3 className="text-sm font-bold uppercase tracking-wider text-stone-400 mb-2">Notes</h3>
                           <p className="font-caveat text-2xl leading-relaxed text-amber-100">{photo.description}</p>
                       </div>
                   )}
                   
                   {photo.landmarks && photo.landmarks.length > 0 && (
                       <div className="border-t border-white/10 pt-4 flex flex-col gap-3">
                           <h3 className="text-sm font-bold uppercase tracking-wider text-stone-400">Landmarks</h3>
                           {photo.landmarks.map((lm, i) => (
                               <div key={i} className="bg-white/5 p-3 rounded">
                                   <p className="font-bold text-amber-200">{lm.name}</p>
                                   <p className="text-sm text-stone-300 mt-1">{lm.description}</p>
                                   <a href={lm.url} target="_blank" rel="noreferrer" className="text-xs text-amber-500 hover:text-amber-400 mt-2 inline-block uppercase tracking-wide">Read More &rarr;</a>
                               </div>
                           ))}
                       </div>
                   )}
               </div>
            </div>
        </div>
    );
  };

  const PhotoCard: React.FC<{ photo: Photo, index: number }> = ({ photo, index }) => {
    const [imgUrl, setImgUrl] = useState<string | undefined>(undefined);
    const [showFilterMenu, setShowFilterMenu] = useState(false);
    const isEditing = editingPhotoId === photo.id;
    
    useEffect(() => {
      const url = URL.createObjectURL(photo.blob);
      setImgUrl(url);
      return () => URL.revokeObjectURL(url);
    }, [photo]);

    // Random rotation for aesthetic (disable for minimal theme)
    const rotation = useMemo(() => album.theme === 'minimal' ? 0 : Math.random() * 4 - 2, [album.theme]); 

    // Filter styles mapping
    const filterStyles: Record<string, string> = {
        original: "",
        vintage: "sepia-[0.3] contrast-[1.1] brightness-[1.05] saturate-[0.85]",
        bw: "grayscale-[1] contrast-[1.15] brightness-[1.05]",
        sepia: "sepia-[0.8] contrast-[1.1] brightness-[0.95]",
        polaroid: "contrast(1.2) brightness(1.1) saturate(1.1) sepia(0.2)",
        cool: "contrast(1.1) brightness(1.1) saturate(0.9) hue-rotate(180deg) sepia(0.1)",
        warm: "sepia(0.4) contrast(1.1) brightness(1.05) saturate(1.2)",
        dramatic: "contrast(1.4) brightness(0.9) saturate(1.2) sepia(0.2)"
    };

    const currentFilter = photo.filter || 'original';

    return (
      <div 
        className={`photo-card flex flex-col gap-4 p-6 bg-white shadow-sm border border-stone-200 relative mb-8 group/card transition-all duration-300`}
        style={{transform: `rotate(${rotation.toFixed(1)}deg)`}}
      >
         {/* Photo Corners (CSS Art) - Hide in minimal */}
         {album.theme !== 'minimal' && (
            <>
                <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-stone-800 opacity-20"></div>
                <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-stone-800 opacity-20"></div>
                <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-stone-800 opacity-20"></div>
                <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-stone-800 opacity-20"></div>
            </>
         )}
        
        {/* Set Cover Button (Visible on hover) */}
        <button 
            onClick={() => photo.id && handleSetCover(photo.id)}
            className="no-print absolute top-2 right-2 z-10 bg-stone-800/80 text-white text-xs px-2 py-1 rounded opacity-0 group-hover/card:opacity-100 transition-opacity"
            title="Set as Album Cover"
        >
            Set as Cover
        </button>

         {/* Remove Photo Button */}
         <button 
            onClick={() => photo.id && handleRemovePhoto(photo.id)}
            className="no-print absolute top-8 right-2 z-10 bg-red-800/80 text-white text-xs px-2 py-1 rounded opacity-0 group-hover/card:opacity-100 transition-opacity"
            title="Remove Photo from Album"
        >
            Remove
        </button>

        {/* Filter Toggle (Visible on hover) */}
        <div className="no-print absolute top-2 left-2 z-10 opacity-0 group-hover/card:opacity-100 transition-opacity">
            <button 
                onClick={() => setShowFilterMenu(!showFilterMenu)}
                className="bg-stone-800/80 text-white p-1 rounded hover:bg-stone-700"
                title="Change Filter"
            >
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>
            </button>
            
            {showFilterMenu && (
                <div className="absolute top-8 left-0 bg-white border border-stone-200 shadow-lg rounded p-1 flex flex-col gap-1 w-32 max-h-48 overflow-y-auto z-50">
                     {Object.keys(filterStyles).map((f) => (
                         <button
                            key={f}
                            onClick={() => {
                                if (photo.id) handleUpdateFilter(photo.id, f as any);
                                setShowFilterMenu(false);
                            }}
                            className={`text-xs text-left px-2 py-1 rounded hover:bg-stone-100 ${currentFilter === f ? 'font-bold bg-stone-50' : ''}`}
                         >
                            {f.charAt(0).toUpperCase() + f.slice(1)}
                         </button>
                     ))}
                </div>
            )}
        </div>

        {/* The Image Container with Interact Effects */}
        {/* Changed from overflow-hidden + object-cover to allow natural aspect ratio */}
        <div className={`p-2 bg-white border border-stone-100 shadow-inner transition-all duration-300 group-hover/card:scale-[1.01] group-hover/card:shadow-lg ${album.theme === 'minimal' ? 'group-hover/card:ring-2 group-hover/card:ring-gray-300' : 'group-hover/card:ring-2 group-hover/card:ring-stone-400/50 group-hover/card:ring-offset-2'}`}>
           <img 
              src={imgUrl} 
              alt="Memory" 
              onClick={() => setViewingPhoto(photo)}
              className={`w-full h-auto max-h-[500px] object-contain cursor-zoom-in transition-all duration-500 ${filterStyles[currentFilter]}`} 
            />
        </div>

        {/* Metadata / Notes Section */}
        <div className={`${themeStyles.font} text-xl ${themeStyles.text} min-h-[100px] relative group/notes`}>
            {/* Edit Button */}
            {!isEditing && (
                <button 
                    onClick={() => startEditing(photo)}
                    className="no-print absolute -top-2 -right-2 p-1 text-stone-400 hover:text-stone-600 opacity-0 group-hover/notes:opacity-100 transition-opacity"
                    title="Edit Details"
                >
                     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>
            )}

            {isEditing ? (
                 <div className="flex flex-col gap-2 font-sans text-sm">
                    <textarea 
                        className="w-full border border-stone-300 p-2 rounded resize-none bg-white text-stone-900 shadow-inner"
                        rows={3}
                        placeholder="Write a note..."
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                    />
                    <div className="flex gap-2">
                        <input 
                            type="text" 
                            className="flex-1 border border-stone-300 p-2 rounded bg-white text-stone-900 shadow-inner"
                            placeholder="Location"
                            value={editLocation}
                            onChange={(e) => setEditLocation(e.target.value)}
                        />
                        <input 
                            type="date" 
                            className="border border-stone-300 p-2 rounded bg-white text-stone-900 shadow-inner"
                            value={editDate}
                            onChange={(e) => setEditDate(e.target.value)}
                        />
                    </div>
                    <div className="flex justify-end gap-2 mt-2">
                        <button onClick={() => setEditingPhotoId(null)} className="px-2 py-1 text-stone-500 hover:text-stone-700">Cancel</button>
                        <button onClick={() => photo.id && saveEditing(photo.id)} className="px-3 py-1 bg-stone-800 text-white rounded">Save</button>
                    </div>
                 </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {/* Description */}
                    {photo.description ? (
                        <p className="leading-6">{photo.description}</p>
                    ) : (
                        <div className="h-6"></div> /* Spacer if no desc yet */
                    )}

                    {/* AI Button - Small & Hover Only */}
                    <div className="absolute top-0 left-0 opacity-0 group-hover/notes:opacity-100 transition-opacity">
                         <button 
                            onClick={() => handleAnalyze(photo)}
                            disabled={analyzingIds.has(photo.id!)}
                            className="no-print text-xs px-2 py-1 bg-stone-100 border border-stone-200 text-stone-600 rounded shadow-sm hover:bg-white flex items-center gap-1"
                        >
                            {analyzingIds.has(photo.id!) ? (
                                <span className="animate-pulse">Thinking...</span>
                            ) : (
                                <>
                                    <span>✨ AI Note</span>
                                </>
                            )}
                        </button>
                    </div>
                    
                    {/* Meta Info */}
                    <div className={`flex items-center justify-between ${themeStyles.accent} text-lg mt-2 border-t ${album.theme === 'minimal' ? 'border-gray-200' : 'border-stone-200'} pt-2 border-dashed`}>
                        {/* Location */}
                        <div className="flex items-center gap-2">
                            {photo.location ? (
                                <>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                    <span>{photo.location}</span>
                                </>
                            ) : (
                                <span className="opacity-50 text-sm italic">Add location...</span>
                            )}
                        </div>
                        {/* Date */}
                         <div className="text-xs font-sans opacity-70">
                            {photo.timestamp.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                        </div>
                    </div>

                    {/* Landmarks */}
                    {photo.landmarks && photo.landmarks.length > 0 && (
                        <div className="mt-1">
                        {photo.landmarks.map((lm, i) => (
                            <div key={i} className={`flex flex-col text-base bg-amber-50 p-2 rounded border border-amber-100/50 ${themeStyles.text}`}>
                            <span className="font-bold">{lm.name}</span>
                            <span className="text-sm">{lm.description}</span>
                            <a 
                                href={lm.url} 
                                target="_blank" 
                                rel="noreferrer"
                                className="text-amber-700 underline hover:text-amber-900 mt-1 inline-block text-sm"
                            >
                                Learn more &rarr;
                            </a>
                            </div>
                        ))}
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
    );
  };

  return (
    <div className={`flex-1 ${themeStyles.bg} flex flex-col h-screen overflow-hidden`}>
      {/* Top Bar */}
      <div className={`p-4 shadow-md flex justify-between items-center z-10 no-print ${album.theme === 'minimal' ? 'bg-white border-b border-gray-200' : 'bg-stone-900 text-white'}`}>
        <button onClick={onBack} className={`${themeStyles.coverText} hover:opacity-80 flex items-center gap-2 transition-colors`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          Back to Shelf
        </button>
        <h2 className={`${themeStyles.headingFont} text-xl tracking-wider ${themeStyles.coverText}`}>{album.title}</h2>
        <div className="flex gap-2">
            <button 
                onClick={() => setIsAutoAnalyzing(!isAutoAnalyzing)}
                className={`${themeStyles.coverText} hover:opacity-80 flex items-center gap-2 transition-colors px-3 py-1 rounded border border-current ${isAutoAnalyzing ? 'bg-amber-500/20 animate-pulse' : ''}`}
                title="Automatically analyze photos in the background"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                {isAutoAnalyzing ? "Auto-Filling..." : "Auto-Fill Notes"}
            </button>
            <button 
                onClick={handleAddPhotosClick}
                className={`${themeStyles.coverText} hover:opacity-80 flex items-center gap-2 transition-colors px-3 py-1 rounded border border-current`}
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                {isAddingPhotos ? "Adding..." : "Add Photos"}
            </button>
            <button 
                onClick={handleExportPDF} 
                disabled={isExporting}
                className={`${themeStyles.coverText} hover:opacity-80 flex items-center gap-2 transition-colors px-3 py-1 rounded border border-current disabled:opacity-50 disabled:cursor-wait`}
            >
                {isExporting ? (
                    <span className="animate-pulse">Exporting...</span>
                ) : (
                    <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                        Export PDF
                    </>
                )}
            </button>
        </div>
      </div>

      {/* Main Book Area */}
      <div className={`flex-1 flex items-center justify-center p-4 sm:p-8 overflow-hidden`}>
        {photos.length === 0 ? (
          <div className="text-stone-500 font-playfair text-xl">This album is empty.</div>
        ) : (
          <div className="relative w-full max-w-6xl h-full flex bg-transparent perspective-[2000px]">
            {/* The Open Book */}
            <div className={`w-full h-full flex flex-row-print-reset ${themeStyles.shadow} rounded page-container ${themeStyles.page.split(' ')[0]}`}>
              
              {/* Left Page */}
              <div className={`flex-1 ${themeStyles.page} p-8 overflow-y-auto no-scrollbar relative shadow-[inset_-20px_0_40px_-20px_rgba(0,0,0,0.1)] page-container`}>
                 {/* Page Number */}
                 <span className="no-print absolute bottom-4 left-4 text-stone-400 font-playfair text-sm">{currentPage * 2 + 1}</span>
                 
                 {currentPhotos[0] && (
                   <PhotoCard photo={currentPhotos[0]} index={0} />
                 )}
              </div>

              {/* Right Page */}
              <div className={`flex-1 ${themeStyles.page} border-none p-8 overflow-y-auto no-scrollbar relative shadow-[inset_20px_0_40px_-20px_rgba(0,0,0,0.1)] page-container`}>
                 {/* Page Number */}
                 <span className="no-print absolute bottom-4 right-4 text-stone-400 font-playfair text-sm">{currentPage * 2 + 2}</span>

                 {currentPhotos[1] && (
                   <PhotoCard photo={currentPhotos[1]} index={1} />
                 )}
              </div>

            </div>

            {/* Navigation Buttons (Floating) */}
            <button 
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="no-print absolute left-0 top-1/2 -translate-x-4 -translate-y-1/2 bg-stone-800/80 text-white p-3 rounded-full hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button 
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage === totalPages - 1}
              className="no-print absolute right-0 top-1/2 translate-x-4 -translate-y-1/2 bg-stone-800/80 text-white p-3 rounded-full hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        )}
      </div>

       {/* Hidden Input for Adding Photos */}
       <input
            type="file"
            ref={fileInputRef}
            onChange={handlePhotosAdded}
            className="hidden"
            accept="image/*"
            multiple
        />
        
        {/* Full Screen Photo Viewer */}
        {viewingPhoto && <PhotoViewer photo={viewingPhoto} onClose={() => setViewingPhoto(null)} />}
    </div>
  );
};

export default AlbumBook;