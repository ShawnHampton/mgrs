/**
 * Worker Pool for MGRS Grid Generation
 */

import type {
  Generate100kmRequest,
  Generate100kmResponse,
  Generate10kmRequest,
  Generate10kmResponse,
} from '../types/mgrs';

export class WorkerPool {
  private workers: Worker[] = [];
  private nextWorkerIndex = 0;
  private generate100kmCallbacks: Map<string, (response: Generate100kmResponse) => void> = new Map();
  private generate10kmCallbacks: Map<string, (response: Generate10kmResponse) => void> = new Map();
  private generate10kmErrorCallbacks: Map<string, (error: string) => void> = new Map();

  constructor(size: number = 4) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(
        new URL('../workers/mgrs.worker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (event) => {
        const { type, payload } = event.data;

        if (type === 'generate-100km-result') {
          const result = payload as Generate100kmResponse;
          const callback = this.generate100kmCallbacks.get(result.gzd);
          if (callback) {
            callback(result);
            this.generate100kmCallbacks.delete(result.gzd);
          }
          return;
        }

        if (type === 'generate-10km-result') {
          const result = payload as Generate10kmResponse;
          const callback = this.generate10kmCallbacks.get(result.squareId);
          if (callback) {
            callback(result);
            this.generate10kmCallbacks.delete(result.squareId);
          }
          return;
        }

        if (type === 'generate-10km-error') {
          const { squareId, error } = payload as { squareId: string; error: string };
          console.warn(`[WorkerPool] 10km generation failed for ${squareId}:`, error);
          const errorCallback = this.generate10kmErrorCallbacks.get(squareId);
          if (errorCallback) {
            errorCallback(error);
          }
          this.generate10kmCallbacks.delete(squareId);
          this.generate10kmErrorCallbacks.delete(squareId);
          return;
        }
      };

      this.workers.push(worker);
    }
  }

  private getNextWorker(): Worker {
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  requestGenerate100km(request: Generate100kmRequest, callback: (response: Generate100kmResponse) => void) {
    this.generate100kmCallbacks.set(request.gzd, callback);
    const worker = this.getNextWorker();
    worker.postMessage({ type: 'generate-100km', payload: request });
  }

  requestGenerate10km(
    request: Generate10kmRequest,
    callback: (response: Generate10kmResponse) => void,
    onError?: (error: string) => void
  ) {
    this.generate10kmCallbacks.set(request.squareId, callback);
    if (onError) {
      this.generate10kmErrorCallbacks.set(request.squareId, onError);
    }
    const worker = this.getNextWorker();
    worker.postMessage({ type: 'generate-10km', payload: request });
  }

  terminate() {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.generate100kmCallbacks.clear();
    this.generate10kmCallbacks.clear();
    this.generate10kmErrorCallbacks.clear();
  }
}

let workerPool: WorkerPool | null = null;

export function getWorkerPool(): WorkerPool {
  if (!workerPool) {
    workerPool = new WorkerPool(4);
  }
  return workerPool;
}
