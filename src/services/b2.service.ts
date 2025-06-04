import axios from 'axios';
import logger from '../utils/logger.util';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { createHash } from 'crypto';

interface B2AuthResponse {
  accountId: string;
  authorizationToken: string;
  apiUrl: string;
  downloadUrl: string;
  recommendedPartSize: number;
  absoluteMinimumPartSize: number;
}

interface B2File {
  fileName: string;
  fileId: string;
  contentLength: number;
  contentSha1: string;
  uploadTimestamp: number;
}

interface B2ListFilesResponse {
  files: B2File[];
  nextFileName: string | null;
}

interface B2Bucket {
  bucketId: string;
  bucketName: string;
}

interface B2ListBucketsResponse {
  buckets: B2Bucket[];
}

interface B2UploadPartUrlResponse {
  uploadUrl: string;
  authorizationToken: string;
}

interface B2StartLargeFileResponse {
  fileId: string;
  fileName: string;
  accountId: string;
  bucketId: string;
  contentType: string;
}

export class B2Error extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = 'B2Error';
  }
}

export class B2Service {
  private authToken: string | null = null;
  private apiUrl: string | null = null;
  private downloadUrl: string | null = null;
  private bucketId: string | null = null;
  private readonly CHUNK_SIZE = 100 * 1024 * 1024; // 100MB chunks

  constructor(
    private readonly applicationKeyId: string,
    private readonly applicationKey: string,
    private readonly bucketName: string,
    private readonly maxRetries: number = 3,
    private readonly retryDelay: number = 1000
  ) {}

  async authenticate(): Promise<void> {
    try {
      const authString = Buffer.from(`${this.applicationKeyId}:${this.applicationKey}`).toString('base64');
      
      const response = await axios.get<B2AuthResponse>(
        'https://api.backblazeb2.com/b2api/v2/b2_authorize_account',
        {
          headers: {
            'Authorization': `Basic ${authString}`
          }
        }
      );

      const { authorizationToken, apiUrl, downloadUrl } = response.data;
      this.authToken = authorizationToken;
      this.apiUrl = apiUrl;
      this.downloadUrl = downloadUrl;

      // Get bucket ID after authentication
      await this.getBucketId();

      logger.info('Successfully authenticated with B2');
    } catch (error) {
      logger.error('Failed to authenticate with B2', { error });
      throw new B2Error(
        error instanceof Error ? error.message : 'Failed to authenticate with B2'
      );
    }
  }

  private async getBucketId(): Promise<void> {
    try {
      const response = await axios.get<B2ListBucketsResponse>(
        `${this.getApiUrl()}/b2api/v2/b2_list_buckets`,
        {
          headers: this.getAuthHeaders(),
          params: {
            accountId: this.applicationKeyId
          }
        }
      );

      const bucket = response.data.buckets.find(
        (b) => b.bucketName === this.bucketName
      );

      if (!bucket) {
        throw new B2Error(`Bucket ${this.bucketName} not found`);
      }

      this.bucketId = bucket.bucketId;
    } catch (error) {
      logger.error('Failed to get bucket ID', { error });
      throw new B2Error(
        error instanceof Error ? error.message : 'Failed to get bucket ID'
      );
    }
  }

  private async startLargeFileUpload(fileName: string): Promise<B2StartLargeFileResponse> {
    const response = await axios.post<B2StartLargeFileResponse>(
      `${this.getApiUrl()}/b2api/v2/b2_start_large_file`,
      {
        bucketId: this.bucketId,
        fileName,
        contentType: 'b2/x-auto'
      },
      {
        headers: this.getAuthHeaders()
      }
    );
    return response.data;
  }

  private async getUploadPartUrl(fileId: string): Promise<B2UploadPartUrlResponse> {
    const response = await axios.get<B2UploadPartUrlResponse>(
      `${this.getApiUrl()}/b2api/v2/b2_get_upload_part_url`,
      {
        headers: this.getAuthHeaders(),
        params: { fileId }
      }
    );
    return response.data;
  }

  private async uploadPart(
    uploadUrl: string,
    authorizationToken: string,
    partNumber: number,
    fileId: string,
    chunk: Buffer
  ): Promise<{ partNumber: number; contentLength: number; contentSha1: string }> {
    const sha1 = createHash('sha1').update(chunk).digest('hex');
    
    const response = await axios.post(
      uploadUrl,
      chunk,
      {
        headers: {
          'Authorization': authorizationToken,
          'Content-Type': 'b2/x-auto',
          'Content-Length': chunk.length.toString(),
          'X-Bz-Part-Number': partNumber.toString(),
          'X-Bz-Content-Sha1': sha1
        }
      }
    );
    
    return {
      partNumber,
      contentLength: chunk.length,
      contentSha1: sha1
    };
  }

  private async finishLargeFile(fileId: string, partSha1Array: string[]): Promise<void> {
    await axios.post(
      `${this.getApiUrl()}/b2api/v2/b2_finish_large_file`,
      {
        fileId,
        partSha1Array
      },
      {
        headers: this.getAuthHeaders()
      }
    );
  }

  async uploadFile(filePath: string, fileName: string): Promise<B2File> {
    if (!this.isAuthenticated()) {
      throw new B2Error('Not authenticated with B2');
    }

    let retries = 0;
    let lastError: Error | null = null;

    while (retries <= this.maxRetries) {
      try {
        const fileStats = await stat(filePath);
        const fileSize = fileStats.size;

        // For small files, use simple upload
        if (fileSize <= this.CHUNK_SIZE) {
          const uploadUrlResponse = await axios.get(
            `${this.getApiUrl()}/b2api/v2/b2_get_upload_url`,
            {
              headers: this.getAuthHeaders(),
              params: {
                bucketId: this.bucketId
              }
            }
          );

          const { uploadUrl, authorizationToken } = uploadUrlResponse.data;
          const fileStream = createReadStream(filePath);
          const sha1 = createHash('sha1');
          
          fileStream.on('data', (chunk) => sha1.update(chunk));
          
          const response = await axios.post<B2File>(
            uploadUrl,
            fileStream,
            {
              headers: {
                Authorization: authorizationToken,
                'Content-Type': 'b2/x-auto',
                'Content-Length': fileSize.toString(),
                'X-Bz-File-Name': fileName,
                'X-Bz-Content-Sha1': sha1.digest('hex')
              }
            }
          );

          return response.data;
        }

        // For large files, use large file upload
        const startResponse = await this.startLargeFileUpload(fileName);
        const fileId = startResponse.fileId;
        const totalParts = Math.ceil(fileSize / this.CHUNK_SIZE);
        const partSha1Array: string[] = [];

        for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
          const start = (partNumber - 1) * this.CHUNK_SIZE;
          const end = Math.min(start + this.CHUNK_SIZE, fileSize);
          const chunk = Buffer.alloc(end - start);
          
          const fileHandle = await createReadStream(filePath, { start, end });
          await new Promise<void>((resolve, reject) => {
            fileHandle.on('data', (data: string | Buffer) => {
              if (Buffer.isBuffer(data)) {
                chunk.set(data, 0);
              }
            });
            fileHandle.on('end', () => resolve());
            fileHandle.on('error', reject);
          });
          
          const uploadPartUrlResponse = await this.getUploadPartUrl(fileId);
          const partResponse = await this.uploadPart(
            uploadPartUrlResponse.uploadUrl,
            uploadPartUrlResponse.authorizationToken,
            partNumber,
            fileId,
            chunk
          );
          
          partSha1Array[partNumber - 1] = partResponse.contentSha1;
          logger.info(`Uploaded part ${partNumber} of ${totalParts}`);
        }

        await this.finishLargeFile(fileId, partSha1Array);
        
        return {
          fileName,
          fileId,
          contentLength: fileSize,
          contentSha1: partSha1Array.join(''),
          uploadTimestamp: Date.now()
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        logger.warn(`Upload attempt ${retries + 1} failed`, { error: lastError });

        if (retries < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * Math.pow(2, retries)));
          retries++;
        } else {
          break;
        }
      }
    }

    throw new B2Error(
      `Failed to upload file after ${this.maxRetries} retries: ${lastError?.message}`
    );
  }

  async listExistingFiles(prefix?: string): Promise<B2File[]> {
    if (!this.isAuthenticated()) {
      throw new B2Error('Not authenticated with B2');
    }

    const files: B2File[] = [];
    let nextFileName: string | null = null;

    do {
      try {
        const response: { data: B2ListFilesResponse } = await axios.get<B2ListFilesResponse>(
          `${this.getApiUrl()}/b2api/v2/b2_list_file_names`,
          {
            headers: this.getAuthHeaders(),
            params: {
              bucketId: this.bucketId,
              prefix,
              startFileName: nextFileName,
              maxFileCount: 1000
            }
          }
        );

        files.push(...response.data.files);
        nextFileName = response.data.nextFileName;
      } catch (error) {
        logger.error('Failed to list files', { error });
        throw new B2Error(
          error instanceof Error ? error.message : 'Failed to list files'
        );
      }
    } while (nextFileName);

    return files;
  }

  isAuthenticated(): boolean {
    return !!this.authToken && !!this.apiUrl && !!this.downloadUrl && !!this.bucketId;
  }

  getAuthHeaders(): Record<string, string> {
    if (!this.authToken) {
      throw new B2Error('Not authenticated with B2');
    }
    return {
      Authorization: this.authToken
    };
  }

  getApiUrl(): string {
    if (!this.apiUrl) {
      throw new B2Error('Not authenticated with B2');
    }
    return this.apiUrl;
  }

  getDownloadUrl(): string {
    if (!this.downloadUrl) {
      throw new B2Error('Not authenticated with B2');
    }
    return this.downloadUrl;
  }
} 