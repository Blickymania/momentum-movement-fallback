import { DurableObject } from "cloudflare:workers";
import { AtomicOneTimeStoreCore } from "./one-time-store-core";

export class OAuthOneTimeStore extends DurableObject<unknown> {
  private readonly store: AtomicOneTimeStoreCore;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.store = new AtomicOneTimeStoreCore(ctx.storage.sql);
  }

  async put(value: string, ttlSeconds: number): Promise<void> {
    const expiresAt = this.store.put(value, ttlSeconds);
    try {
      await this.ctx.storage.setAlarm(expiresAt);
    } catch (error) {
      this.store.clear();
      throw error;
    }
  }

  async consume(): Promise<string | null> {
    const value = this.store.consume();
    await this.ctx.storage.deleteAlarm().catch(() => undefined);
    return value;
  }

  async alarm(): Promise<void> {
    this.store.clear();
  }
}
