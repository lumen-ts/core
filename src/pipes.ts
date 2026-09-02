import { BadRequestException } from '@lumen/common';
import type { Pipe, SchemaLike } from './contracts.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Parse a string (or number) into an integer. */
export class ParseIntPipe implements Pipe {
  constructor(private readonly options: { errorMessage?: string; optional?: boolean } = {}) {}

  transform(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') {
      if (this.options.optional) return undefined;
      throw new BadRequestException(this.options.errorMessage ?? 'Expected an integer');
    }
    const n = Number(value);
    if (!Number.isInteger(n)) {
      throw new BadRequestException(this.options.errorMessage ?? `Expected an integer, got "${String(value)}"`);
    }
    return n;
  }
}

/** Parse a "1"/"0"/"true"/"false" value into a boolean. */
export class ParseBoolPipe implements Pipe {
  constructor(private readonly options: { errorMessage?: string; optional?: boolean } = {}) {}

  transform(value: unknown): boolean | undefined {
    if (value === undefined || value === null || value === '') {
      if (this.options.optional) return undefined;
      throw new BadRequestException(this.options.errorMessage ?? 'Expected a boolean');
    }
    if (value === true || value === 1 || value === '1' || value === 'true') return true;
    if (value === false || value === 0 || value === '0' || value === 'false') return false;
    throw new BadRequestException(this.options.errorMessage ?? `Expected a boolean, got "${String(value)}"`);
  }
}

/** Parse a string into a float. */
export class ParseFloatPipe implements Pipe {
  constructor(private readonly options: { errorMessage?: string; optional?: boolean } = {}) {}

  transform(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') {
      if (this.options.optional) return undefined;
      throw new BadRequestException(this.options.errorMessage ?? 'Expected a number');
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new BadRequestException(this.options.errorMessage ?? `Expected a number, got "${String(value)}"`);
    }
    return n;
  }
}

/** Validate that a value looks like a UUID (v1-v5). */
export class ParseUUIDPipe implements Pipe {
  constructor(private readonly options: { errorMessage?: string; optional?: boolean } = {}) {}

  transform(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') {
      if (this.options.optional) return undefined;
      throw new BadRequestException(this.options.errorMessage ?? 'Expected a UUID');
    }
    const str = String(value);
    if (!UUID_RE.test(str)) {
      throw new BadRequestException(this.options.errorMessage ?? `Expected a valid UUID, got "${str}"`);
    }
    return str;
  }
}

/** Validate and coerce a value against a {@link SchemaLike} (e.g. a Zod schema). */
export class ValidationPipe implements Pipe {
  constructor(private readonly schema: SchemaLike) {}

  transform(value: unknown): unknown {
    return this.schema.parse(value);
  }
}
