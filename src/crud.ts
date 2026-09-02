import type { ConcreteClass, InjectionToken } from '@lumen/common';
import { BadRequestException, NotFoundException } from '@lumen/common';
import type { SchemaLike } from './contracts.js';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put } from './decorators.js';

/**
 * Minimal persistence port used by {@link CrudController}. Apps supply their own
 * store (in-memory, `@lumen/db`, etc.). All operations are async so stores
 * can back any driver.
 */
export interface CrudStore<T, ID = string> {
  list(): Promise<T[]>;
  find(id: ID): Promise<T | undefined>;
  create(input: unknown): Promise<T>;
  update(id: ID, input: unknown): Promise<T>;
  remove(id: ID): Promise<void>;
}

export interface EntitySchema<T> {
  create?: SchemaLike<T>;
  update?: SchemaLike<Partial<T>>;
}

export interface CrudControllerOptions<T, ID> {
  /** The DI token resolving to the {@link CrudStore}. */
  storeToken: InjectionToken<CrudStore<T, ID>>;
  /** Transform a raw route param into the entity id (defaults to string passthrough). */
  idTransform?: (raw: string) => ID;
  createSchema?: SchemaLike<T> | false;
  updateSchema?: SchemaLike<Partial<T>> | false;
}

/**
 * Auto-generate a full REST controller backed by a {@link CrudStore}.
 *
 * Generates: `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `PATCH /:id`, `DELETE /:id`.
 * Body arguments are validated with the optional schemas when supplied.
 *
 * @example
 * ```ts
 * const UsersController = createCrudController({
 *   storeToken: USER_STORE,
 *   createSchema: CreateUserSchema,
 *   updateSchema: UpdateUserSchema,
 * });
 * ```
 */
export function createCrudController<T, ID = string>(
  options: CrudControllerOptions<T, ID>,
  prefix = '',
): ConcreteClass {
  const {
    storeToken,
    idTransform = ((raw: string) => raw as unknown as ID),
  } = options;

  const toId = (raw: string): ID => {
    const id = idTransform(raw);
    if (id === undefined || id === null || id === '') {
      throw new BadRequestException('Invalid entity id', { id: raw }, 'INVALID_ENTITY_ID');
    }
    return id;
  };

  @Controller(prefix)
  class CrudControllerImpl {
    constructor(@Inject(storeToken) private readonly store: CrudStore<T, ID>) {}

    @Get()
    async list(): Promise<T[]> {
      return this.store.list();
    }

    @Get('/:id')
    async find(@Param('id') rawId: string): Promise<T> {
      const id = toId(rawId);
      const entity = await this.store.find(id);
      if (entity === undefined) {
        throw new NotFoundException('Entity not found', { id }, 'ENTITY_NOT_FOUND');
      }
      return entity;
    }

    @Post()
    @HttpCode(201)
    async create(@Body(options.createSchema as never) raw: unknown): Promise<T> {
      return this.store.create(raw);
    }

    @Put('/:id')
    async update(@Param('id') rawId: string, @Body(options.updateSchema as never) raw: unknown): Promise<T> {
      const id = toId(rawId);
      await this.requireExists(id);
      return this.store.update(id, raw);
    }

    @Patch('/:id')
    async patch(@Param('id') rawId: string, @Body(options.updateSchema as never) raw: unknown): Promise<T> {
      const id = toId(rawId);
      await this.requireExists(id);
      return this.store.update(id, raw);
    }

    @Delete('/:id')
    @HttpCode(204)
    async remove(@Param('id') rawId: string): Promise<void> {
      const id = toId(rawId);
      await this.requireExists(id);
      await this.store.remove(id);
    }

    private async requireExists(id: ID): Promise<void> {
      const entity = await this.store.find(id);
      if (entity === undefined) {
        throw new NotFoundException('Entity not found', { id }, 'ENTITY_NOT_FOUND');
      }
    }
  }

  return CrudControllerImpl;
}

/**
 * Convenience for declaring a module that registers a generated CRUD controller
 * plus its store provider. Returns a {@link ConcreteClass} suitable for `controllers`.
 */
export function crudController<T, ID = string>(
  store: InjectionToken<CrudStore<T, ID>>,
  options: Omit<CrudControllerOptions<T, ID>, 'storeToken'> = {},
  prefix = '',
): ConcreteClass {
  return createCrudController({ ...options, storeToken: store }, prefix);
}
