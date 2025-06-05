import { MongoService } from './mongo.service';
import { B2Service } from './b2.service';
import { calculateChecksum } from '../utils/file.util';
import { convertBsonToJsonlChunks } from '../utils/bson.util';
import logger from '../utils/logger.util';
import { stat, unlink } from 'fs/promises';
import { readdir, rm } from 'fs/promises';
import path from 'path';
import { mkdir } from 'fs/promises';

export class BackupError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = 'BackupError';
  }
}

interface LocalFile {
  name: string;
  path: string;
  size: number;
  checksum: string;
  lastModified: Date;
}

interface RemoteFile {
  fileName: string;
  contentLength: number;
  contentSha1: string;
  uploadTimestamp: number;
}

export class BackupService {
  constructor(
    private readonly mongoService: MongoService,
    private readonly b2Service: B2Service,
    private readonly dumpPath: string
  ) {}

  async getNewFiles(): Promise<LocalFile[]> {
    try {
      // Get list of local dump files
      const localFiles = await this.getLocalFiles();
      
      // Get list of remote files from B2 - single call
      const remoteFiles = await this.b2Service.listExistingFiles();

      // Create a Set of folder names from remote files for O(1) lookup
      const remoteFolders = new Set<string>();
      remoteFiles.forEach(remote => {
        const parts = remote.fileName.split('/');
        if (parts.length > 1) {
          remoteFolders.add(parts[0]);
        }
      });

      // Find files that don't exist in B2 and don't have a folder with the same name
      const newFiles = localFiles.filter(localFile => {
        const baseName = path.basename(localFile.name, '.bson');
        const remoteFile = remoteFiles.find(
          remote => remote.fileName === localFile.name
        );
        const hasFolder = remoteFolders.has(baseName);
        return !remoteFile && !hasFolder; // File doesn't exist in B2 and no folder with same name
      });

      logger.info('Found new files to backup', {
        totalFiles: localFiles.length,
        newFiles: newFiles.length,
        remoteFolders: Array.from(remoteFolders)
      });

      return newFiles;
    } catch (error) {
      logger.error('Failed to get new files', { error });
      throw new BackupError(
        error instanceof Error ? error.message : 'Failed to get new files'
      );
    }
  }

  async performIncrementalBackup(): Promise<void> {
    try {
      // Create new MongoDB dump
      const dumpPath = await this.mongoService.createDump();
      logger.info('Created new MongoDB dump', { dumpPath });

      // Get list of files to backup
      const newFiles = await this.getNewFiles();

      // Create a temporary directory for JSONL chunks
      const tempDir = path.join(this.dumpPath, 'temp_jsonl');
      await mkdir(tempDir, { recursive: true });

      // Upload each new file to B2
      for (const file of newFiles) {
        try {
          if (file.name.endsWith('.bson')) {
            // Convert BSON to JSONL chunks
            const chunkPaths = await convertBsonToJsonlChunks({
              inputPath: file.path,
              outputDir: tempDir,
              chunkSize: 10 * 1024 * 1024 // 10MB chunks
            });

            // Upload each chunk
            for (const chunkPath of chunkPaths) {
              const chunkName = path.basename(chunkPath);
              const baseName = path.basename(file.name, '.bson');
              const partNumber = chunkName.split('.').pop()?.replace('part', '');
              const remotePath = path.join(baseName, `${baseName}.jsonl.part${partNumber}`);
              await this.b2Service.uploadFile(chunkPath, remotePath);
              logger.info('Successfully uploaded JSONL chunk to B2', {
                chunkName,
                remotePath
              });
            }
          } else {
            // Skip metadata files
            logger.info('Skipping metadata file', { fileName: file.name });
          }
        } catch (error) {
          logger.error('Failed to process file', {
            fileName: file.name,
            error
          });
          throw error;
        }
      }

      logger.info('Completed incremental backup', {
        filesProcessed: newFiles.length
      });

      // Clean up the entire backups directory
      try {
        const entries = await readdir(this.dumpPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(this.dumpPath, entry.name);
          if (entry.isDirectory()) {
            await rm(fullPath, { recursive: true, force: true });
          } else {
            await unlink(fullPath);
          }
        }
        logger.info('Cleaned up backups directory', { dumpPath: this.dumpPath });
      } catch (error) {
        logger.error('Failed to clean up backups directory', {
          dumpPath: this.dumpPath,
          error
        });
        // Don't throw here, as the backup was successful
      }
    } catch (error) {
      logger.error('Failed to perform incremental backup', { error });
      throw new BackupError(
        error instanceof Error ? error.message : 'Failed to perform incremental backup'
      );
    }
  }

  private async getLocalFiles(): Promise<LocalFile[]> {
    try {
      const localFiles: LocalFile[] = [];
      const processedPaths = new Set<string>();
      
      async function scanDirectory(dirPath: string) {
        const entries = await readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          
          // Skip if we've already processed this path
          if (processedPaths.has(fullPath)) continue;
          processedPaths.add(fullPath);
          
          if (entry.isDirectory()) {
            await scanDirectory(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.bson')) {
            const stats = await stat(fullPath);
            localFiles.push({
              name: entry.name,
              path: fullPath,
              size: stats.size,
              checksum: '', // Skip checksum calculation
              lastModified: stats.mtime
            });
          }
        }
      }

      await scanDirectory(this.dumpPath);
      
      // Log unique files only
      const uniqueFiles = Array.from(new Set(localFiles.map(f => f.name)));
      logger.info('Scanned local files', { 
        totalFiles: uniqueFiles.length,
        files: uniqueFiles
      });

      return localFiles;
    } catch (error) {
      logger.error('Failed to get local files', { error });
      throw new BackupError(
        error instanceof Error ? error.message : 'Failed to get local files'
      );
    }
  }
} 