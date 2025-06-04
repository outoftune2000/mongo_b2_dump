import { createReadStream, createWriteStream } from 'fs';
import { Transform } from 'stream';
import * as BSON from 'bson';
import path from 'path';
import { mkdir } from 'fs/promises';

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
      // Add new chunk to buffer
      this.buffer = Buffer.concat([this.buffer, chunk]);
      
      // Process complete BSON documents
      while (this.position + 4 <= this.buffer.length) {
        // Read document size (first 4 bytes)
        const size = this.buffer.readInt32LE(this.position);
        
        // Validate size
        if (size < 5 || size > 16 * 1024 * 1024) { // Max 16MB per document
          callback(new Error(`Invalid BSON document size: ${size} bytes`));
          return;
        }

        // Check if we have enough data for the complete document
        if (this.position + size > this.buffer.length) {
          break; // Wait for more data
        }

        try {
          // Extract and parse the complete BSON document
          const docBuffer = this.buffer.slice(this.position, this.position + size);
          const doc = BSON.deserialize(docBuffer);
          this.push(JSON.stringify(doc) + '\n');
          
          // Move position to next document
          this.position += size;
        } catch (error) {
          callback(new Error(`Failed to parse BSON document at position ${this.position}: ${error}`));
          return;
        }
      }

      // Keep remaining data in buffer
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
      // Check if there's any remaining data
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
  private chunkSize: number;
  private chunkPaths: string[];

  constructor(outputDir: string, baseName: string, chunkSize: number) {
    super();
    this.currentChunk = 0;
    this.currentSize = 0;
    this.outputDir = outputDir;
    this.baseName = baseName;
    this.chunkSize = chunkSize;
    this.currentStream = null;
    this.chunkPaths = [];
  }

  _transform(chunk: Buffer, encoding: string, callback: (error?: Error | null) => void) {
    try {
      if (!this.currentStream || this.currentSize >= this.chunkSize) {
        if (this.currentStream) {
          this.currentStream.end();
        }
        this.currentChunk++;
        this.currentSize = 0;
        const chunkPath = this.getChunkPath();
        this.chunkPaths.push(chunkPath);
        this.currentStream = createWriteStream(chunkPath);
      }

      this.currentStream.write(chunk);
      this.currentSize += chunk.length;
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

  getChunkPaths(): string[] {
    return this.chunkPaths;
  }
}

export async function convertBsonToJsonlChunks({ 
  inputPath, 
  outputDir, 
  chunkSize = CHUNK_SIZE 
}: BsonToJsonlOptions): Promise<string[]> {
  // Create output directory if it doesn't exist
  await mkdir(outputDir, { recursive: true });

  // Get base name from input file
  const baseName = path.basename(inputPath, '.bson');

  return new Promise((resolve, reject) => {
    const readStream = createReadStream(inputPath);
    const bsonToJsonl = new BsonToJsonlTransform();
    const chunking = new ChunkingTransform(outputDir, baseName, chunkSize);

    readStream
      .pipe(bsonToJsonl)
      .pipe(chunking)
      .on('finish', () => resolve(chunking.getChunkPaths()))
      .on('error', reject);
  });
} 