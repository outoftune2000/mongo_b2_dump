Here's a granular, testable step-by-step plan for building the MongoDB to B2 backup service:

### Phase 1: Foundation Setup
1. **Initialize Project**
   - [ ] Create `package.json` with TypeScript, Jest, and ESLint
   - [ ] Set up `tsconfig.json` with strict type checking
   - [ ] Create basic folder structure (src/, test/, scripts/)

2. **Configure Environment**
   - [ ] Create `.env.template` with all required variables
   - [ ] Implement `src/config/index.ts` to validate env vars
   - [ ] Write tests for config validation

### Phase 2: Core Utilities
3. **Logger Utility**
   - [ ] Implement `src/utils/logger.util.ts` with:
     - Console transport
     - File transport (rotating logs)
   - [ ] Test log formatting and file output

4. **File Utilities**
   - [ ] Create `src/utils/file.util.ts` with:
     - `calculateChecksum()` using SHA-1
     - `ensureDirectoryExists()`
   - [ ] Test checksum calculation against known files

5. **Docker Utilities**
   - [ ] Implement `src/utils/docker.util.ts` with:
     - `execInContainer()`
     - `copyFromContainer()`
   - [ ] Test with mock Docker commands

### Phase 3: Service Implementations
6. **B2 Auth Service**
   - [ ] Create `src/services/b2.service.ts` skeleton
   - [ ] Implement `authenticate()` method
   - [ ] Test auth token retrieval

7. **B2 File Operations**
   - [ ] Add `listExistingFiles()` to B2 service
   - [ ] Implement `uploadFile()` with retry logic
   - [ ] Test file listing with mock API responses

8. **MongoDB Service**
   - [ ] Create `src/services/mongo.service.ts`
   - [ ] Implement `createDump()` using docker util
   - [ ] Test container command execution

### Phase 4: Backup Logic
9. **File Comparison**
   - [ ] Implement `getNewFiles()` in backup service
   - [ ] Test with mock local/remote file lists

10. **Backup Orchestration**
    - [ ] Create core `performIncrementalBackup()` flow
    - [ ] Test full backup sequence with mocks

### Phase 5: Operational Features
11. **Cleanup System**
    - [ ] Implement backup rotation in `file.util.ts`
    - [ ] Test retention policy enforcement

12. **Error Handling**
    - [ ] Add custom error classes
    - [ ] Implement error recovery in services

### Phase 6: Integration
13. **Main Application**
    - [ ] Create `src/index.ts` entry point
    - [ ] Implement graceful shutdown

14. **Docker Integration**
    - [ ] Create `Dockerfile` for service
    - [ ] Set up `docker-compose.yml` for testing

### Phase 7: Testing & Validation
15. **Unit Test Coverage**
    - [ ] Achieve 100% service layer coverage
    - [ ] Mock all external dependencies

16. **Integration Testing**
    - [ ] Test with live Docker container
    - [ ] Validate B2 uploads in sandbox

### Phase 8: Deployment Prep
17. **Build Scripts**
    - [ ] Create production build script
    - [ ] Add health check endpoint

18. **Documentation**
    - [ ] Write README with usage examples
    - [ ] Document all env variables

### Task Breakdown Example (for B2 Service):

**Task B2-03: Implement File Upload with Retry**
```
1. Create uploadFile() method signature
2. Add SHA-1 header calculation
3. Implement initial POST request
4. Add retry loop with exponential backoff
5. Write test for successful upload
6. Write test for failed upload with retry
7. Test with mock 503 responses
8. Verify checksum validation
```

**Task MONGO-02: Container Dump Execution**
```
1. Create createDump() method shell
2. Build docker exec command string
3. Add error handling for container not found
4. Test with mock container
5. Verify command string formatting
6. Test with invalid MongoDB URI
7. Add timeout handling
8. Verify cleanup executes on failure
```

Each task:
- Takes <2 hours to complete
- Has clear input/output definitions
- Includes verification steps
- Can be independently tested
- Has associated acceptance criteria
