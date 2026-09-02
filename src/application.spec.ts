import { describe, expect, it } from 'vitest';
import { LumenApplication, LumenFactory } from './application.js';
import { Module, Controller, Get, Param, Injectable } from './decorators.js';
import type { LumenReply, LumenRequest, HttpAdapter, RouteDefinition } from './contracts.js';
import { ForbiddenException, InternalServerErrorException, NotFoundException } from '@lumen/common';
import { Container } from './container.js';

@Injectable()
class Greeter {
  greet(name: string): string { return `Hello ${name}`; }
}

@Controller('/hello')
class HelloController {
  constructor(private readonly greeter: Greeter) {}
  @Get('/:name')
  get(@Param('name') name: string): string {
    return this.greeter.greet(name);
  }
}

@Module({ controllers: [HelloController], providers: [Greeter] })
class HelloModule {}

class MockAdapter implements HttpAdapter {
  routes: RouteDefinition[] = [];
  handlers = new Map<string, (req: LumenRequest, reply: LumenReply) => Promise<unknown>>();
  closed = false;
  registerRoute(route: RouteDefinition, handler: (request: LumenRequest, reply: LumenReply) => Promise<unknown>): void {
    this.routes.push(route);
    this.handlers.set(`${route.method} ${route.path}`, handler);
  }
  async listen(): Promise<string | void> { return 'http://localhost:3000'; }
  async close(): Promise<void> { this.closed = true; }
  getInstance<T = unknown>(): T { return undefined as T; }
}

const mockRequest = (overrides: Partial<LumenRequest> = {}): LumenRequest => ({
  id: 'req-1',
  method: 'GET',
  url: '/hello/world',
  headers: {},
  body: undefined,
  query: {},
  params: { name: 'world' },
  raw: {},
  ...overrides,
});

const mockReply = (): LumenReply & { payload: unknown } => {
  const reply: LumenReply & { payload: unknown } = {
    payload: undefined,
    status() { return reply; },
    header() { return reply; },
    send(payload) { reply.payload = payload; return reply; },
    raw: {},
  };
  return reply;
};

describe('LumenApplication', () => {
  it('registers routes and executes the controller handler', async () => {
    const adapter = new MockAdapter();
    const app = await LumenFactory.create(HelloModule, adapter);
    expect(adapter.routes).toHaveLength(1);
    expect(adapter.routes[0]!.path).toBe('/hello/:name');

    const handler = adapter.handlers.get('GET /hello/:name')!;
    const reply = mockReply();
    const result = await handler(mockRequest(), reply);
    expect(result).toBe('Hello world');
  });

  it('get() resolves a registered provider', async () => {
    const adapter = new MockAdapter();
    const app = await LumenFactory.create(HelloModule, adapter);
    const greeter = await app.get(Greeter);
    expect(greeter.greet('a')).toBe('Hello a');
  });

  it('close() runs lifecycle and closes the adapter', async () => {
    const adapter = new MockAdapter();
    const app = await LumenFactory.create(HelloModule, adapter);
    await app.close();
    expect(adapter.closed).toBe(true);
  });

  it('is idempotent across init() calls', async () => {
    const adapter = new MockAdapter();
    const app = new LumenApplication(HelloModule, adapter);
    await app.init();
    await app.init();
    expect(adapter.routes).toHaveLength(1);
  });
});

@Controller('/boom')
class BoomController {
  @Get()
  fail(): never { throw new Error('boom'); }
}

@Module({ controllers: [BoomController] })
class BoomModule {}

@Controller('/forbidden')
class ForbiddenRouteController {
  @Get()
  nope(): string { throw new ForbiddenException(); }
}

@Module({ controllers: [ForbiddenRouteController] })
class ForbiddenModule {}

describe('LumenApplication error handling', () => {
  it('wraps non-HttpException errors as InternalServerErrorException', async () => {
    const adapter = new MockAdapter();
    await LumenFactory.create(BoomModule, adapter);
    const handler = adapter.handlers.get('GET /boom')!;
    const reply = mockReply();
    await expect(handler(mockRequest({ url: '/boom' }), reply)).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('propagates HttpException instances unchanged', async () => {
    const adapter = new MockAdapter();
    await LumenFactory.create(ForbiddenModule, adapter);
    const handler = adapter.handlers.get('GET /forbidden')!;
    const reply = mockReply();
    await expect(handler(mockRequest({ url: '/forbidden' }), reply)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('Container with named errors', () => {
  it('throws NotFoundException with machine-readable code for missing provider', async () => {
    const container = new Container();
    const missing = Symbol('missing');
    await expect(container.resolve(missing)).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' });
  });
});
