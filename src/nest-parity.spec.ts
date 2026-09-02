import { describe, expect, it } from 'vitest';
import { LumenFactory } from './application.js';
import { Module, Controller, Get, Injectable, Global, UsePipes, Param } from './decorators.js';
import type { LumenReply, LumenRequest, HttpAdapter, RouteDefinition, Pipe } from './contracts.js';
import { REQUEST_CONTEXT } from './contracts.js';
import { Container } from './container.js';
import { RequestContext } from './request-context.js';
import { NotFoundException } from '@lumen/common';

class MockAdapter implements HttpAdapter {
  routes: RouteDefinition[] = [];
  handlers = new Map<string, (req: LumenRequest, reply: LumenReply) => Promise<unknown>>();
  registerRoute(route: RouteDefinition, handler: (request: LumenRequest, reply: LumenReply) => Promise<unknown>): void {
    this.routes.push(route);
    this.handlers.set(`${route.method} ${route.path}`, handler);
  }
  async listen(): Promise<string | void> { return 'http://localhost:3000'; }
  async close(): Promise<void> { return; }
  getInstance<T = unknown>(): T { return undefined as T; }
}

const mockRequest = (overrides: Partial<LumenRequest> = {}): LumenRequest => ({
  id: 'req-1',
  method: 'GET',
  url: '/',
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

describe('module encapsulation via exports', () => {
  @Injectable()
  class InfoService {
    value(): string { return 'exported'; }
  }

  @Injectable()
  class SecretService {
    value(): string { return 'secret'; }
  }

  @Module({ providers: [InfoService, SecretService], exports: [InfoService] })
  class SharedModule {}

  @Controller('/feature')
  class FeatureController {
    constructor(private readonly info: InfoService) {}
    @Get()
    get(): string { return this.info.value(); }
  }

  @Module({ imports: [SharedModule], controllers: [FeatureController] })
  class FeatureModule {}

  it('exposes an exported provider of an imported module', async () => {
    const adapter = new MockAdapter();
    await LumenFactory.create(FeatureModule, adapter);
    const handler = adapter.handlers.get('GET /feature')!;
    await expect(handler(mockRequest({ url: '/feature' }), mockReply())).resolves.toBe('exported');
  });

  it('does not expose a non-exported provider across modules', async () => {
    @Controller('/bad')
    class BadController {
      constructor(private readonly secret: SecretService) {}
      @Get()
      get(): string { return this.secret.value(); }
    }
    @Module({ imports: [SharedModule], controllers: [BadController] })
    class BadModule {}

    const adapter = new MockAdapter();
    await expect(LumenFactory.create(BadModule, adapter)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('global modules', () => {
  @Injectable()
  class EnvService {
    region(): string { return 'sa-east-1'; }
  }

  @Global()
  @Module({ providers: [EnvService], exports: [EnvService] })
  class GlobalModule {}

  @Controller('/env')
  class EnvController {
    constructor(private readonly env: EnvService) {}
    @Get()
    get(): string { return this.env.region(); }
  }

  @Module({ controllers: [EnvController] })
  class AppModule {}

  it('injects a global provider without importing the module', async () => {
    @Module({ imports: [GlobalModule, AppModule] })
    class RootWithGlobal {}

    const adapter = new MockAdapter();
    await LumenFactory.create(RootWithGlobal, adapter);
    const handler = adapter.handlers.get('GET /env')!;
    await expect(handler(mockRequest({ url: '/env' }), mockReply())).resolves.toBe('sa-east-1');
  });
});

describe('nested request-scoped providers', () => {
  @Injectable({ scope: 'REQUEST' })
  class Leaf {
    readonly id = Math.random();
  }

  @Injectable({ scope: 'REQUEST' })
  class Branch {
    readonly id = Math.random();
    constructor(readonly leaf: Leaf) {}
  }

  it('creates one instance per request and shares across nested deps', async () => {
    const root = new Container();
    const ctx = new RequestContext();
    root.register({ provide: REQUEST_CONTEXT, useValue: ctx });
    root.register(Leaf);
    root.register(Branch);

    const first = await ctx.run({ requestId: '1' }, async () => {
      const branch = await root.resolve(Branch);
      const leaf = await root.resolve(Leaf);
      return { branch, leaf };
    });
    const second = await ctx.run({ requestId: '2' }, async () => root.resolve(Branch));

    expect(first.branch).not.toBe(second);
    expect(first.branch.leaf).not.toBe(second.leaf);
    expect(first.branch.leaf).toBe(first.leaf);
  });
});

describe('global, controller and route pipes', () => {
  const append = (suffix: string): Pipe => ({ transform: (value: unknown) => String(value) + suffix });

  @Controller('/pipe')
  @UsePipes(append('-ctrl'))
  class PipeController {
    @Get('/route')
    route(@Param('q') q: unknown): string { return String(q); }
  }

  @Controller('/g')
  class GController {
    @Get('')
    g(@Param('q') q: unknown): string { return String(q); }
  }

  @Module({ controllers: [PipeController, GController] })
  class PipeModule {}

  it('applies a controller-level pipe to the argument', async () => {
    const adapter = new MockAdapter();
    await LumenFactory.create(PipeModule, adapter);
    const handler = adapter.handlers.get('GET /pipe/route')!;
    const result = await handler(mockRequest({ url: '/pipe/route', params: { q: 'a' } }), mockReply());
    expect(result).toBe('a-ctrl');
  });

  it('applies a route-level pipe to the argument', async () => {
    @Controller('/r')
    class RController {
      @Get('/route')
      @UsePipes(append('-route'))
      route(@Param('q') q: unknown): string { return String(q); }
    }
    @Module({ controllers: [RController] })
    class RModule {}

    const adapter = new MockAdapter();
    await LumenFactory.create(RModule, adapter);
    const handler = adapter.handlers.get('GET /r/route')!;
    const result = await handler(mockRequest({ url: '/r/route', params: { q: 'b' } }), mockReply());
    expect(result).toBe('b-route');
  });

  it('applies a global pipe to every argument', async () => {
    const adapter = new MockAdapter();
    const app = await LumenFactory.create(PipeModule, adapter, { pipes: [append('-global')] });
    await app.listen({ port: 0 });
    const handler = adapter.handlers.get('GET /g')!;
    const result = await handler(mockRequest({ url: '/g', params: { q: 'c' } }), mockReply());
    expect(result).toBe('c-global');
  });
});
