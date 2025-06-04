import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../utils/logger.util';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

export class MongoError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = 'MongoError';
  }
}

export class MongoService {
  constructor(
    private readonly containerName: string,
    private readonly mongoUri: string,
    private readonly outputDir: string
  ) {
    if (!containerName) {
      throw new MongoError('MongoDB container name is required');
    }
  }

  async createDump(): Promise<string> {
    try {
      // Create a unique directory name based on timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputDir = `${this.outputDir}/${timestamp}`;

      // Ensure output directory exists
      await fs.promises.mkdir(outputDir, { recursive: true });

      // Construct the mongodump command with authentication and optimized settings for large datasets
      const command = `docker exec ${this.containerName} mongodump --uri="${this.mongoUri}" --out=/dump --authenticationDatabase=admin --numParallelCollections=4`;

      // Execute mongodump in the container using spawn with progress tracking
      await new Promise<void>((resolve, reject) => {
        const [cmd, ...args] = command.split(' ');
        const child = spawn(cmd, args, {
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let currentCollection = '';
        let documentsProcessed = 0;
        let startTime = Date.now();

        child.stdout.on('data', (data) => {
          const output = data.toString();
          // Log progress without storing in memory
          if (output.includes('writing')) {
            currentCollection = output.split('writing')[1].trim();
            logger.info(`Starting dump of collection: ${currentCollection}`);
          } else if (output.includes('done dumping')) {
            const match = output.match(/done dumping .* \((\d+) documents\)/);
            if (match) {
              documentsProcessed = parseInt(match[1], 10);
              const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
              logger.info(`Completed dumping ${currentCollection}: ${documentsProcessed} documents in ${elapsedTime}s`);
            }
          }
        });

        child.stderr.on('data', (data) => {
          const error = data.toString();
          // Only log errors, don't store in memory
          logger.error('Mongodump error:', { error });
        });

        child.on('close', (code) => {
          if (code === 0) {
            const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.info(`Mongodump completed successfully in ${totalTime}s`);
            resolve();
          } else {
            reject(new Error(`mongodump failed with code ${code}`));
          }
        });

        child.on('error', (err) => {
          reject(err);
        });
      });

      // Copy the dump from the container to the host
      logger.info('Starting to copy dump files from container...');
      const copyStartTime = Date.now();
      const copyCommand = `docker cp ${this.containerName}:/dump/. ${outputDir}`;
      await execAsync(copyCommand);
      const copyTime = ((Date.now() - copyStartTime) / 1000).toFixed(2);
      logger.info(`Successfully copied dump files from container in ${copyTime}s`);

      // Clean up the dump in the container
      try {
        const cleanupCommand = `docker exec ${this.containerName} rm -rf /dump`;
        await execAsync(cleanupCommand);
        logger.info('Successfully cleaned up dump directory in MongoDB container');
      } catch (cleanupError) {
        logger.error('Failed to clean up dump directory in MongoDB container', { 
          error: cleanupError,
          container: this.containerName 
        });
        // Don't throw here, as the backup was successful
      }

      // Get dump size
      const { stdout: sizeOutput } = await execAsync(`du -sh ${outputDir}`);
      logger.info('Successfully created MongoDB dump', {
        container: this.containerName,
        outputDir,
        size: sizeOutput.trim(),
        uri: this.mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//****:****@') // Hide credentials in logs
      });

      return outputDir;
    } catch (error) {
      logger.error('Failed to create MongoDB dump', { 
        error,
        container: this.containerName,
        uri: this.mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//****:****@') // Hide credentials in logs
      });
      throw new MongoError(
        error instanceof Error ? error.message : 'Failed to create MongoDB dump'
      );
    }
  }

  async listDumps(): Promise<string[]> {
    try {
      const { stdout } = await execAsync(`ls ${this.outputDir}/*.bson`);
      return stdout.split('\n').filter(Boolean);
    } catch (error) {
      logger.error('Failed to list MongoDB dumps', { error });
      throw new MongoError(
        error instanceof Error ? error.message : 'Failed to list MongoDB dumps'
      );
    }
  }
} 