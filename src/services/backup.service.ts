import { MongoService } from './mongo.service';
import { B2Service } from './b2.service';
import { calculateChecksum } from '../utils/file.util';
import logger from '../utils/logger.util';
import { stat } from 'fs/promises';
import { readdir } from 'fs/promises';
import path from 'path';

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
      
      // Get list of remote files from B2
      const remoteFiles = await this.b2Service.listExistingFiles();

      // Find files that don't exist in B2 or have different checksums
      const newFiles = localFiles.filter(localFile => {
        const remoteFile = remoteFiles.find(
          remote => remote.fileName === localFile.name
        );

        if (!remoteFile) {
          return true; // File doesn't exist in B2
        }

        // Check if file has been modified
        return remoteFile.contentSha1 !== localFile.checksum;
      });

      logger.info('Found new files to backup', {
        totalFiles: localFiles.length,
        newFiles: newFiles.length
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

      // Upload each new file to B2
      for (const file of newFiles) {
        try {
          await this.b2Service.uploadFile(file.path, file.name);
          logger.info('Successfully uploaded file to B2', {
            fileName: file.name,
            filePath: file.path
          });
        } catch (error) {
          logger.error('Failed to upload file to B2', {
            fileName: file.name,
            error
          });
          throw error;
        }
      }

      logger.info('Completed incremental backup', {
        filesUploaded: newFiles.length
      });
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
          } else if (entry.isFile() && (entry.name.endsWith('.bson') || entry.name.endsWith('.metadata.json'))) {
            const stats = await stat(fullPath);
            localFiles.push({
              name: entry.name,
              path: fullPath,
              size: stats.size,
              checksum: await calculateChecksum(fullPath),
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