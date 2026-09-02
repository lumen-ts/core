import type { ConcreteClass, HttpMethod, InjectionToken, MaybePromise, Scope } from '@lumen/common';

export const REQUEST_CONTEXT = Symbol.for('lumen:request-context');

export interface SchemaLike<T = unknown> {
  parse(input: unknown): T;
}

export type Provider<T = unknown> =
  | ConcreteClass<T>
  | { provide: InjectionToken<T>; useClass: ConcreteClass<T>; scope?: Scope }
  | { provide: InjectionToken<T>; useValue: T; scope?: Scope }
  | { provide: InjectionToken<T>; useFactory: (...args: any[]) => MaybePromise<T>; inject?: InjectionToken[]; scope?: Scope };

export interface ModuleMetadata {
  imports?: ModuleLike[];
  controllers?: ConcreteClass[];
  providers?: Provider[];
  exports?: InjectionToken[];
  global?: boolean;
}

/** A module produced by `Module.forRoot(...)` / `Module.forRootAsync(...)`. */
export interface DynamicModuleDescriptor extends Partial<ModuleMetadata> {
  module: ConcreteClass;
}

/** A module reference usable in `imports`, backing either a class or a dynamic module. */
export type ModuleLike = ConcreteClass | DynamicModuleDescriptor | PromiseLike<ConcreteClass | DynamicModuleDescriptor>;

export type ParamSource = 'body' | 'query' | 'param' | 'header' | 'request' | 'reply' | 'context';

/** Transforms a resolved argument, e.g. string -> number. */
export interface PipeTransform<T = any, R = any> {
  transform(value: T, context?: ExecutionContext): MaybePromise<R>;
}

export interface Pipe {
  readonly transform: PipeTransform['transform'];
}

export interface ParameterMetadata {
  index: number;
  source: ParamSource;
  key?: string;
  schema?: SchemaLike;
  pipes?: Pipe[];
}

export interface RouteMetadata {
  method: HttpMethod;
  path: string;
  propertyKey: string;
}

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  controller: ConcreteClass;
  propertyKey: string;
  parameters: ParameterMetadata[];
  guards: Guard[];
  interceptors: Interceptor[];
  middleware?: Middleware[];
  pipes?: Pipe[];
  statusCode?: number;
  headers?: Record<string, string>;
  versions?: string[];
  globalPrefix?: string;
}

export interface ExecutionContext {
  request: LumenRequest;
  reply: LumenReply;
  route: RouteDefinition;
  controller: object;
  handler: (...args: any[]) => unknown;
}

export interface Guard { canActivate(context: ExecutionContext): MaybePromise<boolean>; }
export interface Interceptor { intercept(context: ExecutionContext, next: () => Promise<unknown>): MaybePromise<unknown>; }

/**
 * Express/Nest-style middleware: runs before guards for the request. Unlike
 * {@link Guard}, middleware may call the harness (`request.raw` / `reply.raw`)
 * directly and `next()` continues the pipeline. Middleware can short-circuit by
 * sending a response and not calling `next()`.
 */
export interface Middleware {
  use(request: LumenRequest, reply: LumenReply, next: () => MaybePromise<void>): MaybePromise<void>;
}

export interface LumenRequest {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  ip?: string;
  raw: unknown;
}

export interface LumenReply {
  status(code: number): LumenReply;
  header(name: string, value: string): LumenReply;
  send(payload?: unknown): unknown;
  raw: unknown;
}

export interface HttpAdapter {
  registerRoute(route: RouteDefinition, handler: (request: LumenRequest, reply: LumenReply) => Promise<unknown>): void;
  listen(options: ListenOptions): Promise<string | void>;
  close(): Promise<void>;
  getInstance<T = unknown>(): T;
}

export interface ListenOptions { port: number; host?: string; }
export interface OnModuleInit { onModuleInit(): MaybePromise<void>; }
export interface OnApplicationBootstrap { onApplicationBootstrap(): MaybePromise<void>; }
export interface OnApplicationShutdown { onApplicationShutdown(signal?: string): MaybePromise<void>; }
