import axios from 'axios';
import { B2Service, B2Error } from './b2.service';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import logger from '../utils/logger.util';
import { calculateChecksum } from '../utils/file.util';

jest.mock('axios');
jest.mock('fs');
jest.mock('fs/promises');
jest.mock('../utils/logger.util', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));
jest.mock('../utils/file.util', () => ({
  calculateChecksum: jest.fn()
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedCreateReadStream = createReadStream as jest.MockedFunction<typeof createReadStream>;
const mockedStat = stat as jest.MockedFunction<typeof stat>;
const mockCalculateChecksum = calculateChecksum as jest.MockedFunction<typeof calculateChecksum>;

describe('B2Service', () => {
  const applicationKeyId = 'test-key-id';
  const applicationKey = 'test-key';
  const bucketName = 'test-bucket';
  let b2Service: B2Service;

  beforeEach(() => {
    b2Service = new B2Service(applicationKeyId, applicationKey, bucketName);
    jest.clearAllMocks();
    mockCalculateChecksum.mockResolvedValue('test-checksum');
  });

  describe('authenticate', () => {
    const mockAuthResponse = {
      data: {
        accountId: 'test-account',
        authorizationToken: 'test-token',
        apiUrl: 'https://api.test.com',
        downloadUrl: 'https://download.test.com',
        recommendedPartSize: 1000000,
        absoluteMinimumPartSize: 5000000
      }
    };

    const mockBucketsResponse = {
      data: {
        buckets: [
          {
            bucketId: 'test-bucket-id',
            bucketName: 'test-bucket'
          }
        ]
      }
    };

    test('should authenticate successfully', async () => {
      mockedAxios.get
        .mockResolvedValueOnce(mockAuthResponse)
        .mockResolvedValueOnce(mockBucketsResponse);

      await b2Service.authenticate();

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.backblazeb2.com/b2api/v2/b2_authorize_account',
        {
          auth: {
            username: applicationKeyId,
            password: applicationKey
          }
        }
      );

      expect(b2Service.isAuthenticated()).toBe(true);
      expect(b2Service.getAuthHeaders()).toEqual({
        Authorization: 'test-token'
      });
      expect(b2Service.getApiUrl()).toBe('https://api.test.com');
      expect(b2Service.getDownloadUrl()).toBe('https://download.test.com');
    }, 30000);

    test('should throw B2Error on authentication failure', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Auth failed'));

      await expect(b2Service.authenticate()).rejects.toThrow('Auth failed');
      expect(b2Service.isAuthenticated()).toBe(false);
    }, 30000);

    test('should throw B2Error when bucket not found', async () => {
      mockedAxios.get
        .mockResolvedValueOnce(mockAuthResponse)
        .mockResolvedValueOnce({ data: { buckets: [] } });

      await expect(b2Service.authenticate()).rejects.toThrow('Bucket test-bucket not found');
      expect(b2Service.isAuthenticated()).toBe(false);
    });
  });

  describe('isAuthenticated', () => {
    test('should return false before authentication', () => {
      expect(b2Service.isAuthenticated()).toBe(false);
    });

    test('should return true after successful authentication', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            accountId: 'test-account',
            authorizationToken: 'test-token',
            apiUrl: 'https://api.test.com',
            downloadUrl: 'https://download.test.com',
            recommendedPartSize: 1000000,
            absoluteMinimumPartSize: 5000000
          }
        })
        .mockResolvedValueOnce({
          data: {
            buckets: [
              {
                bucketId: 'test-bucket-id',
                bucketName: 'test-bucket'
              }
            ]
          }
        });

      await b2Service.authenticate();
      expect(b2Service.isAuthenticated()).toBe(true);
    });
  });

  describe('getAuthHeaders', () => {
    test('should throw B2Error when not authenticated', () => {
      expect(() => b2Service.getAuthHeaders()).toThrow(B2Error);
    });

    test('should return auth headers after successful authentication', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            accountId: 'test-account',
            authorizationToken: 'test-token',
            apiUrl: 'https://api.test.com',
            downloadUrl: 'https://download.test.com',
            recommendedPartSize: 1000000,
            absoluteMinimumPartSize: 5000000
          }
        })
        .mockResolvedValueOnce({
          data: {
            buckets: [
              {
                bucketId: 'test-bucket-id',
                bucketName: 'test-bucket'
              }
            ]
          }
        });

      await b2Service.authenticate();
      expect(b2Service.getAuthHeaders()).toEqual({
        Authorization: 'test-token'
      });
    });
  });

  describe('getApiUrl', () => {
    test('should throw B2Error when not authenticated', () => {
      expect(() => b2Service.getApiUrl()).toThrow(B2Error);
    });

    test('should return api url after successful authentication', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            accountId: 'test-account',
            authorizationToken: 'test-token',
            apiUrl: 'https://api.test.com',
            downloadUrl: 'https://download.test.com',
            recommendedPartSize: 1000000,
            absoluteMinimumPartSize: 5000000
          }
        })
        .mockResolvedValueOnce({
          data: {
            buckets: [
              {
                bucketId: 'test-bucket-id',
                bucketName: 'test-bucket'
              }
            ]
          }
        });

      await b2Service.authenticate();
      expect(b2Service.getApiUrl()).toBe('https://api.test.com');
    });
  });

  describe('getDownloadUrl', () => {
    test('should throw B2Error when not authenticated', () => {
      expect(() => b2Service.getDownloadUrl()).toThrow(B2Error);
    });

    test('should return download url after successful authentication', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            accountId: 'test-account',
            authorizationToken: 'test-token',
            apiUrl: 'https://api.test.com',
            downloadUrl: 'https://download.test.com',
            recommendedPartSize: 1000000,
            absoluteMinimumPartSize: 5000000
          }
        })
        .mockResolvedValueOnce({
          data: {
            buckets: [
              {
                bucketId: 'test-bucket-id',
                bucketName: 'test-bucket'
              }
            ]
          }
        });

      await b2Service.authenticate();
      expect(b2Service.getDownloadUrl()).toBe('https://download.test.com');
    });
  });

  describe('listExistingFiles', () => {
    const mockFilesResponse = {
      data: {
        files: [
          {
            fileName: 'test1.gz',
            fileId: 'id1',
            contentLength: 1000,
            contentSha1: 'hash1',
            uploadTimestamp: 1234567890
          }
        ],
        nextFileName: null
      }
    };

    beforeEach(async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            accountId: 'test-account',
            authorizationToken: 'test-token',
            apiUrl: 'https://api.test.com',
            downloadUrl: 'https://download.test.com',
            recommendedPartSize: 1000000,
            absoluteMinimumPartSize: 5000000
          }
        })
        .mockResolvedValueOnce({
          data: {
            buckets: [
              {
                bucketId: 'test-bucket-id',
                bucketName: 'test-bucket'
              }
            ]
          }
        });

      await b2Service.authenticate();
    });

    test('should list files successfully', async () => {
      mockedAxios.get.mockResolvedValueOnce(mockFilesResponse);

      const files = await b2Service.listExistingFiles();

      expect(files).toHaveLength(1);
      expect(files[0].fileName).toBe('test1.gz');
    });

    test('should handle pagination', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            files: [{ fileName: 'file1.txt', fileId: 'id1', contentLength: 100, contentSha1: 'hash1', uploadTimestamp: 1234567890 }],
            nextFileName: 'file2.txt'
          }
        })
        .mockResolvedValueOnce({
          data: {
            files: [{ fileName: 'file2.txt', fileId: 'id2', contentLength: 200, contentSha1: 'hash2', uploadTimestamp: 1234567890 }],
            nextFileName: null
          }
        });

      const files = await b2Service.listExistingFiles();

      expect(files).toHaveLength(2);
      expect(files[0].fileName).toBe('file1.txt');
      expect(files[1].fileName).toBe('file2.txt');
    });

    test('should throw B2Error when not authenticated', async () => {
      const unauthenticatedService = new B2Service(applicationKeyId, applicationKey, bucketName);
      await expect(unauthenticatedService.listExistingFiles()).rejects.toThrow('Not authenticated with B2');
    });

    test('should throw B2Error on list failure', async () => {
      (mockedAxios.get as jest.Mock).mockRejectedValue(new Error('List failed'));

      await expect(b2Service.listExistingFiles()).rejects.toThrow('List failed');
    });
  });

  describe('uploadFile', () => {
    const filePath = 'test.txt';
    const fileName = 'test.txt';
    const mockUploadUrl = {
      data: {
        uploadUrl: 'https://upload.test.com',
        authorizationToken: 'test-token'
      }
    };

    const mockUploadResponse = {
      data: {
        fileName: 'test.txt',
        fileId: 'test-file-id',
        contentLength: 1000,
        contentSha1: 'test-hash',
        uploadTimestamp: 1234567890
      }
    };

    beforeEach(async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            accountId: 'test-account',
            authorizationToken: 'test-token',
            apiUrl: 'https://api.test.com',
            downloadUrl: 'https://download.test.com',
            recommendedPartSize: 1000000,
            absoluteMinimumPartSize: 5000000
          }
        })
        .mockResolvedValueOnce({
          data: {
            buckets: [
              {
                bucketId: 'test-bucket-id',
                bucketName: 'test-bucket'
              }
            ]
          }
        });
      await b2Service.authenticate();
      mockedStat.mockResolvedValue({
        size: 1000,
        isFile: () => true,
        isDirectory: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        dev: 0,
        ino: 0,
        mode: 0,
        nlink: 0,
        uid: 0,
        gid: 0,
        rdev: 0,
        blksize: 0,
        blocks: 0,
        atimeMs: 0,
        mtimeMs: 0,
        ctimeMs: 0,
        birthtimeMs: 0,
        atime: new Date(),
        mtime: new Date(),
        ctime: new Date(),
        birthtime: new Date()
      });
      mockedCreateReadStream.mockReturnValue({} as any);
    });

    test('should upload file successfully', async () => {
      mockedAxios.get.mockResolvedValueOnce(mockUploadUrl);
      mockedAxios.post.mockResolvedValueOnce(mockUploadResponse);

      const result = await b2Service.uploadFile(filePath, fileName);

      expect(result).toEqual(mockUploadResponse.data);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://upload.test.com',
        expect.any(Object),
        {
          headers: {
            Authorization: 'test-token',
            'Content-Type': 'b2/x-auto',
            'Content-Length': '1000',
            'X-Bz-File-Name': fileName,
            'X-Bz-Content-Sha1': 'test-checksum'
          }
        }
      );
    }, 30000);

    test('should retry on failure', async () => {
      // Mock initial upload failure
      mockedAxios.post.mockRejectedValueOnce(new Error('Upload failed'));
      
      // Mock new upload URL request
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          uploadUrl: 'https://upload.test.com/new',
          authorizationToken: 'test-token'
        }
      });
      
      // Mock successful retry
      mockedAxios.post.mockResolvedValueOnce({
        data: { fileId: 'test-file-id' }
      });

      const result = await b2Service.uploadFile(filePath, fileName);

      expect(result).toBe('test-file-id');
      expect(mockedAxios.post).toHaveBeenCalledTimes(5); // auth + bucket + 2 upload URLs + 1 successful upload
    }, 30000);

    test('should throw B2Error after max retries', async () => {
      // Mock repeated upload failures
      mockedAxios.post.mockRejectedValue(new Error('Upload failed'));

      await expect(b2Service.uploadFile(filePath, fileName))
        .rejects.toThrow('Failed to upload file after 3 attempts');
    }, 30000);

    test('should throw B2Error when not authenticated', async () => {
      const unauthenticatedService = new B2Service(applicationKeyId, applicationKey, bucketName);
      await expect(unauthenticatedService.uploadFile(filePath, fileName))
        .rejects.toThrow('Not authenticated');
    }, 30000);
  });
}); 