import { calculateChecksum, ensureDirectoryExists } from './file.util';
import { createReadStream } from 'fs';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

jest.mock('fs');
jest.mock('fs/promises');
jest.mock('crypto');
jest.mock('./logger.util', () => ({
  info: jest.fn(),
  error: jest.fn()
}));

describe('File Utils', () => {
  const mockReadStream = {
    on: jest.fn(),
    pipe: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (createReadStream as jest.Mock).mockReturnValue(mockReadStream);
  });

  describe('calculateChecksum', () => {
    test('should calculate checksum successfully', async () => {
      const filePath = '/test/file.txt';
      const mockHash = {
        update: jest.fn(),
        digest: jest.fn().mockReturnValue('test-hash')
      };
      (createHash as jest.Mock).mockReturnValue(mockHash);

      const result = await calculateChecksum(filePath);

      expect(result).toBe('test-hash');
      expect(createReadStream).toHaveBeenCalledWith(filePath);
    });

    test('should handle file read error', async () => {
      const filePath = '/test/file.txt';
      const error = new Error('File read error');
      mockReadStream.on.mockImplementation((event, callback) => {
        if (event === 'error') callback(error);
        return mockReadStream;
      });

      await expect(calculateChecksum(filePath)).rejects.toThrow('File read error');
    });
  });

  describe('ensureDirectoryExists', () => {
    test('should create directory if it does not exist', async () => {
      const dirPath = join(tmpdir(), 'test-dir');
      (mkdir as jest.Mock).mockResolvedValue(undefined);

      await ensureDirectoryExists(dirPath);

      expect(mkdir).toHaveBeenCalledWith(dirPath, { recursive: true });
    });

    test('should handle directory creation error', async () => {
      const dirPath = join(tmpdir(), 'test-dir');
      const error = new Error('Directory creation failed');
      (mkdir as jest.Mock).mockRejectedValue(error);

      await expect(ensureDirectoryExists(dirPath)).rejects.toThrow('Directory creation failed');
    });
  });
}); 