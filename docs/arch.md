# MongoDB to Backblaze B2 Backup System (TypeScript/Node.js)

## System Architecture

### Overview
A Node.js service that performs periodic backups of a MongoDB database running in Docker to Backblaze B2, with incremental upload capabilities.

### Directory Structure

```
mongo-b2-backup/
├── src/
│   ├── config/                 # Configuration management
│   │   └── index.ts
│   ├── services/
│   │   ├── mongo.service.ts    # MongoDB interactions
│   │   ├── b2.service.ts       # Backblaze B2 interactions
│   │   └── backup.service.ts   # Core backup logic
│   ├── utils/
│   │   ├── docker.util.ts      # Docker container helpers
│   │   ├── file.util.ts        # File system operations
│   │   └── logger.util.ts      # Logging utilities
│   ├── interfaces/             # Type definitions
│   │   ├── config.interface.ts
│   │   └── backup.interface.ts
│   └── index.ts                # Main application entry
├── scripts/
│   └── setup.sh                # Initial setup script
├── test/                       # Test files
├── docker-compose.yml          # Local development setup
├── package.json
├── tsconfig.json
└── README.md
```

## Component Breakdown

### 1. Configuration (`config/`)
**Purpose**: Centralized configuration management

**Key Files**:
- `index.ts`: Loads and validates environment variables

**State Management**:
```typescript
interface Config {
  mongo: {
    uri: string;
    containerName: string;
  };
  b2: {
    accountId: string;
    applicationKey: string;
    bucketName: string;
    bucketPath: string;
  };
  backup: {
    rootDir: string;
    retentionDays: number;
  };
}
```

### 2. Services Layer

#### a. Mongo Service (`services/mongo.service.ts`)
**Responsibilities**:
- Execute mongodump inside container
- Handle MongoDB connection errors
- Clean up temporary files in container

**Key Methods**:
```typescript
class MongoService {
  async createDump(containerName: string, uri: string): Promise<string>
  private executeDumpCommand(containerName: string, command: string): Promise<void>
}
```

#### b. B2 Service (`services/b2.service.ts`)
**Responsibilities**:
- Handle B2 authentication
- File uploads with checksum verification
- List existing remote files

**Key Methods**:
```typescript
class B2Service {
  private authToken: string;
  private apiUrl: string;
  
  async authenticate(): Promise<void>
  async listExistingFiles(bucketId: string, prefix: string): Promise<string[]>
  async uploadFile(bucketId: string, filePath: string, remotePath: string): Promise<boolean>
}
```

#### c. Backup Service (`services/backup.service.ts`)
**Responsibilities**:
- Orchestrate backup workflow
- Manage file comparisons
- Handle cleanup operations

**Key Methods**:
```typescript
class BackupService {
  async performIncrementalBackup(): Promise<BackupResult>
  private getNewFiles(localDir: string, existingFiles: string[]): FileComparison[]
  private cleanupOldBackups(): Promise<void>
}
```

### 3. Utility Modules

#### a. Docker Utilities (`utils/docker.util.ts`)
**Features**:
- Execute commands in containers
- Copy files from containers
- Container filesystem operations

#### b. File Utilities (`utils/file.util.ts`)
**Features**:
- Calculate file checksums
- Directory management
- Backup rotation

#### c. Logger (`utils/logger.util.ts`)
**Features**:
- Structured logging
- Log file rotation
- Error tracking

## Data Flow

1. **Initialization**:
   ```mermaid
   sequenceDiagram
     Main->>Config: Load configuration
     Config->>Main: Validated config
     Main->>B2Service: Authenticate
     B2Service->>Main: Auth token
   ```

2. **Backup Execution**:
   ```mermaid
   sequenceDiagram
     Main->>MongoService: Create dump
     MongoService->>DockerUtil: Execute mongodump
     DockerUtil->>MongoService: Dump complete
     MongoService->>FileUtil: Copy files from container
     FileUtil->>BackupService: Local files ready
     BackupService->>B2Service: List existing files
     B2Service->>BackupService: Existing file list
     BackupService->>FileUtil: Compare files
     FileUtil->>BackupService: New files list
     BackupService->>B2Service: Upload new files
     B2Service->>BackupService: Upload results
     BackupService->>FileUtil: Cleanup old backups
   ```

## State Management

| Component          | State Type          | Storage Location          | Lifetime         |
|--------------------|---------------------|---------------------------|------------------|
| B2 Authentication  | Ephemeral           | Memory (B2Service)        | Session          |
| Backup Metadata    | Persistent          | Local filesystem          | Across runs      |
| File Comparisons   | Transient           | Memory (BackupService)    | During operation |
| Configuration      | Immutable           | Environment variables     | Application      |

## Service Connections

1. **Dependency Injection**:
   ```typescript
   // src/index.ts
   const config = loadConfig();
   const logger = new Logger(config);
   const dockerUtil = new DockerUtil(logger);
   const fileUtil = new FileUtil(logger);
   const b2Service = new B2Service(config.b2, logger);
   const mongoService = new MongoService(config.mongo, dockerUtil, logger);
   const backupService = new BackupService(
     config.backup,
     mongoService,
     b2Service,
     fileUtil,
     logger
   );
   ```

2. **Error Handling**:
   - Services throw domain-specific errors
   - Main application handles orchestration-level errors
   - Logger captures all errors with context

## Implementation Notes

1. **Container Operations**:
   ```typescript
   // docker.util.ts
   async execInContainer(container: string, command: string): Promise<string> {
     const result = await execAsync(`docker exec ${container} ${command}`);
     return result.stdout;
   }
   ```

2. **Incremental Upload Logic**:
   ```typescript
   // backup.service.ts
   private getNewFiles(localDir: string, existingFiles: string[]): FileComparison[] {
     return fs.readdirSync(localDir)
       .filter(file => !existingFiles.includes(file))
       .map(file => ({
         localPath: path.join(localDir, file),
         remotePath: path.join(this.config.bucketPath, file),
         checksum: calculateChecksum(path.join(localDir, file))
       }));
   }
   ```

3. **B2 Upload with Retries**:
   ```typescript
   // b2.service.ts
   async uploadWithRetry(filePath: string, remotePath: string, retries = 3) {
     while (retries > 0) {
       try {
         return await this.uploadFile(filePath, remotePath);
       } catch (error) {
         retries--;
         if (retries === 0) throw error;
         await new Promise(resolve => setTimeout(resolve, 1000 * (4 - retries)));
       }
     }
   }
   ```

## Deployment Considerations

1. **Containerized Deployment**:
   ```dockerfile
   FROM node:18-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --only=production
   COPY . .
   CMD ["node", "./dist/index.js"]
   ```

2. **Cron Scheduling**:
   ```bash
   # In host machine's crontab
   0 2 * * * docker exec mongo-backup-service npm run backup
   ```

3. **Configuration Management**:
   ```bash
   # .env file
   MONGO_URI="mongodb://user:pass@localhost:27017/db"
   B2_ACCOUNT_ID="your_account_id"
   B2_APPLICATION_KEY="your_app_key"
   ```

This architecture provides a robust, maintainable solution for your MongoDB to B2 backup needs with proper separation of concerns and TypeScript type safety throughout.