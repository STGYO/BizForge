import {
  type EventEnvelope,
  type PluginEventBus
} from "@bizforge/plugin-sdk";
import { randomUUID } from "node:crypto";

export interface EventDeliveryDeadLetter {
  id: string;
  eventType: string;
  eventId: string;
  organizationId: string;
  sourcePlugin?: string;
  handlerId: string;
  errorMessage: string;
  failedAt: string;
  event: EventEnvelope;
}

export interface EventBusDiagnostics {
  publishedCount: number;
  deliveredCount: number;
  failedDeliveryCount: number;
  subscriberCount: number;
  subscribersByEventType: Record<string, number>;
  deadLetters: EventDeliveryDeadLetter[];
}

export class InMemoryEventBus implements PluginEventBus {
  private readonly subscribers = new Map<
    string,
    Map<string, (event: EventEnvelope) => Promise<void>>
  >();
  private publishedCount = 0;
  private deliveredCount = 0;
  private failedDeliveryCount = 0;
  private readonly deadLetters: EventDeliveryDeadLetter[] = [];

  async publish<TPayload>(event: EventEnvelope<TPayload>): Promise<void> {
    this.publishedCount++;
    const handlers = this.subscribers.get(event.eventType);
    if (!handlers || handlers.size === 0) {
      return;
    }

    const deliveries = Array.from(handlers.entries()).map(async ([handlerId, handler]) => {
      try {
        await handler(event);
        this.deliveredCount++;
      } catch (error) {
        this.failedDeliveryCount++;
        this.deadLetters.push({
          id: randomUUID(),
          eventType: event.eventType,
          eventId: event.eventId,
          organizationId: event.organizationId,
          sourcePlugin: event.sourcePlugin,
          handlerId,
          errorMessage: error instanceof Error ? error.message : "handler_failed",
          failedAt: new Date().toISOString(),
          event: event as EventEnvelope
        });
      }
    });

    await Promise.allSettled(deliveries);
  }

  subscribe(
    eventType: string,
    handler: (event: EventEnvelope) => Promise<void>
  ): () => void {
    const handlers = this.subscribers.get(eventType) ?? new Map();
    const handlerId = randomUUID();
    handlers.set(handlerId, handler);
    this.subscribers.set(eventType, handlers);

    return () => {
      const current = this.subscribers.get(eventType);
      if (!current) {
        return;
      }

      current.delete(handlerId);
      if (current.size === 0) {
        this.subscribers.delete(eventType);
      }
    };
  }

  getDiagnostics(): EventBusDiagnostics {
    const subscribersByEventType: Record<string, number> = {};
    for (const [eventType, handlers] of this.subscribers.entries()) {
      subscribersByEventType[eventType] = handlers.size;
    }

    return {
      publishedCount: this.publishedCount,
      deliveredCount: this.deliveredCount,
      failedDeliveryCount: this.failedDeliveryCount,
      subscriberCount: Array.from(this.subscribers.values()).reduce(
        (count, handlers) => count + handlers.size,
        0
      ),
      subscribersByEventType,
      deadLetters: [...this.deadLetters]
    };
  }

  acknowledgeDeadLetter(deadLetterId: string): boolean {
    const before = this.deadLetters.length;
    const remaining = this.deadLetters.filter((deadLetter) => deadLetter.id !== deadLetterId);
    this.deadLetters.length = 0;
    this.deadLetters.push(...remaining);
    return remaining.length !== before;
  }

  clearDeadLetters(): void {
    this.deadLetters.length = 0;
  }
}
