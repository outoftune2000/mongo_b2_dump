import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir } from 'fs/promises';
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