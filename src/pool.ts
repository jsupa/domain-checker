import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import type { DomainCheckTask, DomainCheckResult } from './types.js';

interface WorkerState {
  id: number;
  worker: Worker;
  isBusy: boolean;
}

export class WorkerPool extends EventEmitter {
  private workers: WorkerState[] = [];
  private taskQueue: DomainCheckTask[] = [];
  private maxQueueSize: number;
  private isTerminating = false;

  constructor(poolSize: number, maxQueueSize = 1000) {
    super();
    this.maxQueueSize = maxQueueSize;
    this.initWorkers(poolSize);
  }

  private initWorkers(count: number): void {
    const isTs = import.meta.url.endsWith('.ts');
    const workerScriptUrl = new URL(isTs ? './worker.ts' : './worker.js', import.meta.url);
    const workerOptions = isTs ? { execArgv: ['--import', 'tsx'] } : undefined;

    for (let i = 0; i < count; i++) {
      const worker = new Worker(workerScriptUrl, workerOptions);
      const state: WorkerState = {
        id: i,
        worker,
        isBusy: false
      };

      worker.on('message', (msg) => {
        if (msg && msg.type === 'result') {
          state.isBusy = false;
          this.emit('result', msg.result as DomainCheckResult);
          this.dispatchNext();
        }
      });

      worker.on('error', (err) => {
        state.isBusy = false;
        this.emit('error', err);
        this.dispatchNext();
      });

      worker.on('exit', (code) => {
        if (!this.isTerminating && code !== 0) {
          // Restart worker if unexpectedly crashed
          console.warn(`[Pool] Worker #${state.id} exited with code ${code}. Restarting...`);
          const newWorker = new Worker(workerScriptUrl, workerOptions);
          state.worker = newWorker;
          state.isBusy = false;
          this.dispatchNext();
        }
      });

      this.workers.push(state);
    }
  }

  /**
   * Enqueue a domain check task.
   * Returns true if enqueued, false if discarded due to backpressure.
   */
  public enqueue(task: DomainCheckTask): boolean {
    if (this.isTerminating) return false;

    if (this.taskQueue.length >= this.maxQueueSize) {
      // Discard excess to preserve memory if stream is overflowing
      return false;
    }

    this.taskQueue.push(task);
    this.dispatchNext();
    return true;
  }

  private dispatchNext(): void {
    if (this.isTerminating || this.taskQueue.length === 0) return;

    const freeWorker = this.workers.find((w) => !w.isBusy);
    if (!freeWorker) return;

    const task = this.taskQueue.shift();
    if (!task) return;

    freeWorker.isBusy = true;
    freeWorker.worker.postMessage({
      type: 'check',
      task
    });
  }

  public getQueueLength(): number {
    return this.taskQueue.length;
  }

  public getBusyCount(): number {
    return this.workers.filter((w) => w.isBusy).length;
  }

  public getTotalWorkers(): number {
    return this.workers.length;
  }

  public async shutdown(): Promise<void> {
    this.isTerminating = true;
    this.taskQueue = [];

    await Promise.all(
      this.workers.map(async (w) => {
        try {
          w.worker.postMessage({ type: 'exit' });
          await w.worker.terminate();
        } catch {
          // Worker might already have exited
        }
      })
    );
  }
}
