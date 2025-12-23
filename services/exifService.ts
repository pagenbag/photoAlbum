import EXIF from 'exif-js';

export interface ExifData {
    date?: Date;
    latitude?: number;
    longitude?: number;
}

export const getExifData = (file: File): Promise<ExifData> => {
  return new Promise((resolve) => {
    try {
        // EXIF.getData modifies the file object properties or reads from it, 
        // the type definition in the library is a bit loose, so we cast to any.
        EXIF.getData(file as any, function (this: any) {
            let date: Date | undefined;
            let latitude: number | undefined;
            let longitude: number | undefined;

            // --- 1. Date Extraction ---
            // Tag is usually "DateTimeOriginal" in format "YYYY:MM:DD HH:MM:SS"
            const dateStr = EXIF.getTag(this, "DateTimeOriginal");
            
            if (dateStr && typeof dateStr === 'string') {
                const parts = dateStr.split(" ");
                if (parts.length === 2) {
                    const dateParts = parts[0].split(":");
                    const timeParts = parts[1].split(":");
                    
                    if (dateParts.length === 3 && timeParts.length === 3) {
                         const d = new Date(
                            parseInt(dateParts[0]),
                            parseInt(dateParts[1]) - 1, // Month is 0-indexed
                            parseInt(dateParts[2]),
                            parseInt(timeParts[0]),
                            parseInt(timeParts[1]),
                            parseInt(timeParts[2])
                        );
                        if (!isNaN(d.getTime())) {
                            date = d;
                        }
                    }
                }
            }

            // --- 2. GPS Extraction ---
            const lat = EXIF.getTag(this, "GPSLatitude");
            const latRef = EXIF.getTag(this, "GPSLatitudeRef");
            const lon = EXIF.getTag(this, "GPSLongitude");
            const lonRef = EXIF.getTag(this, "GPSLongitudeRef");

            if (lat && latRef && lon && lonRef) {
                // Helper to convert DMS array [deg, min, sec] to Decimal Degrees
                const convertDMStoDD = (dms: number[], ref: string) => {
                    let dd = dms[0] + dms[1] / 60 + dms[2] / 3600;
                    if (ref === "S" || ref === "W") {
                        dd = dd * -1;
                    }
                    return dd;
                };

                latitude = convertDMStoDD(lat, latRef);
                longitude = convertDMStoDD(lon, lonRef);
            }
            
            resolve({ date, latitude, longitude });
        });
    } catch (e) {
        console.warn("EXIF extraction failed", e);
        // Fallback to empty data on error
        resolve({});
    }
  });
};