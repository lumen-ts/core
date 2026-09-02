import type { ConcreteClass, HttpMethod, InjectionToken, Scope } from '@lumen/common';
import type { APIVersion } from '@lumen/common';
import type { DynamicModuleDescriptor, Guard, Interceptor, Middleware, ModuleMetadata, ParameterMetadata, Pipe, RouteMetadata, SchemaLike } from './contracts.js';
import { META_MIDDLEWARE } from './constants.js';

export function Module(metadata: ModuleMetadata): ClassDecorator {
  return target => Reflect.defineMetadata(META_MODULE, metadata, target);
}
export const ApiModule = Module;

/** Mark a module as global: its exported providers are visible to every module. */
export function Global(): ClassDecorator {
  return target => Reflect.defineMetadata(META_GLOBAL, true, target);
}

/** Mark a class as a dynamic module that produces metadata via `forRoot`/`forRootAsync`. */
export function DynamicModule(): ClassDecorator {
  return target => Reflect.defineMetadata(META_DYNAMIC, true, target);
}

/** Build a dynamic module descriptor synchronously (Nest-style `forRoot`). */
export function forRoot(module: ConcreteClass, metadata: Partial<ModuleMetadata> = {}): DynamicModuleDescriptor {
  return { module, ...metadata };
}

/** Build a dynamic module descriptor from an async factory (Nest-style `forRootAsync`). */
export function forRootAsync(module: ConcreteClass, factory: () => Partial<ModuleMetadata> | Promise<Partial<ModuleMetadata>>): Promise<DynamicModuleDescriptor> {
  return Promise.resolve(factory()).then(metadata => ({ module, ...metadata }));
}
import { META_CONTROLLER, META_DYNAMIC, META_GLOBAL, META_GUARDS, META_HEADERS, META_INJECT, META_INTERCEPTORS, META_MODULE, META_PARAMS, META_PIPES, META_ROUTES, META_SCOPE, META_STATUS, META_VERSION } from './constants.js';

export function Injectable(options: { scope?: Scope } = {}): ClassDecorator {
  return target => { if (options.scope) Reflect.defineMetadata(META_SCOPE, options.scope, target); };
}
export function Inject(token: InjectionToken): ParameterDecorator {
  return (target, _propertyKey, parameterIndex) => {
    const current: Map<number, InjectionToken> = Reflect.getOwnMetadata(META_INJECT, target) ?? new Map();
    current.set(parameterIndex, token);
    Reflect.defineMetadata(META_INJECT, current, target);
  };
}
export function Controller(prefix = ''): ClassDecorator {
  return target => Reflect.defineMetadata(META_CONTROLLER, prefix, target);
}

function route(method: HttpMethod) {
  return (path = ''): MethodDecorator => (target, propertyKey) => {
    const routes: RouteMetadata[] = Reflect.getOwnMetadata(META_ROUTES, target.constructor) ?? [];
    routes.push({ method, path, propertyKey: String(propertyKey) });
    Reflect.defineMetadata(META_ROUTES, routes, target.constructor);
  };
}
export const Get = route('GET');
export const Post = route('POST');
export const Put = route('PUT');
export const Patch = route('PATCH');
export const Delete = route('DELETE');
export const Options = route('OPTIONS');
export const Head = route('HEAD');

type ParamArg = string | SchemaLike | Pipe;

function param(source: ParameterMetadata['source']) {
  return (...args: ParamArg[]): ParameterDecorator => (target, propertyKey, index) => {
    const key = typeof args[0] === 'string' ? args[0] : undefined;
    const schema = args.find((a): a is SchemaLike => !!a && typeof a === 'object' && 'parse' in a) as SchemaLike | undefined;
    const pipes = args.filter((a): a is Pipe => !!a && typeof a === 'object' && 'transform' in a);
    const method = target[propertyKey as keyof typeof target] as object;
    const params: ParameterMetadata[] = Reflect.getOwnMetadata(META_PARAMS, method) ?? [];
    const item: ParameterMetadata = { index, source };
    if (key !== undefined) item.key = key;
    if (schema !== undefined) item.schema = schema;
    if (pipes.length > 0) item.pipes = pipes;
    params.push(item);
    Reflect.defineMetadata(META_PARAMS, params, method);
  };
}
export const Body = param('body');
export const Query = param('query');
export const Param = param('param');
export const Header = param('header');
export const Req = () => param('request')();
export const Res = () => param('reply')();
export const Ctx = () => param('context')();

/** Apply pipes to a controller or to a specific route handler (Nest semantics). */
export function UsePipes(...pipes: Pipe[]): MethodDecorator & ClassDecorator {
  return (target: object, propertyKey?: string | symbol) => {
    const holder = propertyKey ? (target as any)[propertyKey] : target;
    Reflect.defineMetadata(META_PIPES, pipes, holder);
  };
}

/** Declare the API version(s) supported by a controller or route. */
export function Version(...versions: APIVersion[]): MethodDecorator & ClassDecorator {
  return (target: object, propertyKey?: string | symbol) => {
    const holder = propertyKey ? (target as any)[propertyKey] : target;
    Reflect.defineMetadata(META_VERSION, versions.map(String), holder);
  };
}

export function UseGuards(...guards: (Guard | ConcreteClass<Guard>)[]): MethodDecorator & ClassDecorator {
  return (target: object, propertyKey?: string | symbol) => {
    const holder = propertyKey ? (target as any)[propertyKey] : target;
    Reflect.defineMetadata(META_GUARDS, guards, holder);
  };
}
export function UseInterceptors(...interceptors: (Interceptor | ConcreteClass<Interceptor>)[]): MethodDecorator & ClassDecorator {
  return (target: object, propertyKey?: string | symbol) => {
    const holder = propertyKey ? (target as any)[propertyKey] : target;
    Reflect.defineMetadata(META_INTERCEPTORS, interceptors, holder);
  };
}
export function HttpCode(code: number): MethodDecorator {
  return (target, propertyKey) => Reflect.defineMetadata(META_STATUS, code, (target as any)[propertyKey]);
}
export function ResponseHeader(name: string, value: string): MethodDecorator {
  return (target, propertyKey) => {
    const fn = (target as any)[propertyKey];
    const current = Reflect.getOwnMetadata(META_HEADERS, fn) ?? {};
    Reflect.defineMetadata(META_HEADERS, { ...current, [name]: value }, fn);
  };
}

/** Apply middleware to a controller or a specific route handler (runs before guards). */
export function UseMiddleware(...middleware: (Middleware | ConcreteClass<Middleware>)[]): MethodDecorator & ClassDecorator {
  return (target: object, propertyKey?: string | symbol) => {
    const holder = propertyKey ? (target as any)[propertyKey] : target;
    Reflect.defineMetadata(META_MIDDLEWARE, middleware, holder);
  };
}
/** Alias for {@link UseMiddleware}, Nest-flavored. */
export const UseBefore = UseMiddleware;
