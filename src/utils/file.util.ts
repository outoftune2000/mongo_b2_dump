import { createHash } from 'crypto';
import { createReadStream, statSync } from 'fs';
import { mkdir, readdir, stat, unlink } from 'fs/promises';
import path from 'path';
import logger from './logger.util';

export async function calculateChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    const stream = createReadStream(filePath);

    stream.on('error', (err) => reject(err));
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    logger.error('Failed to create directory', { dirPath, error });
    throw error;
  }
}

export function getFileSize(filePath: string): number {
  const stats = statSync(filePath);
  return stats.size;
}

interface RetentionPolicy {
  maxAgeDays: number;
  maxFiles: number;
}

export async function rotateBackups(
  backupDir: string,
  policy: RetentionPolicy
): Promise<void> {
  try {
    const files = await readdir(backupDir);
    const backupFiles = files.filter(file => file.endsWith('.gz'));
    
    // Get file stats and sort by modification time
    const fileStats = await Promise.all(
      backupFiles.map(async (file) => {
        const filePath = path.join(backupDir, file);
        const stats = await stat(filePath);
        return {
          name: file,
          path: filePath,
          mtime: stats.mtime
        };
      })
    );

    // Sort by modification time (newest first)
    fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // Apply max files policy
    if (fileStats.length > policy.maxFiles) {
      const filesToDelete = fileStats.slice(policy.maxFiles);
      await Promise.all(
        filesToDelete.map(async (file) => {
          await unlink(file.path);
          logger.info('Deleted backup file due to max files policy', {
            fileName: file.name,
            policy: 'maxFiles',
            maxFiles: policy.maxFiles
          });
        })
      );
    }

    // Apply max age policy
    const now = new Date();
    const maxAgeMs = policy.maxAgeDays * 24 * 60 * 60 * 1000;
    
    const oldFiles = fileStats.filter(
      file => now.getTime() - file.mtime.getTime() > maxAgeMs
    );

    await Promise.all(
      oldFiles.map(async (file) => {
        await unlink(file.path);
        logger.info('Deleted backup file due to max age policy', {
          fileName: file.name,
          policy: 'maxAge',
          maxAgeDays: policy.maxAgeDays
        });
      })
    );

    logger.info('Completed backup rotation', {
      totalFiles: fileStats.length,
      deletedFiles: oldFiles.length + Math.max(0, fileStats.length - policy.maxFiles)
    });
  } catch (error) {
    logger.error('Failed to rotate backups', { error });
    throw error;
  }
} 