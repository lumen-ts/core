import { describe, expect, it } from 'vitest';
import { ModuleCompiler } from './module-compiler.js';
import { Module, Controller, Get, Injectable } from './decorators.js';
import { Container } from './container.js';
import type { HttpAdapter, RouteDefinition } from './contracts.js';
import type { LumenRequest, LumenReply } from './contracts.js';

@Injectable()
class Service {
  hello(): string { return 'world'; }
}

@Controller('/users')
class UsersController {
  constructor(private readonly service: Service) {}
  @Get('/all')
  list(): { service: string } { return { service: this.service.hello() }; }
}

@Module({ controllers: [UsersController], providers: [Service] })
class UsersModule {}

describe('ModuleCompiler', () => {
  it('compiles a module and exposes routes', async () => {
    const container = new Container();
    const compiler = new ModuleCompiler(container);
    const compiled = await compiler.compile(UsersModule);
    expect(compiled.routes).toHaveLength(1);
    expect(compiled.routes[0]!.method).toBe('GET');
    expect(compiled.routes[0]!.path).toBe('/users/all');
    expect(compiled.controllers).toHaveLength(1);
  });

  it('caches compiled modules', async () => {
    const container = new Container();
    const compiler = new ModuleCompiler(container);
    const a = await compiler.compile(UsersModule);
    const b = await compiler.compile(UsersModule);
    expect(a).toBe(b);
  });

  it('throws a framework error for non-module classes', async () => {
    const container = new Container();
    const compiler = new ModuleCompiler(container);
    class NotAModule {}
    await expect(compiler.compile(NotAModule)).rejects.toMatchObject({ code: 'MODULE_NOT_DECORATED' });
  });
});

describe('joinPaths behavior via compiled routes', () => {
  @Controller('') class RootController {
    @Get() root(): string { return 'ok'; }
  }
  @Module({ controllers: [RootController] }) class RootModule {}

  it('joins empty prefix and empty path to root', async () => {
    const container = new Container();
    const compiler = new ModuleCompiler(container);
    const compiled = await compiler.compile(RootModule);
    expect(compiled.routes[0]!.path).toBe('/');
  });
});
