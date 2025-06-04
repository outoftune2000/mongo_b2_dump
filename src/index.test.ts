import { MongoService } from './services/mongo.service';
import { B2Service } from './services/b2.service';
import { BackupService } from './services/backup.service';
import { BackupError } from './utils/errors';

jest.mock('./services/mongo.service');
jest.mock('./services/b2.service');
jest.mock('./services/backup.service');
jest.mock('./utils/logger.util', () => ({
  info: jest.fn(),
  error: jest.fn()
}));

describe('Main Application', () => {
  let mockMongoService: jest.Mocked<MongoService>;
  let mockB2Service: jest.Mocked<B2Service>;
  let mockBackupService: jest.Mocked<BackupService>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      MONGO_CONTAINER_NAME: 'test-mongo',
      MONGO_URI: 'mongodb://localhost:27017/test',
      BACKUP_PATH: '/backup',
      B2_KEY_ID: 'test-key-id',
      B2_KEY: 'test-key',
      B2_BUCKET_NAME: 'test-bucket'
    };

    mockMongoService = new MongoService(
      'test-mongo',
      'mongodb://localhost:27017/test',
      '/backup'
    ) as jest.Mocked<MongoService>;

    mockB2Service = new B2Service(
      'test-key-id',
      'test-key',
      'test-bucket',
      3,
      1000
    ) as jest.Mocked<B2Service>;

    mockBackupService = new BackupService(
      mockMongoService,
      mockB2Service,
      '/backup'
    ) as jest.Mocked<BackupService>;
  });

  test('should perform backup successfully', async () => {
    mockB2Service.authenticate.mockResolvedValue();
    mockBackupService.performIncrementalBackup.mockResolvedValue();

    await require('./index');

    expect(mockB2Service.authenticate).toHaveBeenCalled();
    expect(mockBackupService.performIncrementalBackup).toHaveBeenCalled();
  });

  test('should handle backup error', async () => {
    mockB2Service.authenticate.mockResolvedValue();
    mockBackupService.performIncrementalBackup.mockRejectedValue(new BackupError('Backup failed'));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await require('./index');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('should handle unhandled error', async () => {
    mockB2Service.authenticate.mockRejectedValue(new Error('Unexpected error'));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await require('./index');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('should handle graceful shutdown', async () => {
    mockB2Service.authenticate.mockResolvedValue();
    mockBackupService.performIncrementalBackup.mockResolvedValue();

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await require('./index');

    // Simulate SIGTERM
    process.emit('SIGTERM');

    expect(exitSpy).toHaveBeenCalledWith(0);
  });
}); 