# Framework Rules — справочник правил

Все проверки выполняются `scripts/framework-rules.mjs` через ts-morph AST
(декораторы, JSX-атрибуты, PropertyAccessExpression), а не через regex по
тексту файла. Правила перенесены из deterministic-plan.md: шесть семейств из
section 7 плюс проверка глобального ValidationPipe из section 11.

Скрипт анализирует проект через `tsconfig.check.json` (или `tsconfig.json`),
пропускает `node_modules/`, `dist/`, `build/`, `.next/`.

Коды выхода: `0` — правила соблюдены; `1` — есть нарушения; `0` — tsconfig не
найден (проверка пропущена, как задумано в deterministic-plan.md).

## 1. NestJS controller shape

| | |
|---|---|
| **Правило** | `*.controller.ts` должен содержать класс с `@Controller()`; каждый публичный метод класса должен иметь HTTP-декоратор маршрута. |
| **Что проверяется** | Класс в файле контроллера декорирован `@Controller()`; публичные методы (не private/protected, не начинающиеся с `_`, не lifecycle-хуки) имеют `@Get()`, `@Post()`, `@Put()`, `@Patch()`, `@Delete()`, `@Options()`, `@Head()` или `@All()`. |
| **Пример нарушения** | `users.controller.ts:12: [nestjs-controller-shape] public controller method list must have an HTTP route decorator such as @Get(), @Post(), etc.` |
| **Пример соответствия** | `@Controller("users") export class UsersController { @Get() list() { return []; } }` — класс декорирован `@Controller()`, метод имеет `@Get()`. |

## 2. NestJS module shape

| | |
|---|---|
| **Правило** | `*.module.ts` должен содержать класс с `@Module()`. |
| **Что проверяется** | Класс в файле модуля декорирован `@Module()`. |
| **Пример нарушения** | `app.module.ts:3: [nestjs-module-shape] class AppModule must have @Module().` |
| **Пример соответствия** | `@Module({ controllers: [UsersController], providers: [UsersService] }) export class AppModule {}` |

## 3. NestJS service shape

| | |
|---|---|
| **Правило** | `*.service.ts` должен содержать класс с `@Injectable()`. |
| **Что проверяется** | Класс в файле сервиса декорирован `@Injectable()`. |
| **Пример нарушения** | `users.service.ts:5: [nestjs-service-shape] service class UsersService must have @Injectable().` |
| **Пример соответствия** | `@Injectable() export class UsersService { findAll() { return []; } }` |

## 4. NestJS DTO shape

| | |
|---|---|
| **Правило** | `*.dto.ts` должен использовать декораторы class-validator. |
| **Что проверяется** | У каждого класса в файле DTO хотя бы одно свойство имеет декоратор из набора class-validator: `@IsString`, `@IsNumber`, `@IsBoolean`, `@IsArray`, `@IsEnum`, `@IsOptional`, `@IsNotEmpty`, `@IsEmail`, `@IsUUID`, `@IsDateString`, `@IsInt`, `@Min`, `@Max`, `@Length`, `@Matches`, `@ValidateNested`, `@IsObject`, `@IsNumberString`. |
| **Пример нарушения** | `create-user.dto.ts:7: [nestjs-dto-shape] class CreateUserDto must use class-validator decorators such as @IsString(), @IsNumber(), @IsOptional(), etc. on at least one property.` |
| **Пример соответствия** | `export class CreateUserDto { @IsString() @MinLength(2) name!: string; }` — свойство имеет `@IsString()`. |

## 5. React: dangerouslySetInnerHTML

| | |
|---|---|
| **Правило** | В `*.tsx` запрещён `dangerouslySetInnerHTML`. |
| **Что проверяется** | JSX-атрибут с именем `dangerouslySetInnerHTML` в любом JSX-элементе. |
| **Пример нарушения** | `profile.tsx:18: [react-danger-html] dangerouslySetInnerHTML is forbidden.` |
| **Пример соответствия** | `<p>{user.bio}</p>` — без атрибута `dangerouslySetInnerHTML`. |

## 6. React: target="_blank"

| | |
|---|---|
| **Правило** | `target="_blank"` должен сопровождаться `rel` c `noopener` или `noreferrer`. |
| **Что проверяется** | JSX-атрибут `target` со строковым значением `_blank`; рядом (в том же элементе) должен быть атрибут `rel`, значение которого содержит `noopener` или `noreferrer`. |
| **Пример нарушения** | `links.tsx:9: [react-target-blank] target="_blank" must include rel="noopener noreferrer".` |
| **Пример соответствия** | `<a href="https://example.com" target="_blank" rel="noopener noreferrer">go</a>` |

## 7. process.env restriction

| | |
|---|---|
| **Правило** | `process.env.*` разрешён только в env/config файлах. |
| **Что проверяется** | PropertyAccessExpression `process.env` (доступ к свойству `env` у идентификатора `process`) в любом `.ts`/`.tsx` файле, кроме тех, что попадают под `(^|/)(env|config)\.(ts|tsx)$` или содержат `/config/` в пути. Проверка по AST не ловит упоминания в комментариях и строках. |
| **Пример нарушения** | `src/db.ts:4: [process-env-restriction] process.env access is only allowed in env/config files.` |
| **Пример соответствия** | `src/config/env.ts: export const isProd = process.env.NODE_ENV === \"production\";` — файл env, доступ разрешён. |

## 8. NestJS global ValidationPipe (section 11)

| | |
|---|---|
| **Правило** | Bootstrap-код NestJS-приложения должен регистрировать глобальный `ValidationPipe` через `app.useGlobalPipes(new ValidationPipe(...))`. |
| **Что проверяется** | Проверка активна только если проект содержит NestJS-файлы (`*.controller.ts` / `*.module.ts` / `*.service.ts` / `*.dto.ts`). В таком проекте должен существовать вызов `app.useGlobalPipes`, и хотя бы один его аргумент — `new ValidationPipe({ ... })`. Если вызовов нет вовсе — нарушение; если вызов есть, но без `new ValidationPipe` — нарушение с указанием строки. |
| **Пример нарушения** | `src/main.ts:1: [nestjs-validation-pipe] global ValidationPipe wiring not found: bootstrap code must call app.useGlobalPipes(new ValidationPipe({ ... })).` |
| **Пример соответствия** | `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));` в bootstrap. |
