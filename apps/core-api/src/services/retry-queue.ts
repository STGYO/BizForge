import type { EventEnvelope } from "@bizforge/plugin-sdk";
import { randomUUID } from "node:crypto";

export interface RetryableAction {
  id: string;
  originalEvent: EventEnvelope;
  attemptCount: number;
  nextRetryAt: number;
  maxAttempts: number;
}

export class RetryQueue {
  private queue: Map<string, RetryableAction> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  private readonly BACKOFF_DELAYS = [10_000, 60_000, 300_000]; // 10s, 60s, 5min

  enqueue(
    event: EventEnvelope,
    maxAttempts: number = 3,
    onRetry?: (action: RetryableAction) => Promise<void>
  ): string {
    const actionId = randomUUID();
    const action: RetryableAction = {
      id: actionId,
      originalEvent: event,
      attemptCount: 0,
      nextRetryAt: Date.now(),
      maxAttempts
    };

    this.queue.set(actionId, action);

    const schedule = () => {
      const delay = this.BACKOFF_DELAYS[action.attemptCount] ?? this.BACKOFF_DELAYS[this.BACKOFF_DELAYS.length - 1];
      const timer = setTimeout(async () => {
        try {
          action.attemptCount++;
          if (onRetry) {
            await onRetry(action);
          }
        } catch (error) {
          console.error(`Retry handler failed for action ${actionId}:`, error);
          if (action.attemptCount < maxAttempts) {
            schedule();
          } else {
            this.remove(actionId);
          }
        }
      }, delay);

      this.timers.set(actionId, timer);
    };

    if (action.attemptCount < maxAttempts) {
      schedule();
    }

    return actionId;
  }

  get(id: string): RetryableAction | undefined {
    return this.queue.get(id);
  }

  remove(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.queue.delete(id);
  }

  size(): number {
    return this.queue.size;
  }

  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.queue.clear();
  }
}
