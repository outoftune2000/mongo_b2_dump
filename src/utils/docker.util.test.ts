import { exec, ExecException, ChildProcess, ExecOptions } from 'child_process';
import { DockerError, execInContainer, copyFromContainer, isContainerRunning } from './docker.util';
import { execInContainer as execInContainerUtil } from './docker.util';

type ExecCallback = (error: ExecException | null, stdout: string | Buffer, stderr: string | Buffer) => void;

// Mock child_process.exec
jest.mock('child_process', () => ({
  exec: jest.fn()
}));

jest.mock('../utils/logger.util', () => ({
  info: jest.fn(),
  error: jest.fn()
}));

describe('Docker Utilities', () => {
  const mockExec = exec as jest.MockedFunction<typeof exec>;
  const containerName = 'test-container';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('execInContainer', () => {
    test('should execute command successfully', async () => {
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(null, 'test output', '');
        }
        return {} as any;
      });

      const result = await execInContainer(containerName, 'echo "test"');

      expect(result).toBe('test output');
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining(`docker exec ${containerName}`),
        expect.any(Object),
        expect.any(Function)
      );
    }, 30000);

    test('should handle stderr output', async () => {
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(null, 'test output', 'warning message');
        }
        return {} as any;
      });

      const result = await execInContainer(containerName, 'echo "test" >&2');

      expect(result).toBe('test output');
    }, 30000);

    test('should throw DockerError on failure', async () => {
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(new Error('Command failed'), '', '');
        }
        return {} as any;
      });

      await expect(execInContainer(containerName, 'invalid-command'))
        .rejects.toThrow('Command failed');
    }, 30000);
  });

  describe('copyFromContainer', () => {
    test('should copy file successfully', async () => {
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(null, '', '');
        }
        return {} as any;
      });

      await copyFromContainer(containerName, '/path/in/container', '/path/on/host');

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining(`docker cp ${containerName}:/path/in/container /path/on/host`),
        expect.any(Object),
        expect.any(Function)
      );
    }, 30000);

    test('should throw DockerError on failure', async () => {
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(new Error('Copy failed'), '', '');
        }
        return {} as any;
      });

      await expect(copyFromContainer(containerName, '/nonexistent', '/path/on/host'))
        .rejects.toThrow('Copy failed');
    }, 30000);
  });

  describe('isContainerRunning', () => {
    test('should return true for running container', async () => {
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(null, containerName, '');
        }
        return {} as any;
      });

      const result = await isContainerRunning(containerName);

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('docker ps'),
        expect.any(Object),
        expect.any(Function)
      );
    }, 30000);

    test('should return false for non-running container', async () => {
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(null, '', '');
        }
        return {} as any;
      });

      const result = await isContainerRunning(containerName);

      expect(result).toBe(false);
    }, 30000);

    test('should throw DockerError on failure', async () => {
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(new Error('Docker ps failed'), '', '');
        }
        return {} as any;
      });

      await expect(isContainerRunning(containerName))
        .rejects.toThrow('Docker ps failed');
    }, 30000);
  });
}); 