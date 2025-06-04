import { exec } from 'child_process';
import logger from './logger.util';

export class DockerError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = 'DockerError';
  }
}

export function execInContainer(containerName: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = exec(`docker exec ${containerName} ${command}`, (error, stdout, stderr) => {
      if (error) {
        logger.error(`Docker exec error: ${error.message}`);
        reject(new DockerError(`Failed to execute command in container: ${error.message}`, error.code));
        return;
      }
      if (stderr) {
        logger.warn(`Docker exec stderr: ${stderr}`);
      }
      resolve(stdout.trim());
    });
  });
}

export function copyFromContainer(containerName: string, containerPath: string, hostPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = exec(`docker cp ${containerName}:${containerPath} ${hostPath}`, (error, stdout, stderr) => {
      if (error) {
        logger.error(`Docker cp error: ${error.message}`);
        reject(new DockerError(`Failed to copy from container: ${error.message}`, error.code));
        return;
      }
      if (stderr) {
        logger.warn(`Docker cp stderr: ${stderr}`);
      }
      resolve();
    });
  });
}

export function isContainerRunning(containerName: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = exec(`docker ps --filter "name=${containerName}" --format "{{.Names}}"`, (error, stdout, stderr) => {
      if (error) {
        logger.error(`Docker ps error: ${error.message}`);
        reject(new DockerError(`Failed to check container status: ${error.message}`, error.code));
        return;
      }
      resolve(stdout.trim() === containerName);
    });
  });
} 