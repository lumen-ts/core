import type { ConcreteClass, InjectionToken } from '@lumen/common';
import { InternalServerErrorException } from '@lumen/common';
import type { DynamicModuleDescriptor, Guard, Interceptor, Middleware, ModuleLike, ModuleMetadata, Pipe, RouteDefinition, RouteMetadata } from './contracts.js';
import { Container } from './container.js';
import { META_CONTROLLER, META_GLOBAL, META_GUARDS, META_HEADERS, META_INTERCEPTORS, META_MIDDLEWARE, META_MODULE, META_PARAMS, META_PIPES, META_ROUTES, META_STATUS, META_VERSION } from './constants.js';

export interface CompiledModule { type: ConcreteClass; container: Container; controllers: object[]; routes: RouteDefinition[]; metadata: ModuleMetadata; }

interface ResolvedModule { key: ConcreteClass; metadata: ModuleMetadata; }

type ModuleValue = ConcreteClass | DynamicModuleDescriptor;

async function resolveModule(input: ModuleLike): Promise<ResolvedModule> {
  const value: ModuleValue = await Promise.resolve(input);
  if (typeof value === 'function') {
    const metadata: ModuleMetadata | undefined = Reflect.getMetadata(META_MODULE, value);
    if (!metadata) throw new InternalServerErrorException(`${value.name} is not decorated with @Module()`, undefined, 'MODULE_NOT_DECORATED');
    return { key: value, metadata };
  }
  const metadata: ModuleMetadata = {};
  if (value.imports) metadata.imports = value.imports;
  if (value.controllers) metadata.controllers = value.controllers;
  if (value.providers) metadata.providers = value.providers;
  if (value.exports) metadata.exports = value.exports;
  if (value.global) metadata.global = value.global;
  return { key: value.module, metadata };
}

export class ModuleCompiler {
  private readonly cache = new Map<ConcreteClass, CompiledModule>();
  constructor(private readonly rootContainer: Container) {}

  async compile(type: ModuleLike): Promise<CompiledModule> {
    const { key, metadata } = await resolveModule(type as ModuleLike);
    const cached = this.cache.get(key); if (cached) return cached;
    const container = new Container(this.rootContainer);
    const compiled: CompiledModule = { type: key, container, controllers: [], routes: [], metadata };
    this.cache.set(key, compiled);

    const imported: CompiledModule[] = [];
    for (const entry of metadata.imports ?? []) {
      imported.push(await this.compile(entry as ModuleLike));
    }
    // Expose providers exported by imported modules (Nest-style encapsulation).
    for (const mod of imported) this.forwardExports(container, mod);

    // A @Global() module's exports are visible to every module via the root container.
    if (metadata.global === true || Reflect.getMetadata(META_GLOBAL, key) === true) {
      for (const token of metadata.exports ?? []) this.rootContainer.forward(token, container);
    }

    for (const provider of metadata.providers ?? []) container.register(provider);
    container.register(key);

    for (const controllerType of metadata.controllers ?? []) {
      container.register(controllerType);
      const controller = await container.resolve(controllerType) as object;
      compiled.controllers.push(controller);
      compiled.routes.push(...await this.routesFor(controllerType, controller, container));
    }
    return compiled;
  }

  allModules(): CompiledModule[] { return [...this.cache.values()]; }

  /** Expose an imported module's exported providers in `container`. */
  private forwardExports(container: Container, imported: CompiledModule): void {
    for (const token of imported.metadata.exports ?? []) container.forward(token, imported.container);
  }

  private async routesFor(type: ConcreteClass, controller: object, container: Container): Promise<RouteDefinition[]> {
    const prefix: string = Reflect.getMetadata(META_CONTROLLER, type) ?? '';
    const routes = Reflect.getMetadata(META_ROUTES, type) ?? [];
    const classGuards = Reflect.getMetadata(META_GUARDS, type) ?? [];
    const classInterceptors = Reflect.getMetadata(META_INTERCEPTORS, type) ?? [];
    const classPipes = Reflect.getMetadata(META_PIPES, type) ?? [];
    const classMiddleware = Reflect.getMetadata(META_MIDDLEWARE, type) ?? [];
    const classVersions: string[] = Reflect.getMetadata(META_VERSION, type) ?? [];
    return Promise.all(routes.map(async (route: RouteMetadata) => {
      const fn = (controller as Record<string, unknown>)[route.propertyKey] as object;
      const routeGuards = Reflect.getMetadata(META_GUARDS, fn) ?? [];
      const routeInterceptors = Reflect.getMetadata(META_INTERCEPTORS, fn) ?? [];
      const routePipes = Reflect.getMetadata(META_PIPES, fn) ?? [];
      const routeMiddleware = Reflect.getMetadata(META_MIDDLEWARE, fn) ?? [];
      const routeVersions: string[] = Reflect.getMetadata(META_VERSION, fn) ?? [];
      const guards = await this.resolveBehaviors([...classGuards, ...routeGuards], container);
      const interceptors = await this.resolveBehaviors([...classInterceptors, ...routeInterceptors], container);
      const pipes = await this.resolveBehaviors([...classPipes, ...routePipes], container);
      const middleware = await this.resolveBehaviors([...classMiddleware, ...routeMiddleware], container);
      const def: RouteDefinition = {
        method: route.method,
        path: joinPaths(prefix, route.path),
        controller: type,
        propertyKey: route.propertyKey,
        parameters: Reflect.getMetadata(META_PARAMS, fn) ?? [],
        guards: guards as Guard[],
        interceptors: interceptors as Interceptor[],
        middleware: middleware as Middleware[],
        pipes: pipes as Pipe[],
      };
      const status = Reflect.getMetadata(META_STATUS, fn); if (status !== undefined) def.statusCode = status;
      const headers = Reflect.getMetadata(META_HEADERS, fn); if (headers !== undefined) def.headers = headers;
      const versions = [...classVersions, ...routeVersions];
      if (versions.length > 0) def.versions = versions;
      return def;
    }));
  }

  private async resolveBehaviors(values: unknown[], container: Container): Promise<unknown[]> {
    return Promise.all(values.map(value => typeof value === 'function' ? container.resolve(value as InjectionToken) : value));
  }
}

function joinPaths(a: string, b: string): string {
  const path = `/${[a,b].filter(Boolean).map(v => v.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`;
  return path === '/' ? '/' : path.replace(/\/+/g, '/');
}
