import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';

const prisma = new PrismaClient();

async function updateThumbnails() {
    console.log('[UpdateThumbnails] Finding video MediaAssets without proper thumbnails...');
    
    // Find all video MediaAssets
    const videoAssets = await prisma.mediaAsset.findMany({
        where: {
            mediaType: 'VIDEO',
            isDownloaded: true,
            blobStoragePath: { not: null }
        }
    });
    
    console.log(`[UpdateThumbnails] Found ${videoAssets.length} video assets`);
    
    let updated = 0;
    
    for (const asset of videoAssets) {
        if (!asset.blobStoragePath) continue;
        
        // Generate expected thumbnail path
        const videoPath = asset.blobStoragePath;
        const thumbnailFilename = path.basename(videoPath, path.extname(videoPath)) + '_thumb.jpg';
        const expectedThumbnailPath = path.join(path.dirname(videoPath), thumbnailFilename);
        
        // Check if thumbnail file exists
        if (fs.existsSync(expectedThumbnailPath)) {
            // Update database if needed
            if (asset.thumbnailPath !== expectedThumbnailPath) {
                await prisma.mediaAsset.update({
                    where: { id: asset.id },
                    data: { thumbnailPath: expectedThumbnailPath }
                });
                console.log(`[UpdateThumbnails] Updated ${asset.id} -> ${thumbnailFilename}`);
                updated++;
            }
        } else {
            console.log(`[UpdateThumbnails] Missing thumbnail for ${asset.id}: ${expectedThumbnailPath}`);
        }
    }
    
    console.log(`[UpdateThumbnails] Updated ${updated} records`);
}

updateThumbnails()
    .catch(e => console.error('Error:', e))
    .finally(async () => await prisma.$disconnect());
