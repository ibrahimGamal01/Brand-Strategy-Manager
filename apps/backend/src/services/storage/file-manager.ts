import fs from 'fs';
import path from 'path';
import axios from 'axios';

const STORAGE_BASE = path.join(process.cwd(), 'storage');

export const STORAGE_PATHS = {
  clientMedia: (clientId: string, postId: string) => 
    path.join(STORAGE_BASE, 'media', 'client', clientId, postId),
  competitorMedia: (competitorId: string, postId: string) => 
    path.join(STORAGE_BASE, 'media', 'competitor', competitorId, postId),
  documents: (clientId: string) => 
    path.join(STORAGE_BASE, 'documents', clientId),
};

export const fileManager = {
  /**
   * Download media from URL and save to storage
   */
  async downloadAndSave(url: string, savePath: string, headers: Record<string, string> = {}): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Default headers to look like a browser
    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.instagram.com/',
      ...headers
    };

    // Download file
    try {
        const response = await axios.get(url, { 
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: requestHeaders
        });

        // VALIDATION: Check Content-Type
        const contentType = response.headers['content-type'];
        if (contentType && contentType.includes('text/html')) {
            throw new Error(`Invalid content type: ${contentType}. Likely a login page or error page.`);
        }

        const buffer = Buffer.from(response.data);

        // EXTRA VALIDATION: Check magic bytes for common image formats if possible, 
        // but content-type check is a good first step. 
        // HTML often starts with <DOCTYPE or <html.
        if (buffer.length > 0) {
             const head = buffer.slice(0, 10).toString('utf-8').toLowerCase();
             if (head.includes('<html') || head.includes('<!doctype') || head.includes('<body')) {
                 throw new Error('Detected HTML content in download buffer. Rejecting.');
             }
        }

        // Save to disk
        fs.writeFileSync(savePath, buffer);
        console.log(`[FileManager] Saved: ${savePath} (${buffer.length} bytes, Type: ${contentType})`);

    } catch (error: any) {
        // If it's our validation error, just throw it
        if (error.message.includes('Invalid content type') || error.message.includes('Detected HTML')) {
            throw error;
        }
        // Otherwise wrap it
        throw new Error(`Download failed for ${url}: ${error.message}`);
    }
  },

  /**
   * Save buffer to disk
   */
  saveBuffer(buffer: Buffer, savePath: string): void {
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(savePath, buffer);
    console.log(`[FileManager] Saved: ${savePath} (${buffer.length} bytes)`);
  },

  /**
   * Check if file exists
   */
  exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  },

  /**
   * Delete file
   */
  delete(filePath: string): void {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[FileManager] Deleted: ${filePath}`);
    }
  },

  /**
   * Get file stats
   */
  getStats(filePath: string) {
    if (!fs.existsSync(filePath)) return null;
    return fs.statSync(filePath);
  },

  /**
   * Convert storage path to URL for frontend
   */
  toUrl(storagePath: string): string {
    // Remove STORAGE_BASE from path to get relative path
    const relativePath = storagePath.replace(STORAGE_BASE, '');
    return `/storage${relativePath}`;
  },

  /**
   * Generate media filename
   */
  generateFilename(mediaId: string, mediaType: string, extension: string): string {
    return `${mediaId}.${extension}`;
  },

  /**
   * Get file extension from URL
   */
  getExtension(url: string): string {
    const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    if (match) return match[1];
    
    // Default extensions based on common URL patterns
    if (url.includes('jpg') || url.includes('jpeg')) return 'jpg';
    if (url.includes('png')) return 'png';
    if (url.includes('mp4')) return 'mp4';
    if (url.includes('webp')) return 'webp';
    
    return 'jpg'; // Default
  },
};
