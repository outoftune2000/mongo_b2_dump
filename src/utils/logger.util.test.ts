import * as fs from 'fs';
import * as path from 'path';
import logger from './logger.util';
import { createWriteStream } from 'fs';
import { join } from 'path';

jest.mock('fs');
jest.mock('winston', () => {
  const mockFormat = {
    combine: jest.fn().mockReturnThis(),
    timestamp: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    printf: jest.fn().mockReturnThis(),
    colorize: jest.fn().mockReturnThis()
  };

  const mockTransport = {
    Console: jest.fn().mockImplementation(() => ({
      log: jest.fn()
    })),
    File: jest.fn().mockImplementation(() => ({
      log: jest.fn()
    }))
  };

  return {
    createLogger: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }),
    format: mockFormat,
    transports: mockTransport
  };
});

describe('Logger Utility', () => {
  const mockWriteStream = {
    write: jest.fn(),
    end: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);
  });

  describe('Log Formatting', () => {
    test('should format info log with metadata', () => {
      const message = 'Test info message';
      const metadata = { key: 'value' };

      logger.info(message, metadata);

      expect(logger.info).toHaveBeenCalledWith(message, metadata);
    });

    test('should format error log with metadata', () => {
      const message = 'Test error message';
      const metadata = { error: new Error('Test error') };

      logger.error(message, metadata);

      expect(logger.error).toHaveBeenCalledWith(message, metadata);
    });

    test('should format warning log with metadata', () => {
      const message = 'Test warning message';
      const metadata = { warning: 'Test warning' };

      logger.warn(message, metadata);

      expect(logger.warn).toHaveBeenCalledWith(message, metadata);
    });

    test('should format debug log with metadata', () => {
      const message = 'Test debug message';
      const metadata = { debug: 'Test debug info' };

      logger.debug(message, metadata);

      expect(logger.debug).toHaveBeenCalledWith(message, metadata);
    });
  });

  describe('File Output', () => {
    test('should create log file in correct directory', () => {
      const logDir = 'logs';
      const logFile = join(logDir, 'app.log');

      expect(createWriteStream).toHaveBeenCalledWith(
        expect.stringContaining(logFile),
        expect.any(Object)
      );
    });

    test('should handle file write errors', () => {
      const error = new Error('Write error');
      mockWriteStream.write.mockImplementation(() => {
        throw error;
      });

      expect(() => {
        logger.info('Test message');
      }).not.toThrow();
    });
  });

  describe('Log Levels', () => {
    test('should respect log level configuration', () => {
      const message = 'Test message';
      const metadata = { test: true };

      logger.debug(message, metadata);
      logger.info(message, metadata);
      logger.warn(message, metadata);
      logger.error(message, metadata);

      expect(logger.debug).toHaveBeenCalledWith(message, metadata);
      expect(logger.info).toHaveBeenCalledWith(message, metadata);
      expect(logger.warn).toHaveBeenCalledWith(message, metadata);
      expect(logger.error).toHaveBeenCalledWith(message, metadata);
    });
  });
}); 