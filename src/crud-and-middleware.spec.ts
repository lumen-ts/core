import { describe, expect, it } from 'vitest';
import { LumenFactory } from './application.js';
import {
  Module,
  Controller,
  Get,
  Injectable,
  UseMiddleware,
  createCrudController,
  type Middleware,
  type LumenReply,
  type LumenRequest,
  type HttpAdapter,
  type RouteDefinition,
} from './index.js';

class MockAdapter implements HttpAdapter {
  routes: RouteDefinition[] = [];
  handlers = new Map<string, (req: LumenRequest, reply: LumenReply) => Promise<unknown>>();
  async registerRoute(route: RouteDefinition, handler: (request: LumenRequest, reply: LumenReply) => Promise<unknown>): Promise<void> {
    this.routes.push(route);
    this.handlers.set(`${route.method} ${route.path}`, handler);
  }
  async listen(): Promise<string | void> { return 'ok'; }
  async close(): Promise<void> {}
  getInstance<T = unknown>(): T { return undefined as T; }
}

const mockRequest = (overrides: Partial<LumenRequest> = {}): LumenRequest => ({
  id: 'req-1',
  method: 'GET',
  url: '/x',
  headers: {},
  body: undefined,
  query: {},
  params: {},
  raw: {},
  ...overrides,
});

const mockReply = (): LumenReply & { payload: unknown; statusCode?: number } => {
  const reply: LumenReply & { payload: unknown; statusCode?: number } = {
    payload: undefined,
    status(code) { reply.statusCode = code; return reply; },
    header() { return reply; },
    send(payload) { reply.payload = payload; return reply; },
    raw: {},
  };
  return reply;
};

@Injectable()
class LogMiddleware implements Middleware {
  async use(_req: LumenRequest, _res: LumenReply, next: () => Promise<void>): Promise<void> {
    await next();
  }
}

@Controller('/app')
@UseMiddleware(LogMiddleware)
class AppController {
  @Get()
  get(): string {
    return 'ok';
  }
}

@Module({ controllers: [AppController], providers: [LogMiddleware] })
class AppModule {}

describe('middleware', () => {
  it('runs global and route middleware before the handler', async () => {
    const calls: string[] = [];
    @Injectable()
    class GlobalMw implements Middleware {
      async use(_req: LumenRequest, _res: LumenReply, next: () => Promise<void>): Promise<void> {
        calls.push('global');
        await next();
      }
    }
    @Injectable()
    class OrderMw implements Middleware {
      async use(_req: LumenRequest, _res: LumenReply, next: () => Promise<void>): Promise<void> {
        calls.push('route');
        await next();
      }
    }
    @Controller('/ordered')
    @UseMiddleware(OrderMw)
    class OrderedController {
      @Get()
      get(): string {
        calls.push('handler');
        return 'ok';
      }
    }
    @Module({ controllers: [OrderedController], providers: [OrderMw] })
    class OrderedModule {}

    const adapter = new MockAdapter();
    await LumenFactory.create(OrderedModule, adapter, { middleware: [new GlobalMw(), new LogMiddleware()] });
    const handler = adapter.handlers.get('GET /ordered')!;
    const reply = mockReply();
    await handler(mockRequest({ url: '/ordered' }), reply);
    expect(calls).toEqual(['global', 'route', 'handler']);
  });

  it('short-circuits when middleware does not call next()', async () => {
    @Injectable()
    class BlockMw implements Middleware {
      async use(_req: LumenRequest, res: LumenReply): Promise<void> {
        res.status(401).send({ blocked: true });
      }
    }
    const adapter = new MockAdapter();
    await LumenFactory.create(AppModule, adapter, { middleware: [new BlockMw()] });
    const handler = adapter.handlers.get('GET /app')!;
    const reply = mockReply();
    const result = await handler(mockRequest({ url: '/app' }), reply);
    expect(result).toBeUndefined();
    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toEqual({ blocked: true });
  });
});

describe('createCrudController', () => {
  const STORE = Symbol('store');
  interface Todo { id: number; title: string; done: boolean; }

  const store: Record<string, unknown> = {
    list: async () => [{ id: 1, title: 'a', done: false }],
    find: async (id: number) => (id === 1 ? { id: 1, title: 'a', done: false } : undefined),
    create: async (input: unknown) => ({ id: 2, ...(input as object) }),
    update: async (id: number, input: unknown) => ({ id, ...(input as object) }),
    remove: async () => undefined,
  };

  it('registers the full set of REST routes', async () => {
    const adapter = new MockAdapter();
    @Module({
      controllers: [createCrudController<Todo, number>({ storeToken: STORE, idTransform: Number })],
      providers: [{ provide: STORE, useValue: store }],
    })
    class CrudModule {}

    const app = await LumenFactory.create(CrudModule, adapter);
    const paths = adapter.routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(paths).toEqual([
      'DELETE /:id',
      'GET /',
      'GET /:id',
      'PATCH /:id',
      'POST /',
      'PUT /:id',
    ]);
    expect(app).toBeDefined();
  });

  it('executes find and returns a framework 404 for a missing entity', async () => {
    const adapter = new MockAdapter();
    @Module({
      controllers: [createCrudController<Todo, number>({ storeToken: STORE, idTransform: Number })],
      providers: [{ provide: STORE, useValue: store }],
    })
    class CrudModule2 {}

    await LumenFactory.create(CrudModule2, adapter);
    const find = adapter.handlers.get('GET /:id')!;
    const found = await find(mockRequest({ params: { id: '1' } }), mockReply());
    expect(found).toEqual({ id: 1, title: 'a', done: false });

    await expect(find(mockRequest({ params: { id: '99' } }), mockReply()))
      .rejects.toMatchObject({ code: 'ENTITY_NOT_FOUND' });
  });
});
