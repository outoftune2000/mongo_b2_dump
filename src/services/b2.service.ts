import axios, { AxiosError } from 'axios';
import logger from '../utils/logger.util';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { createHash } from 'crypto';
import { Readable } from 'stream';

interface B2AuthResponse {
  accountId: string;
  authorizationToken: string;
  apiInfo: {
    storageApi: {
      apiUrl: string;
      downloadUrl: string;
      allowed: {
        buckets: B2Bucket[];
        capabilities: string[];
        namePrefix: string | null;
      };
    };
  };
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
  id: string;
  name: string | null;
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

interface B2DownloadAuthResponse {
  authorizationToken: string;
}

export class B2Error extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = 'B2Error';
  }
}

export class B2Service {
  private applicationKeyId: string;
  private applicationKey: string;
  private bucketId: string;
  private authToken: string | null = null;
  private apiUrl: string | null = null;
  private downloadUrl: string | null = null;
  private readonly CHUNK_SIZE = 100 * 1024 * 1024; // 100MB chunks
  private readonly maxRetries: number = 5; // Increased from 3 to 5
  private readonly retryDelay: number = 1000;
  private readonly maxBackoffDelay: number = 30000; // 30 seconds

  constructor(
    applicationKeyId: string,
    applicationKey: string,
    bucketId: string,
    maxRetries: number = 3,
    retryDelay: number = 1000
  ) {
    this.applicationKeyId = applicationKeyId;
    this.applicationKey = applicationKey;
    this.bucketId = bucketId;
    this.maxRetries = maxRetries;
    this.retryDelay = retryDelay;

    // Debug logging in constructor
    logger.info('B2Service initialized with:', {
      keyIdLength: this.applicationKeyId.length,
      keyLength: this.applicationKey.length,
      bucketId: this.bucketId,
      envVars: {
        B2_KEY_ID: process.env.B2_KEY_ID ? 'set' : 'not set',
        B2_KEY: process.env.B2_KEY ? 'set' : 'not set',
        B2_BUCKET_ID: process.env.B2_BUCKET_ID ? 'set' : 'not set'
      }
    });
  }

  async authenticate(): Promise<void> {
    try {
      logger.info('Attempting B2 authentication with:', {
        keyIdLength: this.applicationKeyId.length,
        keyLength: this.applicationKey.length,
        bucketId: this.bucketId,
        envVars: {
          B2_KEY_ID: process.env.B2_KEY_ID ? 'set' : 'not set',
          B2_KEY: process.env.B2_KEY ? 'set' : 'not set',
          B2_BUCKET_ID: process.env.B2_BUCKET_ID ? 'set' : 'not set'
        }
      });

      if (!this.applicationKeyId || !this.applicationKey) {
        throw new Error('B2 credentials not configured');
      }

      // Use the exact same logic as test_upload.js
      const auth = Buffer.from(`${this.applicationKeyId}:${this.applicationKey}`).toString('base64');
      const authRes = await axios.get('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
        headers: { 'Authorization': `Basic ${auth}` }
      });
      const { authorizationToken, apiUrl, downloadUrl } = authRes.data;
      this.authToken = authorizationToken;
      this.apiUrl = apiUrl;
      this.downloadUrl = downloadUrl;

      logger.info('Successfully authenticated with B2', {
        apiUrl: this.apiUrl,
        downloadUrl: this.downloadUrl,
        bucketId: this.bucketId
      });
    } catch (error) {
      logger.error('Failed to authenticate with B2', {
        error: typeof error === 'object' && error !== null && 'response' in error ? (error as any).response?.data : error,
        keyIdLength: this.applicationKeyId.length,
        keyLength: this.applicationKey.length,
        bucketId: this.bucketId,
        envVars: {
          B2_KEY_ID: process.env.B2_KEY_ID ? 'set' : 'not set',
          B2_KEY: process.env.B2_KEY ? 'set' : 'not set',
          B2_BUCKET_ID: process.env.B2_BUCKET_ID ? 'set' : 'not set'
        }
      });
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
        (b) => b.id === this.bucketId
      );

      if (!bucket) {
        throw new B2Error(`Bucket with ID ${this.bucketId} not found`);
      }
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

  private formatErrorData(data: any): string {
    if (!data) return 'No error data';
    
    // If it's a string, return it directly
    if (typeof data === 'string') return data;
    
    // If it's an object, extract the most relevant information
    if (typeof data === 'object') {
      const relevantInfo: Record<string, any> = {
        code: data.code,
        status: data.status,
        message: data.message,
        // Only include the first few items if it's an array
        data: Array.isArray(data.data) ? data.data.slice(0, 3) : data.data
      };
      
      // Remove undefined/null values
      Object.keys(relevantInfo).forEach(key => 
        relevantInfo[key] === undefined && delete relevantInfo[key]
      );
      
      return JSON.stringify(relevantInfo, null, 2);
    }
    
    return 'Unknown error format';
  }

  private async handleUploadError(error: unknown, attempt: number, fileName: string): Promise<boolean> {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const data = error.response?.data;
      
      // Format error data to be more concise
      const formattedError = this.formatErrorData(data);
      
      logger.error('B2 upload error', {
        fileName,
        attempt,
        status,
        error: formattedError,
        // Only log essential headers
        headers: error.response?.headers ? {
          'content-type': error.response.headers['content-type'],
          'x-bz-upload-timestamp': error.response.headers['x-bz-upload-timestamp']
        } : undefined
      });

      // Handle specific error cases
      if (status === 400) {
        if (data?.code === 'bad_request') {
          logger.error('Invalid request parameters', { 
            fileName, 
            error: formattedError 
          });
          return false; // Don't retry bad requests
        }
        if (data?.code === 'expired_auth_token') {
          logger.info('Auth token expired, re-authenticating...');
          await this.authenticate();
          return true; // Retry after re-authentication
        }
      }
      
      if (status === 401) {
        logger.info('Unauthorized, re-authenticating...');
        await this.authenticate();
        return true; // Retry after re-authentication
      }

      if (status === 429) {
        logger.warn('Rate limited, will retry with backoff');
        return true; // Retry with backoff
      }

      // For server errors (5xx), always retry
      if (status && status >= 500) {
        logger.warn('Server error, will retry');
        return true;
      }
    }

    // For network errors or unknown errors, retry
    return true;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async uploadFile(filePath: string, fileName: string): Promise<B2File> {
    if (!this.isAuthenticated()) {
      throw new B2Error('Not authenticated with B2');
    }

    // Check if file already exists
    const exists = await this.fileExists(fileName);
    if (exists) {
      logger.info('File already exists in B2, skipping upload', { fileName });
      // Return the existing file info
      const files = await this.listExistingFiles(fileName);
      const existingFile = files.find(file => file.fileName === fileName);
      if (existingFile) {
        return existingFile;
      }
    }

    let retries = 0;
    let lastError: Error | null = null;

    while (retries <= this.maxRetries) {
      try {
        const fileStats = await stat(filePath);
        const fileSize = fileStats.size;

        logger.info('Starting file upload', {
          fileName,
          fileSize,
          attempt: retries + 1
        });

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
          
          // Calculate SHA1 hash first
          const fileBuffer = await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            const stream = createReadStream(filePath);
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
          });
          
          const sha1 = createHash('sha1').update(fileBuffer).digest('hex');
          
          // Now upload with the hash
          const response = await axios.post<B2File>(
            uploadUrl,
            fileBuffer,
            {
              headers: {
                Authorization: authorizationToken,
                'Content-Type': 'b2/x-auto',
                'Content-Length': fileSize.toString(),
                'X-Bz-File-Name': fileName,
                'X-Bz-Content-Sha1': sha1
              }
            }
          );

          logger.info('Successfully uploaded file', {
            fileName,
            fileSize,
            fileId: response.data.fileId
          });

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
          logger.info(`Uploaded part ${partNumber} of ${totalParts}`, {
            fileName,
            partNumber,
            totalParts,
            partSize: chunk.length
          });
        }

        await this.finishLargeFile(fileId, partSha1Array);
        
        logger.info('Successfully uploaded large file', {
          fileName,
          fileSize,
          fileId,
          totalParts
        });

        return {
          fileName,
          fileId,
          contentLength: fileSize,
          contentSha1: partSha1Array.join(''),
          uploadTimestamp: Date.now()
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        // Check if we should retry
        const shouldRetry = await this.handleUploadError(error, retries + 1, fileName);
        
        if (!shouldRetry) {
          throw new B2Error(`Upload failed and should not be retried: ${lastError.message}`);
        }

        if (retries < this.maxRetries) {
          // Calculate exponential backoff with jitter
          const backoffDelay = Math.min(
            this.retryDelay * Math.pow(2, retries) * (0.5 + Math.random()),
            this.maxBackoffDelay
          );
          
          logger.warn(`Upload attempt ${retries + 1} failed, retrying in ${Math.round(backoffDelay/1000)}s`, {
            fileName,
            error: lastError.message,
            nextAttempt: retries + 2
          });

          await this.sleep(backoffDelay);
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
              maxFileCount: 1000,
              delimiter: '/' // Add delimiter to handle folders
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

  /**
   * Checks if a file already exists in the bucket
   * @param fileName The name of the file to check
   * @returns true if the file exists, false otherwise
   */
  async fileExists(fileName: string): Promise<boolean> {
    try {
      const files = await this.listExistingFiles(fileName);
      return files.some(file => file.fileName === fileName);
    } catch (error) {
      logger.error('Failed to check if file exists', { fileName, error });
      throw new B2Error(
        error instanceof Error ? error.message : 'Failed to check if file exists'
      );
    }
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

  /**
   * Gets a download authorization token for a private bucket
   */
  private async getDownloadAuthorization(fileNamePrefix: string, validDurationInSeconds = 600): Promise<string> {
    try {
      const response = await axios.post<B2DownloadAuthResponse>(
        `${this.getApiUrl()}/b2api/v2/b2_get_download_authorization`,
        {
          bucketId: this.bucketId,
          fileNamePrefix,
          validDurationInSeconds
        },
        {
          headers: this.getAuthHeaders()
        }
      );
      return response.data.authorizationToken;
    } catch (error) {
      logger.error('Failed to get download authorization', { error });
      throw new B2Error(
        error instanceof Error ? error.message : 'Failed to get download authorization'
      );
    }
  }

  /**
   * Downloads a file from B2
   */
  async downloadFile(fileName: string): Promise<Readable> {
    try {
      const downloadToken = await this.getDownloadAuthorization(fileName);
      const url = `${this.getDownloadUrl()}/file/${this.bucketId}/${fileName}?Authorization=${downloadToken}`;
      
      const response = await axios.get(url, {
        responseType: 'stream'
      });
      
      return response.data;
    } catch (error: unknown) {
      logger.error('Failed to download file', { 
        fileName,
        error: error instanceof Error ? error.message : 'Unknown error',
        response: error instanceof Error && 'response' in error ? (error as any).response?.data : undefined
      });
      throw new B2Error(
        error instanceof Error ? error.message : 'Failed to download file from B2'
      );
    }
  }

  /**
   * Downloads a byte range from a B2 file
   */
  async downloadFileRange(fileName: string, start: number, end: number): Promise<Buffer> {
    try {
      const downloadToken = await this.getDownloadAuthorization(fileName);
      const url = `${this.getDownloadUrl()}/file/${this.bucketId}/${fileName}?Authorization=${downloadToken}`;
      
      const response = await axios.get(url, {
        headers: {
          Range: `bytes=${start}-${end}`
        },
        responseType: 'arraybuffer'
      });
      
      return Buffer.from(response.data);
    } catch (error: unknown) {
      logger.error('Failed to download file range', { 
        fileName,
        range: `${start}-${end}`,
        error: error instanceof Error ? error.message : 'Unknown error',
        response: error instanceof Error && 'response' in error ? (error as any).response?.data : undefined
      });
      throw new B2Error(
        error instanceof Error ? error.message : 'Failed to download file range from B2'
      );
    }
  }
} 