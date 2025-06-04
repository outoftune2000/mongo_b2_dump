import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../utils/logger.util';

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
      // Create a unique filename based on timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputFile = `${timestamp}.bson`;

      // Construct the mongodump command with authentication
      const command = `docker exec ${this.containerName} mongodump --uri="${this.mongoUri}" --out=/dump --authenticationDatabase=admin`;

      // Execute mongodump in the container
      await execAsync(command);

      // Copy the dump from the container to the host
      const copyCommand = `docker cp ${this.containerName}:/dump ${this.outputDir}`;
      await execAsync(copyCommand);

      // Clean up the dump in the container
      const cleanupCommand = `docker exec ${this.containerName} rm -rf /dump`;
      await execAsync(cleanupCommand);

      logger.info('Successfully created MongoDB dump', {
        container: this.containerName,
        outputDir: this.outputDir,
        uri: this.mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//****:****@') // Hide credentials in logs
      });

      return outputFile;
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