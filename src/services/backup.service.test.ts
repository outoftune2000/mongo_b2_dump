import { BackupService } from './backup.service';
import { MongoService } from './mongo.service';
import { B2Service } from './b2.service';
import { BackupError } from '../utils/errors';
import { calculateChecksum } from '../utils/file.util';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { B2File } from '../types/b2.types';
import { LocalFile } from '../types/backup.types';

jest.mock('./mongo.service');
jest.mock('./b2.service');
jest.mock('../utils/file.util');
jest.mock('fs/promises');
jest.mock('../utils/logger.util', () => ({
  info: jest.fn(),
  error: jest.fn()
}));

describe('BackupService', () => {
  const dumpPath = '/path/to/dumps';
  let backupService: BackupService;
  let mockMongoService: jest.Mocked<MongoService>;
  let mockB2Service: jest.Mocked<B2Service>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMongoService = new MongoService('test-container', 'mongodb://test', '/backup') as jest.Mocked<MongoService>;
    mockB2Service = new B2Service('test-key-id', 'test-key', 'test-bucket') as jest.Mocked<B2Service>;
    backupService = new BackupService(mockMongoService, mockB2Service, '/backup');
  });

  describe('getNewFiles', () => {
    const mockLocalFiles = ['backup1.gz', 'backup2.gz'];
    const mockRemoteFiles: B2File[] = [
      { 
        fileName: 'backup1.gz', 
        fileId: 'id1', 
        contentSha1: 'hash1',
        contentLength: 1000,
        uploadTimestamp: 1234567890
      },
      { 
        fileName: 'backup3.gz', 
        fileId: 'id3', 
        contentSha1: 'hash3',
        contentLength: 1000,
        uploadTimestamp: 1234567890
      }
    ];

    beforeEach(() => {
      (readdir as jest.Mock).mockResolvedValue(mockLocalFiles);
      (stat as jest.Mock).mockResolvedValue({ mtime: new Date() });
      (calculateChecksum as jest.Mock).mockResolvedValue('hash1');
      mockB2Service.listExistingFiles.mockResolvedValue(mockRemoteFiles);
    });

    test('should return files that do not exist in B2', async () => {
      const result = await backupService.getNewFiles();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('backup2.gz');
    });

    test('should return files with different checksums', async () => {
      (calculateChecksum as jest.Mock).mockResolvedValue('different-hash');

      const result = await backupService.getNewFiles();

      expect(result).toHaveLength(2);
      expect(result.map(f => f.name)).toEqual(['backup1.gz', 'backup2.gz']);
    });

    test('should handle empty local directory', async () => {
      (readdir as jest.Mock).mockResolvedValue([]);

      const result = await backupService.getNewFiles();

      expect(result).toHaveLength(0);
    });

    test('should handle empty remote directory', async () => {
      mockB2Service.listExistingFiles.mockResolvedValue([]);

      const result = await backupService.getNewFiles();

      expect(result).toHaveLength(2);
      expect(result.map(f => f.name)).toEqual(['backup1.gz', 'backup2.gz']);
    });

    test('should throw BackupError when listing local files fails', async () => {
      (readdir as jest.Mock).mockRejectedValue(new Error('Failed to read directory'));

      await expect(backupService.getNewFiles()).rejects.toThrow('Failed to read directory');
    });

    test('should throw BackupError when listing remote files fails', async () => {
      mockB2Service.listExistingFiles.mockRejectedValue(new Error('Failed to list files'));

      await expect(backupService.getNewFiles()).rejects.toThrow('Failed to list files');
    });
  });

  describe('performIncrementalBackup', () => {
    const mockDumpPath = '/backup/dump.gz';
    const mockNewFiles: LocalFile[] = [
      { 
        name: 'backup1.gz', 
        path: '/backup/backup1.gz',
        size: 1000,
        checksum: 'hash1',
        lastModified: new Date()
      }
    ];

    beforeEach(() => {
      mockMongoService.createDump.mockResolvedValue(mockDumpPath);
      jest.spyOn(backupService, 'getNewFiles').mockResolvedValue(mockNewFiles);
      mockB2Service.uploadFile.mockResolvedValue({
        fileName: 'backup1.gz',
        fileId: 'id1',
        contentLength: 1000,
        contentSha1: 'hash1',
        uploadTimestamp: 1234567890
      });
    });

    test('should perform incremental backup successfully', async () => {
      await backupService.performIncrementalBackup();

      expect(mockMongoService.createDump).toHaveBeenCalled();
      expect(mockB2Service.uploadFile).toHaveBeenCalledWith(
        '/backup/backup1.gz',
        'backup1.gz'
      );
    });

    test('should handle no new files', async () => {
      jest.spyOn(backupService, 'getNewFiles').mockResolvedValue([]);

      await backupService.performIncrementalBackup();

      expect(mockMongoService.createDump).toHaveBeenCalled();
      expect(mockB2Service.uploadFile).not.toHaveBeenCalled();
    });

    test('should throw BackupError when dump creation fails', async () => {
      mockMongoService.createDump.mockRejectedValue(new Error('Failed to create dump'));

      await expect(backupService.performIncrementalBackup())
        .rejects.toThrow('Failed to create dump');
    });

    test('should throw BackupError when file upload fails', async () => {
      mockB2Service.uploadFile.mockRejectedValue(new Error('Failed to upload file'));

      await expect(backupService.performIncrementalBackup())
        .rejects.toThrow('Failed to upload file');
    });
  });
}); 