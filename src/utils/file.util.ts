import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir } from 'fs/promises';
import logger from './logger.util';
import { promisify } from 'util';
import { pipeline } from 'stream';

const pipelineAsync = promisify(pipeline);

export async function calculateChecksum(filePath: string): Promise<string> {
  const hash = createHash('sha1');
  const fileStream = createReadStream(filePath);
  
  try {
    await pipelineAsync(fileStream, hash);
    return hash.digest('hex');
  } catch (error) {
    throw new Error(`Failed to calculate checksum for ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    logger.error('Failed to create directory', { dirPath, error });
    throw error;
  }
} 