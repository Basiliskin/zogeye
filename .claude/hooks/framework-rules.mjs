#!/usr/bin/env node
// framework-rules.mjs — AST-проверки структурных правил NestJS/React
// (шесть семейств правил из deterministic-plan.md section 7) плюс проверка
// глобального ValidationPipe в bootstrap-коде (section 11).
//
//   node scripts/framework-rules.mjs
//
// Коды выхода: 0 — все правила соблюдены, 1 — есть нарушения (в stderr
// перечислены файл:строка:[правило] сообщение). Если tsconfig не найден —
// скрипт выходит с 0, как задумано в deterministic-plan.md.
//
// Все проверки работают через ts-morph AST, а не через regex по тексту:
// декораторы читаются из узлов декораторов, JSX-атрибуты — из JSX-узлов,
// process.env — из PropertyAccessExpression.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Project, SyntaxKind } from "ts-morph";

const cwd = process.cwd();

const config = fs.existsSync(path.join(cwd, "tsconfig.check.json"))
  ? path.join(cwd, "tsconfig.check.json")
  : fs.existsSync(path.join(cwd, "tsconfig.json"))
    ? path.join(cwd, "tsconfig.json")
    : null;

if (!config) {
  console.log("No tsconfig found. Skipping framework rules.");
  process.exit(0);
}

const project = new Project({
  tsConfigFilePath: config,
  skipAddingFilesFromTsConfig: false,
});

const violations = [];

const rel = (sourceFile) => path.relative(cwd, sourceFile.getFilePath());

const lineOf = (sourceFile, node) =>
  sourceFile.getLineAndColumnAtPos(node.getStart()).line;

const add = (sourceFile, node, rule, message) => {
  violations.push(
    `${rel(sourceFile)}:${lineOf(sourceFile, node)}: [${rule}] ${message}`,
  );
};

const hasDecorator = (node, name) => {
  const decorators = node.getDecorators?.();
  return (
    Array.isArray(decorators) &&
    decorators.some((d) => d.getName() === name)
  );
};

const httpDecorators = new Set([
  "Get",
  "Post",
  "Put",
  "Patch",
  "Delete",
  "Options",
  "Head",
  "All",
]);

const lifecycleMethods = new Set([
  "onModuleInit",
  "onModuleDestroy",
  "onApplicationBootstrap",
  "onApplicationShutdown",
  "beforeApplicationShutdown",
]);

const classValidatorDecorators = new Set([
  "IsString",
  "IsNumber",
  "IsBoolean",
  "IsArray",
  "IsEnum",
  "IsOptional",
  "IsNotEmpty",
  "IsEmail",
  "IsUUID",
  "IsDateString",
  "IsInt",
  "Min",
  "Max",
  "Length",
  "Matches",
  "ValidateNested",
  "IsObject",
  "IsNumberString",
]);

const isSkippedPath = (fullPath) =>
  fullPath.includes("node_modules") ||
  fullPath.includes("dist") ||
  fullPath.includes("build") ||
  fullPath.includes(".next");

const isEnvConfigFile = (filePath) =>
  /(^|\/)(env|config)\.(ts|tsx)$/.test(filePath) ||
  filePath.includes("/config/");

function checkNestController(sourceFile, filePath) {
  const classes = sourceFile.getClasses();
  if (classes.length === 0) {
    const first = sourceFile.getFirstDescendantByKind(SyntaxKind.ClassDeclaration);
    add(
      sourceFile,
      first ?? sourceFile.getStatements()[0] ?? sourceFile,
      "nestjs-controller-shape",
      "Nest controller file must contain a class.",
    );
    return;
  }
  for (const cls of classes) {
    if (!hasDecorator(cls, "Controller")) {
      add(
        sourceFile,
        cls,
        "nestjs-controller-shape",
        `class ${cls.getName() ?? "<anonymous>"} must have @Controller().`,
      );
    }
    for (const method of cls.getInstanceMethods()) {
      const methodName = method.getName();
      if (methodName.startsWith("_")) continue;
      if (lifecycleMethods.has(methodName)) continue;
      if (method.hasModifier(SyntaxKind.PrivateKeyword)) continue;
      if (method.hasModifier(SyntaxKind.ProtectedKeyword)) continue;
      const hasRouteDecorator = method
        .getDecorators()
        .some((decorator) => httpDecorators.has(decorator.getName()));
      if (!hasRouteDecorator) {
        add(
          sourceFile,
          method,
          "nestjs-controller-shape",
          `public controller method ${methodName} must have an HTTP route decorator such as @Get(), @Post(), etc.`,
        );
      }
    }
  }
}

function checkNestModule(sourceFile, filePath) {
  const classes = sourceFile.getClasses();
  if (classes.length === 0) {
    add(
      sourceFile,
      sourceFile.getStatements()[0] ?? sourceFile,
      "nestjs-module-shape",
      "Nest module file must contain a class.",
    );
    return;
  }
  for (const cls of classes) {
    if (!hasDecorator(cls, "Module")) {
      add(
        sourceFile,
        cls,
        "nestjs-module-shape",
        `class ${cls.getName() ?? "<anonymous>"} must have @Module().`,
      );
    }
  }
}

function checkNestService(sourceFile, filePath) {
  const classes = sourceFile.getClasses();
  for (const cls of classes) {
    if (!hasDecorator(cls, "Injectable")) {
      add(
        sourceFile,
        cls,
        "nestjs-service-shape",
        `service class ${cls.getName() ?? "<anonymous>"} must have @Injectable().`,
      );
    }
  }
}

function checkDto(sourceFile, filePath) {
  const classes = sourceFile.getClasses();
  for (const cls of classes) {
    const properties = cls.getProperties();
    const hasValidator = properties.some((prop) =>
      prop
        .getDecorators()
        .some((d) => classValidatorDecorators.has(d.getName())),
    );
    if (!hasValidator) {
      add(
        sourceFile,
        cls,
        "nestjs-dto-shape",
        `class ${cls.getName() ?? "<anonymous>"} must use class-validator decorators such as @IsString(), @IsNumber(), @IsOptional(), etc. on at least one property.`,
      );
    }
  }
}

function checkReact(sourceFile, filePath) {
  // JSXAttribute with name dangerouslySetInnerHTML
  const htmlAttrs = sourceFile.getDescendantsOfKind(
    SyntaxKind.JsxAttribute,
  );
  for (const attr of htmlAttrs) {
    const name = attr.getNameNode?.().getText() ?? attr.getName();
    if (name === "dangerouslySetInnerHTML") {
      add(
        sourceFile,
        attr,
        "react-danger-html",
        "dangerouslySetInnerHTML is forbidden.",
      );
    }
    if (name === "target") {
      const value = attr.getInitializer();
      const literal = value?.asKind(SyntaxKind.StringLiteral) ?? value;
      const raw = literal?.getLiteralText?.() ?? "";
      if (raw !== "_blank") continue;
      const relAttr = htmlAttrs.find(
        (a) => (a.getNameNode?.().getText() ?? a.getName()) === "rel",
      );
      const relLiteral = relAttr?.getInitializer();
      const relRaw = relLiteral?.getLiteralText?.() ?? "";
      if (!/noopener|noreferrer/.test(relRaw)) {
        add(
          sourceFile,
          attr,
          "react-target-blank",
          'target="_blank" must include rel="noopener noreferrer".',
        );
      }
    }
  }
}

function checkProcessEnv(sourceFile, filePath) {
  if (isEnvConfigFile(filePath)) return;
  const envAccesses = sourceFile
    .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
    .filter(
      (pa) =>
        pa.getName() === "env" &&
        pa.getExpression().getKind() === SyntaxKind.Identifier &&
        pa.getExpression().getText() === "process",
    );
  for (const pa of envAccesses) {
    add(
      sourceFile,
      pa,
      "process-env-restriction",
      "process.env access is only allowed in env/config files.",
    );
  }
}

function checkValidationPipe(project, sourceFiles) {
  // Правило срабатывает только для NestJS-проектов: хотя бы один
  // файл *.controller.ts / *.module.ts / *.service.ts / *.dto.ts.
  const isNest = sourceFiles.some(
    (sf) =>
      /\.(controller|module|service|dto)\.ts$/.test(sf.getFilePath()) &&
      !isSkippedPath(sf.getFilePath()),
  );
  if (!isNest) return;

  let useGlobalPipesCalls = [];
  for (const sf of sourceFiles) {
    if (isSkippedPath(sf.getFilePath())) continue;
    useGlobalPipesCalls.push(
      ...sf
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter((call) => {
          const expr = call.getExpression();
          return (
            expr.getKind() === SyntaxKind.PropertyAccessExpression &&
            expr.getName() === "useGlobalPipes"
          );
        }),
    );
  }

  if (useGlobalPipesCalls.length === 0) {
    const anchor = sourceFiles.find((sf) => /main\.ts$/.test(sf.getFilePath()));
    const target = anchor ?? sourceFiles[0];
    add(
      target,
      target.getStatements()[0] ?? target,
      "nestjs-validation-pipe",
      "global ValidationPipe wiring not found: bootstrap code must call app.useGlobalPipes(new ValidationPipe({ ... })).",
    );
    return;
  }

  for (const call of useGlobalPipesCalls) {
    const hasValidationPipe = call.getArguments().some(
      (arg) =>
        arg.getKind() === SyntaxKind.NewExpression &&
        arg.getExpression().getText() === "ValidationPipe",
    );
    if (!hasValidationPipe) {
      add(
        call.getSourceFile(),
        call,
        "nestjs-validation-pipe",
        "useGlobalPipes must receive new ValidationPipe({ ... }) as an argument.",
      );
    }
  }
}

const sourceFiles = project.getSourceFiles();

for (const sourceFile of sourceFiles) {
  const fullPath = sourceFile.getFilePath();
  if (isSkippedPath(fullPath)) continue;
  const filePath = rel(sourceFile);

  if (filePath.endsWith(".controller.ts")) checkNestController(sourceFile, filePath);
  if (filePath.endsWith(".module.ts")) checkNestModule(sourceFile, filePath);
  if (filePath.endsWith(".service.ts")) checkNestService(sourceFile, filePath);
  if (filePath.endsWith(".dto.ts")) checkDto(sourceFile, filePath);
  if (filePath.endsWith(".tsx")) checkReact(sourceFile, filePath);
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
    checkProcessEnv(sourceFile, filePath);
  }
}

checkValidationPipe(project, sourceFiles);

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Framework rules passed.");
