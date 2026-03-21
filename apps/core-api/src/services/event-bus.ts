import {
  type EventEnvelope,
  type PluginEventBus
} from "@bizforge/plugin-sdk";

export class InMemoryEventBus implements PluginEventBus {
  private readonly subscribers = new Map<
    string,
    Set<(event: EventEnvelope) => Promise<void>>
  >();

  async publish<TPayload>(event: EventEnvelope<TPayload>): Promise<void> {
    const handlers = this.subscribers.get(event.eventType);
    if (!handlers || handlers.size === 0) {
      return;
    }

    await Promise.all(Array.from(handlers).map((handler) => handler(event)));
  }

  subscribe(
    eventType: string,
    handler: (event: EventEnvelope) => Promise<void>
  ): () => void {
    const handlers = this.subscribers.get(eventType) ?? new Set();
    handlers.add(handler);
    this.subscribers.set(eventType, handlers);

    return () => {
      const current = this.subscribers.get(eventType);
      if (!current) {
        return;
      }

      current.delete(handler);
      if (current.size === 0) {
        this.subscribers.delete(eventType);
      }
    };
  }
}
