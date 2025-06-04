import 'dotenv/config';
import { MongoService } from './services/mongo.service';
import { B2Service } from './services/b2.service';
import { BackupService } from './services/backup.service';
import logger from './utils/logger.util';
import { BackupError } from './utils/errors';

// Debug logging for environment variables
logger.info('Environment variables:', {
  B2_KEY_ID: process.env.B2_KEY_ID ? 'set' : 'not set',
  B2_KEY: process.env.B2_KEY ? 'set' : 'not set',
  B2_BUCKET_NAME: process.env.B2_BUCKET_NAME ? 'set' : 'not set'
});

const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours in milliseconds

async function performBackup(
  mongoService: MongoService,
  b2Service: B2Service,
  backupService: BackupService
) {
  try {
    // Authenticate with B2
    await b2Service.authenticate();
    logger.info('Successfully authenticated with B2');

    // Perform backup
    await backupService.performIncrementalBackup();
    logger.info('Successfully completed backup');

  } catch (error) {
    logger.error('Backup failed', { error });
    if (error instanceof BackupError) {
      process.exit(1);
    }
    throw error;
  }
}

async function main() {
  // Initialize services
  const mongoService = new MongoService(
    process.env.MONGO_CONTAINER_NAME || 'mongo',
    process.env.MONGO_URI || 'mongodb://localhost:27017',
    process.env.BACKUP_PATH || '/backup'
  );

  const b2Service = new B2Service();

  const backupService = new BackupService(
    mongoService,
    b2Service,
    process.env.BACKUP_PATH || '/backup'
  );

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown`);
    try {
      // Perform any cleanup here
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Perform initial backup immediately
  await performBackup(mongoService, b2Service, backupService);

  // Schedule subsequent backups
  setInterval(async () => {
    try {
      await performBackup(mongoService, b2Service, backupService);
    } catch (error) {
      logger.error('Scheduled backup failed', { error });
    }
  }, BACKUP_INTERVAL_MS);

  logger.info(`Backup service started. Next backup scheduled in ${BACKUP_INTERVAL_MS / (60 * 60 * 1000)} hours`);
}

// Run the application
main().catch((error) => {
  logger.error('Unhandled error', { error });
  process.exit(1);
}); 