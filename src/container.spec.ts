import { describe, expect, it } from 'vitest';
import { Container } from './container.js';
import { Inject, Injectable } from './decorators.js';

const TOKEN = Symbol('token');
@Injectable()
class Service { constructor(@Inject(TOKEN) readonly value: string) {} }

describe('Container', () => {
  it('resolves constructor injection and caches singleton instances', async () => {
    const container = new Container();
    container.register({ provide: TOKEN, useValue: 'ok' });
    container.register(Service);
    const a = await container.resolve(Service);
    const b = await container.resolve(Service);
    expect(a.value).toBe('ok'); expect(a).toBe(b);
  });
});
