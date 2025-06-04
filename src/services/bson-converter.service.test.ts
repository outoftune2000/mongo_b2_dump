import { BsonConverterService } from './bson-converter.service';
import { B2Service } from './b2.service';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.util';

jest.mock('./b2.service');
jest.mock('node:fs');
jest.mock('fs/promises');
jest.mock('../utils/logger.util', () => ({
  info: jest.fn(),
  error: jest.fn()
}));

describe('BsonConverterService', () => {
  let bsonConverter: BsonConverterService;
  let mockB2Service: jest.Mocked<B2Service>;

  beforeEach(() => {
    mockB2Service = new B2Service('key', 'secret', 'bucket') as jest.Mocked<B2Service>;
    bsonConverter = new BsonConverterService(mockB2Service);
    jest.clearAllMocks();
  });

  describe('processBsonFile', () => {
    const bsonFilePath = 'test.bson';
    const baseName = 'test';
    const tempDir = path.join(process.cwd(), 'temp', baseName);

    beforeEach(() => {
      (createReadStream as jest.Mock).mockReturnValue({
        pipe: jest.fn().mockReturnThis(),
        on: jest.fn()
      });
      (createWriteStream as jest.Mock).mockReturnValue({
        write: jest.fn(),
        end: jest.fn()
      });
      (mkdir as jest.Mock).mockResolvedValue(undefined);
      mockB2Service.uploadFile.mockResolvedValue({
        fileName: 'test.jsonl.part1',
        fileId: 'id1',
        contentLength: 1000,
        contentSha1: 'hash1',
        uploadTimestamp: 1234567890
      });
    });

    test('should process BSON file and upload parts to B2', async () => {
      await bsonConverter.processBsonFile(bsonFilePath);

      expect(mkdir).toHaveBeenCalledWith(tempDir, { recursive: true });
      expect(mockB2Service.uploadFile).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        `Successfully processed ${bsonFilePath}`,
        expect.any(Object)
      );
    });

    test('should handle errors during processing', async () => {
      const error = new Error('Processing failed');
      mockB2Service.uploadFile.mockRejectedValue(error);

      await expect(bsonConverter.processBsonFile(bsonFilePath)).rejects.toThrow('Processing failed');
      expect(logger.error).toHaveBeenCalledWith(
        `Failed to process ${bsonFilePath}`,
        { error }
      );
    });
  });

  describe('getUnprocessedBsonFiles', () => {
    const bsonFiles = ['file1.bson', 'file2.bson', 'file3.bson'];

    beforeEach(() => {
      mockB2Service.listExistingFiles.mockResolvedValue([
        { fileName: 'file1/file1.jsonl.part1', fileId: 'id1', contentLength: 1000, contentSha1: 'hash1', uploadTimestamp: 1234567890 },
        { fileName: 'file2/file2.jsonl.part1', fileId: 'id2', contentLength: 2000, contentSha1: 'hash2', uploadTimestamp: 1234567890 }
      ]);
    });

    test('should return only unprocessed BSON files', async () => {
      const unprocessed = await bsonConverter.getUnprocessedBsonFiles(bsonFiles);

      expect(unprocessed).toEqual(['file3.bson']);
      expect(mockB2Service.listExistingFiles).toHaveBeenCalled();
    });

    test('should handle empty B2 bucket', async () => {
      mockB2Service.listExistingFiles.mockResolvedValue([]);

      const unprocessed = await bsonConverter.getUnprocessedBsonFiles(bsonFiles);

      expect(unprocessed).toEqual(bsonFiles);
    });

    test('should handle B2 list error', async () => {
      mockB2Service.listExistingFiles.mockRejectedValue(new Error('B2 error'));

      await expect(bsonConverter.getUnprocessedBsonFiles(bsonFiles))
        .rejects.toThrow('B2 error');
    });
  });
}); 