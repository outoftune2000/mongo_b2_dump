import { MongoService, MongoError } from './mongo.service';
import { execInContainer, copyFromContainer } from '../utils/docker.util';
import { exec } from 'child_process';
import logger from '../utils/logger.util';

const mockedExec = exec as unknown as jest.Mock;

jest.mock('../utils/docker.util');
jest.mock('child_process', () => ({
  exec: jest.fn()
}));
jest.mock('../utils/logger.util', () => ({
  info: jest.fn(),
  error: jest.fn()
}));

describe('MongoService', () => {
  const containerName = 'test-mongo';
  const mongoUri = 'mongodb://user:pass@localhost:27017/testdb';
  const dumpPath = '/path/to/dumps';
  let mongoService: MongoService;

  beforeEach(() => {
    mongoService = new MongoService(containerName, mongoUri, dumpPath);
    jest.clearAllMocks();
  });

  describe('createDump', () => {
    const mockTimestamp = '2024-03-14T12-00-00-000Z';
    const expectedDumpFileName = 'testdb-2024-03-14T12-00-00-000Z.gz';
    const expectedContainerPath = `/tmp/${expectedDumpFileName}`;
    const expectedHostPath = `${dumpPath}/${expectedDumpFileName}`;

    beforeEach(() => {
      mockedExec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });
    });

    test('should create dump successfully', async () => {
      (execInContainer as jest.Mock).mockResolvedValue(undefined);
      (copyFromContainer as jest.Mock).mockResolvedValue(undefined);

      const result = await mongoService.createDump();

      expect(result).toBe(expectedHostPath);
      expect(execInContainer).toHaveBeenCalledTimes(2);
      expect(execInContainer).toHaveBeenCalledWith(
        containerName,
        `mongodump --uri="${mongoUri}" --archive="${expectedContainerPath}" --gzip`
      );
      expect(execInContainer).toHaveBeenCalledWith(
        containerName,
        `rm ${expectedContainerPath}`
      );
      expect(copyFromContainer).toHaveBeenCalledWith(
        containerName,
        expectedContainerPath,
        expectedHostPath
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Successfully created MongoDB dump',
        expect.any(Object)
      );
    });

    test('should throw MongoError when database name cannot be extracted', async () => {
      const invalidUri = 'mongodb://user:pass@localhost:27017/';
      const service = new MongoService(containerName, invalidUri, dumpPath);

      await expect(service.createDump()).rejects.toThrow(MongoError);
      expect(execInContainer).not.toHaveBeenCalled();
      expect(copyFromContainer).not.toHaveBeenCalled();
    });

    test('should throw MongoError when mongodump fails', async () => {
      const error = new Error('mongodump failed');
      mockedExec.mockImplementation((cmd, callback) => {
        callback(error, { stdout: '', stderr: 'Error: mongodump failed' });
      });

      await expect(mongoService.createDump()).rejects.toThrow('mongodump failed');
      expect(copyFromContainer).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to create MongoDB dump',
        { error }
      );
    });

    test('should throw MongoError when copy fails', async () => {
      (execInContainer as jest.Mock).mockResolvedValue(undefined);
      const error = new Error('copy failed');
      (copyFromContainer as jest.Mock).mockRejectedValue(error);

      await expect(mongoService.createDump()).rejects.toThrow(MongoError);
      expect(execInContainer).toHaveBeenCalledTimes(1);
    });

    test('should throw MongoError when cleanup fails', async () => {
      (execInContainer as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('cleanup failed'));
      (copyFromContainer as jest.Mock).mockResolvedValue(undefined);

      await expect(mongoService.createDump()).rejects.toThrow(MongoError);
      expect(execInContainer).toHaveBeenCalledTimes(2);
    });
  });

  describe('extractDatabaseName', () => {
    test('should extract database name from valid URI', () => {
      const service = new MongoService(containerName, mongoUri, dumpPath);
      const dbName = (service as any).extractDatabaseName(mongoUri);
      expect(dbName).toBe('testdb');
    });

    test('should return null for invalid URI', () => {
      const service = new MongoService(containerName, 'invalid-uri', dumpPath);
      const dbName = (service as any).extractDatabaseName('invalid-uri');
      expect(dbName).toBeNull();
    });

    test('should handle URI without database name', () => {
      const service = new MongoService(containerName, 'mongodb://localhost:27017/', dumpPath);
      const dbName = (service as any).extractDatabaseName('mongodb://localhost:27017/');
      expect(dbName).toBeNull();
    });

    test('should handle URI with trailing slash', () => {
      const service = new MongoService(containerName, 'mongodb://localhost:27017/testdb/', dumpPath);
      const dbName = (service as any).extractDatabaseName('mongodb://localhost:27017/testdb/');
      expect(dbName).toBe('testdb');
    });
  });

  describe('listDumps', () => {
    test('should list dump files successfully', async () => {
      const mockFiles = [
        '/backups/2024-03-14T12-00-00.000Z.bson',
        '/backups/2024-03-14T13-00-00.000Z.bson'
      ];
      mockedExec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: mockFiles.join('\n'), stderr: '' });
      });

      const files = await mongoService.listDumps();

      expect(files).toEqual(mockFiles);
      expect(mockedExec).toHaveBeenCalledWith(
        expect.stringContaining(`ls ${dumpPath}/*.bson`),
        expect.any(Function)
      );
    });

    test('should handle list failure', async () => {
      const error = new Error('ls failed');
      mockedExec.mockImplementation((cmd, callback) => {
        callback(error, { stdout: '', stderr: 'Error: ls failed' });
      });

      await expect(mongoService.listDumps()).rejects.toThrow('ls failed');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to list MongoDB dumps',
        { error }
      );
    });
  });
}); 