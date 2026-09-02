import { ForbiddenException, HttpException, InternalServerErrorException, VersionNotSupportedException } from '@lumen/common';
import { matchesVersion, resolveVersion } from '@lumen/common';
import type { VersionResolverOptions } from '@lumen/common';
import type { ConcreteClass, InjectionToken } from '@lumen/common';
import type { LumenReply, LumenRequest, ExecutionContext, HttpAdapter, ListenOptions, Middleware, OnApplicationBootstrap, OnApplicationShutdown, OnModuleInit, Pipe, RouteDefinition } from './contracts.js';
import { REQUEST_CONTEXT } from './contracts.js';
import { Container } from './container.js';
import { ModuleCompiler, type CompiledModule } from './module-compiler.js';
import { RequestContext } from './request-context.js';

/** Internal control-flow sentinel: a middleware short-circuited without calling next(). */
class ShortCircuitSignal extends Error {}

export interface LumenApplicationOptions {
  versioning?: VersionResolverOptions;
  /** Global pipes applied to every route argument, before route/parameter pipes. */
  pipes?: Pipe[];
  /** Global middleware applied to every route, before route/controller middleware and guards. */
  middleware?: Middleware[];
}

export class LumenApplication {
  private readonly rootContainer = new Container();
  private readonly compiler = new ModuleCompiler(this.rootContainer);
  private rootModuleContext?: CompiledModule;
  private initialized = false;

  constructor(private readonly rootModule: ConcreteClass, private readonly adapter: HttpAdapter, private readonly options: LumenApplicationOptions = {}) {
    this.rootContainer.register({ provide: REQUEST_CONTEXT, useValue: new RequestContext() });
  }

  async init(): Promise<this> {
    if (this.initialized) return this;
    this.rootModuleContext = await this.compiler.compile(this.rootModule);
    for (const mod of this.compiler.allModules()) {
      for (const route of mod.routes) this.adapter.registerRoute(route, (req, res) => this.executeRoute(mod.container, route, req, res));
    }
    await this.runLifecycle('onModuleInit');
    await this.runLifecycle('onApplicationBootstrap');
    this.initialized = true;
    return this;
  }

  async listen(options: ListenOptions): Promise<string | void> { await this.init(); return this.adapter.listen(options); }
  getHttpAdapter(): HttpAdapter { return this.adapter; }
  get<T>(token: InjectionToken<T>): Promise<T> {
    return (this.rootModuleContext?.container ?? this.rootContainer).resolve(token);
  }

  async close(signal?: string): Promise<void> {
    await this.runLifecycle('onApplicationShutdown', signal, true);
    await this.adapter.close();
  }

  private async executeRoute(container: Container, route: RouteDefinition, request: LumenRequest, reply: LumenReply): Promise<unknown> {
    const context = await this.rootContainer.resolve<RequestContext>(REQUEST_CONTEXT);
    return context.run({ requestId: request.id }, async () => {
      try {
        const controller = await container.resolve(route.controller) as object;
        const handler = (controller as Record<string, unknown>)[route.propertyKey] as (...args: unknown[]) => unknown;
        const boundHandler = handler.bind(controller);
        const execution: ExecutionContext = { request, reply, route, controller, handler: boundHandler };
        if (route.versions && route.versions.length > 0 && this.options.versioning) {
          const requested = resolveVersion(request, this.options.versioning);
          if (requested !== undefined && !matchesVersion(requested, route.versions)) {
            throw new VersionNotSupportedException('API version not supported', { requested, supported: route.versions });
          }
        }
        const completed = await this.runMiddleware(request, reply, [...(this.options.middleware ?? []), ...(route.middleware ?? [])]);
        if (!completed) return; // middleware short-circuited and handled the response itself
        for (const guard of route.guards) if (!await guard.canActivate(execution)) throw new ForbiddenException();
        const args = await this.resolveArguments(route, request, reply, execution);
        let invoke = async () => boundHandler(...args);
        for (const interceptor of [...route.interceptors].reverse()) {
          const next = invoke;
          invoke = async () => interceptor.intercept(execution, next);
        }
        const result = await invoke();
        if (route.statusCode !== undefined) reply.status(route.statusCode);
        for (const [name,value] of Object.entries(route.headers ?? {})) reply.header(name,value);
        return result;
      } catch (error) {
        if (error instanceof HttpException) throw error;
        throw new InternalServerErrorException('Internal Server Error', process.env.NODE_ENV === 'development' && error instanceof Error ? { message: error.message } : undefined);
      }
    });
  }

  private async resolveArguments(route: RouteDefinition, req: LumenRequest, res: LumenReply, ctx: ExecutionContext): Promise<unknown[]> {
    const max = route.parameters.reduce((n,p) => Math.max(n,p.index), -1);
    const args = new Array(max + 1).fill(undefined);
    for (const p of route.parameters) {
      let value: unknown;
      if (p.source === 'body') value = req.body;
      else if (p.source === 'query') value = p.key ? req.query[p.key] : req.query;
      else if (p.source === 'param') value = p.key ? req.params[p.key] : req.params;
      else if (p.source === 'header') value = p.key ? req.headers[p.key.toLowerCase()] : req.headers;
      else if (p.source === 'request') value = req;
      else if (p.source === 'reply') value = res;
      else value = ctx;
      args[p.index] = p.schema ? p.schema.parse(value) : value;
      const pipelines: Pipe[] = [...(this.options.pipes ?? []), ...(route.pipes ?? []), ...(p.pipes ?? [])];
      if (pipelines.length > 0) {
        let transformed = args[p.index];
        for (const pipe of pipelines) transformed = await pipe.transform(transformed, ctx);
        args[p.index] = transformed;
      }
    }
    return args;
  }

  private async runMiddleware(req: LumenRequest, res: LumenReply, middleware: Middleware[]): Promise<boolean> {
    let index = -1;
    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) throw new InternalServerErrorException('next() called multiple times', undefined, 'MIDDLEWARE_NEXT_DUPLICATE');
      index = i;
      const fn = middleware[i];
      if (!fn) return;
      let nextCalled = false;
      const next = () => { nextCalled = true; return dispatch(i + 1); };
      await fn.use(req, res, next);
      // If this middleware did not call next(), it short-circuited (it is expected
      // to have written the response itself). Abort the rest of the chain.
      if (!nextCalled) throw new ShortCircuitSignal();
    };
    try {
      await dispatch(0);
      return true;
    } catch (error) {
      if (error instanceof ShortCircuitSignal) return false;
      throw error;
    }
  }

  private async runLifecycle(name: 'onModuleInit'|'onApplicationBootstrap'|'onApplicationShutdown', arg?: string, reverse=false): Promise<void> {
    let values = this.compiler.allModules().flatMap(m => m.container.getCreatedInstances());
    if (reverse) values = values.toReversed();
    for (const instance of values) {
      const record = instance as Record<string, unknown>;
      const fn = record[name];
      if (typeof fn === 'function') await (fn as (arg?: string) => Promise<void>).call(instance, arg);
    }
  }
}

export class LumenFactory {
  static async create(rootModule: ConcreteClass, adapter: HttpAdapter, options: LumenApplicationOptions = {}): Promise<LumenApplication> {
    const app = new LumenApplication(rootModule, adapter, options);
    await app.init();
    return app;
  }
}
