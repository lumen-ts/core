import { describe, expect, it } from 'vitest';
import { RequestContext } from './request-context.js';
import { InternalServerErrorException } from '@lumen/common';

describe('RequestContext', () => {
  it('stores and retrieves values within a run scope', () => {
    const context = new RequestContext();
    const result = context.run({ requestId: 'req-1' }, () => {
      context.set('tenantId', 'tenant-a');
      return context.get('requestId') + ':' + context.get('tenantId');
    });
    expect(result).toBe('req-1:tenant-a');
  });

  it('returns undefined outside of a run scope', () => {
    const context = new RequestContext();
    expect(context.get('requestId')).toBeUndefined();
  });

  it('throws a framework error when setting outside a run scope', () => {
    const context = new RequestContext();
    let caught: unknown;
    try {
      context.set('key', 'value');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InternalServerErrorException);
    expect((caught as InternalServerErrorException).code).toBe('NO_ACTIVE_CONTEXT');
  });
});
