import { describe, expect, it } from 'vitest';
import { LumenApplication, LumenFactory } from './application.js';
import { Module, Controller, Get, Injectable, DynamicModule, forRoot, forRootAsync, Version, Param } from './decorators.js';
import { ParseIntPipe } from './pipes.js';
import { Container } from './container.js';
import { RequestContext } from './request-context.js';
import { REQUEST_CONTEXT } from './contracts.js';
import type { LumenReply, LumenRequest, HttpAdapter, RouteDefinition } from './contracts.js';
import { BadRequestException, VersionNotSupportedException } from '@lumen/common';

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
  url: '/x',
  headers: {},
  body: undefined,
  query: {},
  params: {},
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

describe('request-scoped providers', () => {
  @Injectable({ scope: 'REQUEST' })
  class CtxService {
    readonly id = Math.random();
  }

  it('reuses the instance within a request and isolates across requests', async () => {
    const root = new Container();
    const ctx = new RequestContext();
    root.register({ provide: REQUEST_CONTEXT, useValue: ctx });
    root.register(CtxService);

    const { a, b } = await ctx.run({ requestId: '1' }, async () => {
      const a = await root.resolve(CtxService);
      const b = await root.resolve(CtxService);
      return { a, b };
    });
    expect(a).toBe(b);

    const d = await ctx.run({ requestId: '2' }, () => root.resolve(CtxService));
    expect(d).not.toBe(a);
  });

  it('falls back to a singleton when there is no active request context', async () => {
    const root = new Container();
    root.register(CtxService);
    const one = await root.resolve(CtxService);
    const two = await root.resolve(CtxService);
    expect(one).toBe(two);
  });
});

describe('dynamic modules (forRoot / forRootAsync)', () => {
  @Controller('/dyn')
  class DynController {
    @Get()
    get(): string { return 'dyn'; }
  }

  @Controller('/hosted')
  class HostedController {
    @Get()
    get(): string { return 'hosted'; }
  }

  // Dynamic module supplies DynController; Host contributes its own routes.
  @Module({ controllers: [HostedController] })
  class HostModule {}

  it('compiles an imported forRoot() dynamic descriptor', async () => {
    const dyn = forRoot(DynControllerContainer, { controllers: [DynController] });
    @Module({ imports: [dyn] })
    class RootModule {}

    const adapter = new MockAdapter();
    await LumenFactory.create(RootModule, adapter);
    const handler = adapter.handlers.get('GET /dyn');
    expect(handler).toBeDefined();
    await expect(handler!(mockRequest({ url: '/dyn' }), mockReply())).resolves.toBe('dyn');
  });

  it('compiles an imported forRootAsync() promise descriptor', async () => {
    const dyn = forRootAsync(DynControllerContainer, async () => ({ controllers: [DynController] }));
    @Module({ imports: [dyn] })
    class AsyncRootModule {}

    const adapter = new MockAdapter();
    await LumenFactory.create(AsyncRootModule, adapter);
    const handler = adapter.handlers.get('GET /dyn');
    await expect(handler!(mockRequest({ url: '/dyn' }), mockReply())).resolves.toBe('dyn');
  });
});

// A plain class used as the "identity module" of the dynamic descriptor.
class DynControllerContainer {}

describe('versioning via @Version()', () => {
  @Controller('/v')
  class VController {
    @Get()
    @Version('1')
    v1(): string { return 'v1'; }
  }

  @Module({ controllers: [VController] })
  class VModule {}

  it('allows a matching version and rejects a mismatched one', async () => {
    const adapter = new MockAdapter();
    const app = await LumenFactory.create(VModule, adapter, { versioning: { source: 'header', headerName: 'x-api-version' } });
    expect(app).toBeDefined();
    const handler = adapter.handlers.get('GET /v')!;

    const ok = await handler(mockRequest({ url: '/v', headers: { 'x-api-version': '1' } }), mockReply());
    expect(ok).toBe('v1');

    await expect(handler(mockRequest({ url: '/v', headers: { 'x-api-version': '2' } }), mockReply()))
      .rejects.toBeInstanceOf(VersionNotSupportedException);
  });

  it('allows requests that do not declare a version', async () => {
    const adapter = new MockAdapter();
    await LumenFactory.create(VModule, adapter, { versioning: { source: 'header' } });
    const handler = adapter.handlers.get('GET /v')!;
    await expect(handler(mockRequest({ url: '/v', headers: {} }), mockReply())).resolves.toBe('v1');
  });
});

describe('pipes', () => {
  @Controller('/p')
  class PController {
    @Get('/:id')
    get(@Param('id', new ParseIntPipe()) id: number): { id: number; type: string } {
      return { id, type: typeof id };
    }
  }

  @Module({ controllers: [PController] })
  class PModule {}

  it('transforms a parameter through a pipe', async () => {
    const adapter = new MockAdapter();
    await LumenFactory.create(PModule, adapter);
    const handler = adapter.handlers.get('GET /p/:id')!;
    const result = await handler(mockRequest({ url: '/p/42', params: { id: '42' } }), mockReply());
    expect(result).toEqual({ id: 42, type: 'number' });
  });

  it('propagates a pipe rejection as BadRequestException', async () => {
    const adapter = new MockAdapter();
    await LumenFactory.create(PModule, adapter);
    const handler = adapter.handlers.get('GET /p/:id')!;
    await expect(handler(mockRequest({ url: '/p/abc', params: { id: 'abc' } }), mockReply()))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
