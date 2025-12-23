import exifr from 'exifr';

export interface ExifData {
    date?: Date;
    latitude?: number;
    longitude?: number;
}

export const getExifData = async (file: File): Promise<ExifData> => {
  try {
    // exifr.parse returns a Promise that resolves with a simple object 
    // containing the metadata. It automatically converts Dates and GPS DMS coordinates.
    const output = await exifr.parse(file, {
        tiff: true,
        exif: true,
        gps: true,
        // We can optionally pick only what we need to speed it up
        pick: ['DateTimeOriginal', 'GPSLatitude', 'GPSLongitude'] 
    });

    if (!output) {
        return {};
    }

    // exifr automatically parses 'DateTimeOriginal' into a JS Date object
    let date: Date | undefined = output.DateTimeOriginal;
    
    // exifr automatically converts GPS tags to decimal degrees 'latitude' and 'longitude' properties
    let latitude: number | undefined = output.latitude;
    let longitude: number | undefined = output.longitude;

    return { 
        date: date instanceof Date ? date : undefined, 
        latitude, 
        longitude 
    };
  } catch (e) {
    console.warn("EXIF parsing failed", e);
    // Return empty on error so the app continues without metadata
    return {};
  }
};