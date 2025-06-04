import { MongoService } from './services/mongo.service';
import { B2Service } from './services/b2.service';
import { BackupService } from './services/backup.service';
import { rotateBackups } from './utils/file.util';
import logger from './utils/logger.util';
import { BackupError } from './utils/errors';

async function main() {
  // Initialize services
  const mongoService = new MongoService(
    process.env.MONGO_CONTAINER_NAME || 'mongo',
    process.env.MONGO_URI || 'mongodb://localhost:27017',
    process.env.BACKUP_PATH || '/backup'
  );

  const b2Service = new B2Service(
    process.env.B2_KEY_ID || '',
    process.env.B2_KEY || '',
    process.env.B2_BUCKET_NAME || ''
  );

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

  try {
    // Authenticate with B2
    await b2Service.authenticate();
    logger.info('Successfully authenticated with B2');

    // Perform backup
    await backupService.performIncrementalBackup();
    logger.info('Successfully completed backup');

    // Rotate old backups
    await rotateBackups(process.env.BACKUP_PATH || '/backup', {
      maxFiles: parseInt(process.env.MAX_BACKUP_FILES || '30'),
      maxAgeDays: parseInt(process.env.MAX_BACKUP_AGE_DAYS || '30')
    });
    logger.info('Successfully rotated backups');

  } catch (error) {
    logger.error('Backup failed', { error });
    if (error instanceof BackupError) {
      process.exit(1);
    }
    throw error;
  }
}

// Run the application
main().catch((error) => {
  logger.error('Unhandled error', { error });
  process.exit(1);
}); 