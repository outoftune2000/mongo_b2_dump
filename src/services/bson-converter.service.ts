import { mkdir } from 'fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'stream';
import * as BSON from 'bson';
import path from 'path';
import { B2Service } from './b2.service';
import logger from '../utils/logger.util';

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB in bytes

interface BsonToJsonlOptions {
  inputPath: string;
  outputDir: string;
  chunkSize?: number;
}

class BsonToJsonlTransform extends Transform {
  private buffer: Buffer;
  private position: number;

  constructor() {
    super();
    this.buffer = Buffer.alloc(0);
    this.position = 0;
  }

  _transform(chunk: Buffer, encoding: string, callback: (error?: Error | null) => void) {
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      
      while (this.position + 4 <= this.buffer.length) {
        const size = this.buffer.readInt32LE(this.position);
        
        if (size < 5 || size > 16 * 1024 * 1024) {
          callback(new Error(`Invalid BSON document size: ${size} bytes`));
          return;
        }

        if (this.position + size > this.buffer.length) {
          break;
        }

        try {
          const docBuffer = this.buffer.slice(this.position, this.position + size);
          const doc = BSON.deserialize(docBuffer);
          this.push(JSON.stringify(doc) + '\n');
          this.position += size;
        } catch (error) {
          callback(new Error(`Failed to parse BSON document at position ${this.position}: ${error}`));
          return;
        }
      }

      if (this.position > 0) {
        this.buffer = this.buffer.slice(this.position);
        this.position = 0;
      }

      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  _flush(callback: (error?: Error | null) => void) {
    try {
      if (this.buffer.length > 0) {
        callback(new Error('Incomplete BSON document at end of file'));
      } else {
        callback();
      }
    } catch (error) {
      callback(error as Error);
    }
  }
}

class ChunkingTransform extends Transform {
  private currentChunk: number;
  private currentSize: number;
  private outputDir: string;
  private baseName: string;
  private currentStream: NodeJS.WritableStream | null;

  constructor(outputDir: string, baseName: string) {
    super();
    this.currentChunk = 0;
    this.currentSize = 0;
    this.outputDir = outputDir;
    this.baseName = baseName;
    this.currentStream = null;
  }

  _transform(chunk: Buffer, encoding: string, callback: (error?: Error | null) => void) {
    try {
      if (!this.currentStream || this.currentSize >= CHUNK_SIZE) {
        if (this.currentStream) {
          this.currentStream.end();
        }
        this.currentChunk++;
        this.currentSize = 0;
        const chunkPath = this.getChunkPath();
        this.currentStream = createWriteStream(chunkPath);
      }

      if (this.currentStream) {
        this.currentStream.write(chunk);
        this.currentSize += chunk.length;
      }
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  _flush(callback: (error?: Error | null) => void) {
    try {
      if (this.currentStream) {
        this.currentStream.end();
      }
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  private getChunkPath(): string {
    return path.join(this.outputDir, `${this.baseName}.jsonl.part${this.currentChunk}`);
  }

  getCurrentChunk(): number {
    return this.currentChunk;
  }
}

export class BsonConverterService {
  constructor(private readonly b2Service: B2Service) {}

  async convertBsonToJsonl({ 
    inputPath, 
    outputDir, 
    chunkSize = CHUNK_SIZE 
  }: BsonToJsonlOptions): Promise<string[]> {
    await mkdir(outputDir, { recursive: true });
    
    return new Promise((resolve, reject) => {
      const readStream = createReadStream(inputPath);
      const bsonToJsonl = new BsonToJsonlTransform();
      const baseName = path.basename(inputPath, '.bson');
      const chunking = new ChunkingTransform(outputDir, baseName);
      const outputFiles: string[] = [];

      chunking.on('finish', () => {
        // Get all generated files
        const files = Array.from({ length: chunking.getCurrentChunk() }, (_, i) => 
          path.join(outputDir, `${baseName}.jsonl.part${i + 1}`)
        );
        resolve(files);
      });

      readStream
        .pipe(bsonToJsonl)
        .pipe(chunking)
        .on('error', reject);
    });
  }

  async processBsonFile(bsonFilePath: string): Promise<void> {
    const baseName = path.basename(bsonFilePath, '.bson');
    const tempDir = path.join(process.cwd(), 'temp', baseName);

    try {
      // Convert BSON to JSONL parts
      const outputFiles = await this.convertBsonToJsonl({
        inputPath: bsonFilePath,
        outputDir: tempDir
      });

      // Upload each part to B2
      for (const file of outputFiles) {
        const relativePath = path.join(baseName, path.basename(file));
        await this.b2Service.uploadFile(file, relativePath);
      }

      logger.info(`Successfully processed ${bsonFilePath}`, {
        parts: outputFiles.length,
        folder: baseName
      });
    } catch (error) {
      logger.error(`Failed to process ${bsonFilePath}`, { error });
      throw error;
    }
  }

  async getUnprocessedBsonFiles(bsonFiles: string[]): Promise<string[]> {
    const existingFiles = await this.b2Service.listExistingFiles();
    const processedFolders = new Set(
      existingFiles
        .map(file => file.fileName.split('/')[0])
        .filter(Boolean)
    );

    return bsonFiles.filter(file => {
      const baseName = path.basename(file, '.bson');
      return !processedFolders.has(baseName);
    });
  }
} 