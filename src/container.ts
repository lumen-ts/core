import type { ConcreteClass, InjectionToken, Scope } from '@lumen/common';
import { NotFoundException, InternalServerErrorException } from '@lumen/common';
import type { Provider } from './contracts.js';
import { REQUEST_CONTEXT } from './contracts.js';
import { META_INJECT, META_SCOPE } from './constants.js';
import type { RequestContext } from './request-context.js';

const REQUEST_CONTAINER = 'lumen:request-container';

type Registration = Provider;

function scopeForProvider(provider: Provider | undefined): Scope | undefined {
  if (!provider) return undefined;
  if (typeof provider === 'function') return undefined;
  return provider.scope;
}

/**
 * Dependency-injection container.
 *
 * Requests get a real child container (see {@link createRequestScope}) so REQUEST-scoped
 * providers are resolved with correct per-request caching and can themselves depend on
 * other request-scoped providers, mirroring Nest's per-request sub-container model.
 */
export class Container {
  private readonly registrations = new Map<InjectionToken, Registration>();
  private readonly instances = new Map<InjectionToken, unknown>();
  private readonly forwarded = new Map<InjectionToken, Container>();

  constructor(private readonly parent?: Container) {}

  register(provider: Provider): void {
    const token = typeof provider === 'function' ? provider : provider.provide;
    this.registrations.set(token, provider);
  }

  /**
   * Make a token resolvable through this container by delegating to `source`.
   * Used to expose providers exported by imported modules while preserving the
   * single instance owned by the exporting module (Nest-style encapsulation).
   */
  forward(token: InjectionToken, source: Container): void { this.forwarded.set(token, source); }

  has(token: InjectionToken): boolean {
    return this.registrations.has(token) || this.forwarded.has(token) || !!this.parent?.has(token);
  }

  async resolve<T>(token: InjectionToken<T>): Promise<T> {
    const registration = this.registrations.get(token);
    const scope = this.scopeFor(token, registration);

    if (scope === 'REQUEST') {
      const requestContainer = await this.requestContainer();
      if (requestContainer) return requestContainer.resolveRequestScoped(token);
    }

    if (this.instances.has(token)) return this.instances.get(token) as T;
    if (registration) return this.createAndCache(token, registration as Provider<T>);
    const source = this.forwarded.get(token);
    if (source) return source.resolve(token);
    if (this.parent) return this.parent.resolve(token);
    throw new NotFoundException(`Provider not found for token ${String(token)}`, undefined, 'PROVIDER_NOT_FOUND');
  }

  /**
   * Resolve a REQUEST-scoped token from within the per-request container. The registration
   * is found by walking up the parent chain, and each request caches one fresh instance.
   */
  private async resolveRequestScoped<T>(token: InjectionToken<T>): Promise<T> {
    if (this.instances.has(token)) return this.instances.get(token) as T;
    const source = this.lookupForwarded(token);
    if (source) return source.resolve(token);
    const registration = this.lookupRegistration(token);
    if (!registration) {
      throw new NotFoundException(`Provider not found for token ${String(token)}`, undefined, 'PROVIDER_NOT_FOUND');
    }
    const value = await this.createFromProvider(registration) as T;
    this.instances.set(token, value);
    return value;
  }

  private lookupForwarded(token: InjectionToken): Container | undefined {
    let node: Container | undefined = this;
    while (node) {
      const src = node.forwarded.get(token);
      if (src) return src;
      node = node.parent;
    }
    return undefined;
  }

  async instantiate<T>(Type: ConcreteClass<T>): Promise<T> {
    const explicit: Map<number, InjectionToken> = Reflect.getOwnMetadata(META_INJECT, Type) ?? new Map();
    const reflected: unknown[] = Reflect.getMetadata('design:paramtypes', Type) ?? [];
    const count = Math.max(Type.length, reflected.length, explicit.size ? Math.max(...explicit.keys()) + 1 : 0);
    const deps: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const token = explicit.get(i) ?? reflected[i];
      if (!token) throw new InternalServerErrorException(`Cannot resolve parameter #${i} of ${Type.name}. Use @Inject(token).`, undefined, 'PARAMETER_RESOLUTION_FAILED');
      deps.push(await this.resolve(token as InjectionToken));
    }
    return new Type(...deps);
  }

  getCreatedInstances(): unknown[] { return [...this.instances.values()]; }

  /**
   * Create a child container for the current request. REQUEST-scoped providers resolved
   * through it cache one fresh instance per request; singletons continue to come from the
   * parent graph. Intended to be bound to the request context for the request's lifetime.
   */
  async createRequestScope(): Promise<Container> {
    return new Container(this);
  }

  /** Ensure a per-request container exists for the current async context and return it. */
  private async requestContainer(): Promise<Container | undefined> {
    let rc: RequestContext | undefined;
    try {
      rc = (await this.resolve(REQUEST_CONTEXT)) as unknown as RequestContext;
    } catch {
      rc = undefined;
    }
    if (!rc) return undefined;
    const store = rc.store;
    if (!store) return undefined;
    let container = store[REQUEST_CONTAINER] as Container | undefined;
    if (!container) {
      container = await this.createRequestScope();
      store[REQUEST_CONTAINER] = container;
    }
    return container;
  }

  private lookupRegistration(token: InjectionToken): Registration | undefined {
    let node: Container | undefined = this;
    while (node) {
      const reg = node.registrations.get(token);
      if (reg !== undefined) return reg;
      node = node.parent;
    }
    return undefined;
  }

  private async createAndCache<T>(token: InjectionToken, registration: Provider<T>): Promise<T> {
    const value = await this.createFromProvider(registration);
    this.instances.set(token, value);
    return value;
  }

  private scopeFor(token: InjectionToken, registration: Registration | undefined): Scope | undefined {
    const providerScope = scopeForProvider(registration);
    if (providerScope) return providerScope;
    const cls = typeof token === 'function' ? token
      : registration && typeof registration !== 'function' && 'useClass' in registration ? registration.useClass
      : undefined;
    if (cls) {
      const metaScope = Reflect.getMetadata(META_SCOPE, cls) as Scope | undefined;
      if (metaScope) return metaScope;
    }
    return undefined;
  }

  private async createFromProvider<T>(provider: Provider<T> | ConcreteClass<T>): Promise<T> {
    if (typeof provider === 'function') return this.instantiate(provider);
    if ('useValue' in provider) return provider.useValue;
    if ('useClass' in provider) return this.instantiate(provider.useClass);
    const args = await Promise.all((provider.inject ?? []).map(t => this.resolve(t)));
    return provider.useFactory(...args);
  }
}
