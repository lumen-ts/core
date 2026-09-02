# @lumen/core

O **núcleo** do framework Lumen: criação de aplicação, injeção de dependência, módulos/controllers/services, decorators HTTP, guards, interceptors, middleware, pipes, versionamento de API, **auto-CRUD** e request context.

Também **reexporta `@lumen/common`** (erros HTTP, tipos, paginação, versionamento).

```ts
import { LumenFactory, Module, Controller, Injectable, Get, createCrudController } from '@lumen/core';
```

---

## Exemplo mínimo

```ts
import { LumenFactory, Module, Controller, Injectable, Get } from '@lumen/core';
import { FastifyAdapter } from '@lumen/fastify';

@Injectable()
class AppService {
  hello() { return 'oi'; }
}

@Controller('/')
class AppController {
  constructor(private readonly svc: AppService) {}
  @Get() home() { return this.svc.hello(); }
}

@Module({ controllers: [AppController], providers: [AppService] })
class AppModule {}

const adapter = new FastifyAdapter({ logger: true });
const app = await LumenFactory.create(AppModule, adapter);
await app.listen({ port: 3000 });
```

---

## Módulos, Controllers e Providers

- **`@Module({ imports?, controllers?, providers?, exports?, global? })`** — agrupa o módulo. `ApiModule` é um alias.
- **`@Global()`**, **`@DynamicModule()`** + **`forRoot`/`forRootAsync`** — módulos globais e dinâmicos (estilo Nest).
- **`@Controller('/prefix')`** — marca uma classe como controller.
- **`@Injectable()`** — marca um provider; aceita `{ scope: 'SINGLETON' | 'REQUEST' }`.
- **`@Inject(token)`** — injeção explícita em parâmetro (fallback: `design:paramtypes` do TS).
- **`ModuleCompiler`** resolve módulos, controllers e rotas recursivamente; providers exportados de módulos importados ficam visíveis (encapsulamento estilo Nest).

### Providers

`providers` pode usar: classe, `{ provide, useValue }`, `{ provide, useClass, scope? }`, `{ provide, useFactory, inject?, scope? }`.

---

## Decorators de rota e parâmetro

| Categoria | Decorators |
| --- | --- |
| Métodos HTTP | `@Get('/x')`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head` |
| Parâmetros | `@Body(schema?)`, `@Query(key?, schema?)`, `@Param(key?, schema?)`, `@Header(key?, schema?)`, `@Req()` , `@Res()`, `@Ctx()` |
| Comportamento | `@UseGuards(...)`, `@UseInterceptors(...)`, `@UsePipes(...)`, `@UseMiddleware(...)`/`@UseBefore(...)`, `@Version(...)`, `@HttpCode(code)`, `@ResponseHeader(name, value)` |

Os decorators de parâmetro aceitam um **schema** (ex.: `zodSchema` de `@lumen/zod` ou um objeto com `.parse`) para validar/transformar o argumento.

---

## Guards, Interceptors e Middleware

- **`Guard`** — `canActivate(context): boolean \| Promise<boolean>`; lança `ForbiddenException` se `false`. Roda **após** middleware, antes dos args.
- **`Interceptor`** — `intercept(context, next)`; permite envolver a chamada do handler.
- **`Middleware`** — `use(req, reply, next)`; roda **antes** das guards. Pode escrever a resposta e **não chamar `next()`** para encurtar o pipeline.

`ExecutionContext` expõe `request`, `reply`, `route`, `controller`, `handler`.

---

## Pipes

Transformam argumentos resolvidos. Aplicáveis por rota/controller (`@UsePipes`) ou globalmente (`LumenApplicationOptions.pipes`).

| Pipe | Descrição |
| --- | --- |
| `ParseIntPipe` | Converte para inteiro. |
| `ParseFloatPipe` | Converte para número. |
| `ParseBoolPipe` | Converte `"1"/"true"/1` etc. em boolean. |
| `ParseUUIDPipe` | Valida UUID (v1-v5). |
| `ValidationPipe(schema)` | Valida/coage contra um `SchemaLike`. |

Todos aceitam `{ errorMessage?, optional? }` e lançam `BadRequestException` em falha (exceto quando `optional` e valor vazio).

---

## Versionamento de API

- `@Version(...versões)` em controller ou rota declara as versões suportadas.
- Configure `LumenApplicationOptions.versioning` (ver `resolveVersion`/`VersionResolverOptions` em `@lumen/common`).
- Se a versão solicitada não for suportada, lança `VersionNotSupportedException` (409).

---

## Auto-CRUD (`crud.ts`)

Gera um controller REST completo (~`GET /`, `GET /:id`, `POST /`, `PUT /:id`, `PATCH /:id`, `DELETE /:id`) a partir de um **store** e schemas opcionais.

```ts
const UsersController = createCrudController<Users, string>({
  storeToken: USER_STORE,          // token de um CrudStore<T, ID>
  createSchema: CreateUserSchema,  // opcional; false desativa validação
  updateSchema: UpdateUserSchema,
  // idTransform?: (raw: string) => ID,  // default: string
});
```

Interface do store port:

```ts
interface CrudStore<T, ID = string> {
  list(): Promise<T[]>;
  find(id: ID): Promise<T | undefined>;
  create(input: unknown): Promise<T>;
  update(id: ID, input: unknown): Promise<T>;
  remove(id: ID): Promise<void>;
}
```

**Funções**: `createCrudController(options, prefix?)` e `crudController(store, options?, prefix?)` (alias de conveniência). `idTransform` (default: string) converte o param da rota no ID da entidade.

> **Importante**: `createCrudController` retorna a classe do controller gerada dinamicamente — registre **essa classe** em `controllers` do `@Module`. O exemplo acima é ilustrativo; a assinatura real é `createCrudController<T, ID>(options, prefix?)` que devolve um `ConcreteClass`.

---

## Application

- **`LumenFactory.create(rootModule, adapter, options?)`** → cria e inicializa a app.
- **`LumenApplication`**: `init()`, `listen({ port, host? })`, `get<T>(token)`, `getHttpAdapter()`, `close(signal?)`.
- `LumenApplicationOptions`: `versioning?`, `pipes?` (globais), `middleware?` (globais).
- **Lifecycle hooks** (via providers): `OnModuleInit`, `OnApplicationBootstrap`, `OnApplicationShutdown(signal?)`. Executados em ordem (shutdown em ordem reversa).
- O adapter `HttpAdapter` é a porta para servidores (ex.: `@lumen/fastify`).

---

## Request Context

`RequestContext` (via `AsyncLocalStorage`) e `REQUEST_CONTEXT` fornecem dados por requisição (`requestId`, `traceId?`, `user?`, `tenantId?`, etc.) a qualquer provider, resolvendo providers `REQUEST`-scoped corretamente.

```ts
context.get('requestId');
context.set('user', user);
```

---

## Contratos/Interfaces

`contracts.ts` define: `SchemaLike`, `Provider`, `ModuleMetadata`, `DynamicModuleDescriptor`, `RouteDefinition`, `ExecutionContext`, `Guard`, `Interceptor`, `Middleware`, `HttpAdapter`, `LumenRequest`, `LumenReply`, `ListenOptions` e os hooks de lifecycle.

---

## Dependências

- `@lumen/common` (reamplo de utilitários) e `reflect-metadata` (importado no `index`).
- Veja também `@lumen/fastify` (adapter), `@lumen/zod` (schemas), `@lumen/openapi` (documentação), `@lumen/contract` (contract-first).
