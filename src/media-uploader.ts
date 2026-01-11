import { Vault, requestUrl } from 'obsidian';
import { SpaceApiClient } from './space-api';
import type { SpacePluginSettings } from './settings';

/**
 * Generates a simple hash from binary data for cache keys
 */
function computeHash(data: ArrayBuffer): string {
  const view = new Uint8Array(data);
  let hash = 0;
  for (let i = 0; i < view.length; i++) {
    hash = ((hash << 5) - hash) + view[i];
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Generates a unique S3 key for a file
 */
function generateS3Key(filename: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const sanitizedName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `obsidian/${timestamp}-${random}-${sanitizedName}`;
}

/**
 * Gets MIME type from filename
 */
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'mov': 'video/quicktime',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

export interface MediaUploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Uploads media to S3 or returns cached URL if already uploaded
 * Uses Obsidian's requestUrl to bypass CORS restrictions
 */
export async function getOrUploadMedia(
  vault: Vault,
  mediaPath: string,
  settings: SpacePluginSettings,
  apiClient: SpaceApiClient,
  saveSettings: () => Promise<void>
): Promise<MediaUploadResult> {
  try {
    // Resolve the file path in the vault
    let resolvedPath = mediaPath;
    const file = vault.getAbstractFileByPath(mediaPath);
    if (!file) {
      // Try to find by name if path doesn't work
      const files = vault.getFiles();
      const matchingFile = files.find(f =>
        f.path === mediaPath ||
        f.name === mediaPath ||
        f.path.endsWith('/' + mediaPath)
      );
      if (!matchingFile) {
        return { success: false, error: `File not found: ${mediaPath}` };
      }
      resolvedPath = matchingFile.path;
    }

    // Read the file
    const fileData = await vault.adapter.readBinary(resolvedPath);

    // Compute hash for cache key
    const hash = computeHash(fileData);
    const cacheKey = `${resolvedPath}:${hash}`;

    // Check cache
    if (settings.uploadedMedia[cacheKey]) {
      return { success: true, url: settings.uploadedMedia[cacheKey] };
    }

    // Get filename and content type
    const filename = resolvedPath.split('/').pop() || 'file';
    const contentType = getMimeType(filename);
    const s3Key = generateS3Key(filename);

    // Get pre-signed PUT URL from backend
    const presignedData = await apiClient.getPreSignedS3PutUrl(s3Key, contentType);

    // Upload to S3 using Obsidian's requestUrl (bypasses CORS)
    await requestUrl({
      url: presignedData.uploadUrl,
      method: 'PUT',
      body: fileData,
      headers: {
        'Content-Type': contentType,
        'x-amz-acl': 'public-read',
      },
    });

    // Cache the URL
    settings.uploadedMedia[cacheKey] = presignedData.publicUrl;
    await saveSettings();

    return { success: true, url: presignedData.publicUrl };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
