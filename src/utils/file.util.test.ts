import { calculateChecksum, ensureDirectoryExists, getFileSize, rotateBackups } from './file.util';
import { mkdir, readdir, stat, unlink } from 'fs/promises';
import { createReadStream, statSync } from 'fs';
import path from 'path';

jest.mock('fs/promises');
jest.mock('fs');
jest.mock('./logger.util', () => ({
  info: jest.fn(),
  error: jest.fn()
}));

describe('File Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateChecksum', () => {
    test('should calculate SHA-1 checksum of a file', async () => {
      const mockHash = {
        update: jest.fn(),
        digest: jest.fn().mockReturnValue('test-hash')
      };
      const mockStream = {
        on: jest.fn().mockImplementation((event, callback) => {
          if (event === 'data') callback(Buffer.from('test data'));
          if (event === 'end') callback();
          return mockStream;
        })
      };

      jest.spyOn(require('crypto'), 'createHash').mockReturnValue(mockHash);
      (createReadStream as jest.Mock).mockReturnValue(mockStream);

      const result = await calculateChecksum('test.txt');

      expect(result).toBe('test-hash');
      expect(mockHash.update).toHaveBeenCalledWith(Buffer.from('test data'));
      expect(mockHash.digest).toHaveBeenCalledWith('hex');
    });

    test('should reject on stream error', async () => {
      const mockStream = {
        on: jest.fn().mockImplementation((event, callback) => {
          if (event === 'error') callback(new Error('Stream error'));
          return mockStream;
        })
      };

      (createReadStream as jest.Mock).mockReturnValue(mockStream);

      await expect(calculateChecksum('test.txt')).rejects.toThrow('Stream error');
    });
  });

  describe('ensureDirectoryExists', () => {
    test('should create directory if it does not exist', async () => {
      await ensureDirectoryExists('/test/dir');

      expect(mkdir).toHaveBeenCalledWith('/test/dir', { recursive: true });
    });

    test('should handle mkdir error', async () => {
      const error = new Error('Permission denied');
      (mkdir as jest.Mock).mockRejectedValue(error);

      await expect(ensureDirectoryExists('/test/dir')).rejects.toThrow('Permission denied');
    });
  });

  describe('getFileSize', () => {
    test('should return file size', () => {
      const mockStats = { size: 1024 };
      (statSync as jest.Mock).mockReturnValue(mockStats);

      const size = getFileSize('test.txt');
      expect(size).toBe(1024);
    });
  });

  describe('rotateBackups', () => {
    const mockFiles = [
      'backup-2024-03-14.gz',
      'backup-2024-03-13.gz',
      'backup-2024-03-12.gz',
      'backup-2024-03-11.gz'
    ];

    const mockStats = mockFiles.map((file, index) => ({
      name: file,
      path: path.join('/backups', file),
      mtime: new Date(2024, 2, 14 - index) // March 14, 13, 12, 11
    }));

    beforeEach(() => {
      (readdir as jest.Mock).mockResolvedValue(mockFiles);
      (stat as jest.Mock).mockImplementation((filePath) => {
        const file = mockStats.find(f => f.path === filePath);
        return Promise.resolve({
          mtime: file?.mtime || new Date()
        });
      });
    });

    test('should keep files within max files limit', async () => {
      await rotateBackups('/backups', { maxFiles: 2, maxAgeDays: 30 });

      // Only the oldest 2 files should be deleted
      expect(unlink).toHaveBeenCalledTimes(2);
      expect(unlink).toHaveBeenCalledWith(path.join('/backups', 'backup-2024-03-12.gz'));
      expect(unlink).toHaveBeenCalledWith(path.join('/backups', 'backup-2024-03-11.gz'));
    });

    test('should delete files older than max age', async () => {
      // Set current date to March 15
      jest.useFakeTimers().setSystemTime(new Date(2024, 2, 15));

      await rotateBackups('/backups', { maxFiles: 10, maxAgeDays: 2 });

      // Files older than 2 days should be deleted
      expect(unlink).toHaveBeenCalledTimes(2);
      expect(unlink).toHaveBeenCalledWith(path.join('/backups', 'backup-2024-03-12.gz'));
      expect(unlink).toHaveBeenCalledWith(path.join('/backups', 'backup-2024-03-11.gz'));

      jest.useRealTimers();
    });

    test('should handle empty directory', async () => {
      (readdir as jest.Mock).mockResolvedValue([]);

      await rotateBackups('/backups', { maxFiles: 2, maxAgeDays: 30 });

      expect(unlink).not.toHaveBeenCalled();
    });

    test('should handle readdir error', async () => {
      (readdir as jest.Mock).mockRejectedValue(new Error('Failed to read directory'));

      await expect(rotateBackups('/backups', { maxFiles: 2, maxAgeDays: 30 }))
        .rejects.toThrow('Failed to read directory');
    });

    test('should handle stat error', async () => {
      (stat as jest.Mock).mockRejectedValue(new Error('Failed to get file stats'));

      await expect(rotateBackups('/backups', { maxFiles: 2, maxAgeDays: 30 }))
        .rejects.toThrow('Failed to get file stats');
    });

    test('should handle unlink error', async () => {
      (unlink as jest.Mock).mockRejectedValue(new Error('Failed to delete file'));

      await expect(rotateBackups('/backups', { maxFiles: 2, maxAgeDays: 30 }))
        .rejects.toThrow('Failed to delete file');
    });
  });
}); 