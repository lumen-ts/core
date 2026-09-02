import { AsyncLocalStorage } from 'node:async_hooks';
import { InternalServerErrorException } from '@lumen/common';

export interface RequestContextStore {
  requestId: string;
  traceId?: string;
  user?: unknown;
  tenantId?: string;
  [key: string]: unknown;
}

export class RequestContext {
  private readonly storage = new AsyncLocalStorage<RequestContextStore>();
  run<T>(store: RequestContextStore, callback: () => T): T { return this.storage.run(store, callback); }
  get store(): RequestContextStore | undefined { return this.storage.getStore(); }
  get<T = unknown>(key: string): T | undefined { return this.storage.getStore()?.[key] as T | undefined; }
  set(key: string, value: unknown): void {
    const store = this.storage.getStore();
    if (!store) throw new InternalServerErrorException('No active request context', undefined, 'NO_ACTIVE_CONTEXT');
    store[key] = value;
  }
}
