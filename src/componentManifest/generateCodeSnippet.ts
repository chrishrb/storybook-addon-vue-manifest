import { generate, types as t } from 'storybook/internal/babel';

import type { ComponentMeta } from 'vue-component-meta';

import { lowercaseFirstLetter } from '../vueComponentMetaUtils.ts';

/**
 * Extract the `args` AST node from a CSF meta or story ObjectExpression. Returns the
 * ObjectExpression node for `args`, or undefined.
 */
export function extractArgsNode(
  node: t.ObjectExpression | undefined
): t.ObjectExpression | undefined {
  if (!node) {
    return undefined;
  }

  const argsProp = node.properties.find(
    (p): p is t.ObjectProperty => t.isObjectProperty(p) && keyOf(p) === 'args'
  );

  return argsProp && t.isObjectExpression(argsProp.value) ? argsProp.value : undefined;
}

/**
 * Convert an AST ObjectExpression into a plain Record<string, unknown>. Only handles literal
 * values (strings, numbers, booleans, null, arrays, nested objects). Non-literal values
 * (identifiers, functions, etc.) produce undefined.
 */
function astObjectToRecord(node: t.ObjectExpression): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const prop of node.properties) {
    if (!t.isObjectProperty(prop)) {
      continue;
    }
    const key = keyOf(prop);
    if (!key) {
      continue;
    }
    result[key] = astNodeToValue(prop.value);
  }
  return result;
}

/** Convert a single AST node to a JavaScript value. Returns undefined for unresolvable expressions. */
function astNodeToValue(node: t.Node): unknown {
  if (t.isStringLiteral(node)) {
    return node.value;
  }
  if (t.isNumericLiteral(node)) {
    return node.value;
  }
  if (t.isBooleanLiteral(node)) {
    return node.value;
  }
  if (t.isNullLiteral(node)) {
    return null;
  }
  if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument)) {
    return -node.argument.value;
  }
  if (t.isArrayExpression(node)) {
    return node.elements.map((el) => (el ? astNodeToValue(el) : undefined));
  }
  if (t.isObjectExpression(node)) {
    return astObjectToRecord(node);
  }
  if (t.isTemplateLiteral(node) && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  }
  // For function expressions, arrow functions, identifiers, etc. → return undefined
  // (they can't be meaningfully serialized into a Vue template)
  return undefined;
}

/** Extract the property key name from an ObjectProperty node. */
function keyOf(prop: t.ObjectProperty | t.ObjectMethod): string | undefined {
  if (t.isIdentifier(prop.key)) {
    return prop.key.name;
  }
  if (t.isStringLiteral(prop.key)) {
    return prop.key.value;
  }
  return undefined;
}

/** Merge meta-level and story-level args AST nodes into a single record. */
export function mergeArgsFromAst(
  metaNode: t.ObjectExpression | undefined,
  storyAnnotations: Record<string, t.Node> | undefined
): Record<string, unknown> {
  const metaArgs = metaNode ? extractArgsNode(metaNode) : undefined;
  const storyArgsNode = storyAnnotations?.args;
  const storyArgs =
    storyArgsNode && t.isObjectExpression(storyArgsNode) ? storyArgsNode : undefined;

  const metaRecord = metaArgs ? astObjectToRecord(metaArgs) : {};
  const storyRecord = storyArgs ? astObjectToRecord(storyArgs) : {};

  return { ...metaRecord, ...storyRecord };
}

/**
 * Reduce a multi-line string to a clean snippet: strip leading/trailing blank lines and remove the
 * common leading indentation shared by all non-empty lines. Mirrors what `ts-dedent` does for the
 * literal templates authors write inside a story's `render` function.
 */
function dedentTemplate(value: string): string {
  const lines = value.replace(/^\n+/, '').replace(/\s+$/, '').split('\n');
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(minIndent)).join('\n');
}

/** Stringify a TemplateLiteral, printing `${expr}` interpolations back to source. */
function templateLiteralToString(node: t.TemplateLiteral): string {
  let result = '';
  node.quasis.forEach((quasi, i) => {
    result += quasi.value.cooked ?? quasi.value.raw;
    const expr = node.expressions[i];
    if (expr) {
      result += `\${${generate(expr).code}}`;
    }
  });
  return result;
}

/**
 * Find the ObjectExpression a render function returns, whether written as a concise arrow body
 * (`() => ({ template })`) or a block body with a `return` statement.
 */
function getReturnedObject(
  node: t.ArrowFunctionExpression | t.FunctionExpression
): t.ObjectExpression | undefined {
  if (t.isObjectExpression(node.body)) {
    return node.body;
  }
  if (t.isBlockStatement(node.body)) {
    for (const statement of node.body.body) {
      if (t.isReturnStatement(statement) && t.isObjectExpression(statement.argument)) {
        return statement.argument;
      }
    }
  }
  return undefined;
}

/**
 * Extract the literal `template` string from a story-level `render` function node, e.g.
 *
 * ```ts
 * render: () => ({ components: { Button }, template: `<Button>x</Button>` })
 * ```
 *
 * Returns the dedented template when the render returns an object with a string/template-literal
 * `template` property, otherwise undefined (the caller then falls back to args-based generation).
 */
export function extractRenderTemplate(node: t.Node | undefined): string | undefined {
  if (!node || (!t.isArrowFunctionExpression(node) && !t.isFunctionExpression(node))) {
    return undefined;
  }

  const returned = getReturnedObject(node);
  const templateProp = returned?.properties.find(
    (p): p is t.ObjectProperty => t.isObjectProperty(p) && keyOf(p) === 'template'
  );
  if (!templateProp) {
    return undefined;
  }

  const value = templateProp.value;
  if (t.isStringLiteral(value)) {
    return dedentTemplate(value.value);
  }
  if (t.isTemplateLiteral(value)) {
    return dedentTemplate(templateLiteralToString(value));
  }
  return undefined;
}

/** AST keys that hold position/comment data rather than child nodes — skipped while walking. */
const NON_CHILD_KEYS = new Set([
  'loc',
  'start',
  'end',
  'range',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'comments',
  'tokens',
]);

/** Depth-first walk over every descendant AST node (including the root), invoking `visit` on each. */
export function walkAst(node: t.Node, visit: (n: t.Node) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (NON_CHILD_KEYS.has(key)) {
      continue;
    }
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof (child as t.Node).type === 'string') {
          walkAst(child as t.Node, visit);
        }
      }
    } else if (value && typeof (value as t.Node).type === 'string') {
      walkAst(value as t.Node, visit);
    }
  }
}

/** Collect every identifier name referenced anywhere within an AST node. */
function collectReferencedNames(node: t.Node): Set<string> {
  const names = new Set<string>();
  walkAst(node, (n) => {
    if (t.isIdentifier(n)) {
      names.add(n.name);
    }
  });
  return names;
}

/**
 * Index the top-level value/type declarations of a CSF program by name, so a story's `render` can
 * be made self-contained by inlining the module-level `const columns = …` / helper / type it
 * references. Story and meta declarations in `excludeNames` are skipped — a render referencing
 * another story export is not a definition worth inlining.
 */
function collectModuleDeclarations(
  programBody: t.Statement[],
  excludeNames: ReadonlySet<string>
): Map<string, t.Statement> {
  const declarations = new Map<string, t.Statement>();

  const register = (name: string, statement: t.Statement) => {
    if (!excludeNames.has(name) && !declarations.has(name)) {
      declarations.set(name, statement);
    }
  };

  for (const stmt of programBody) {
    // Unwrap `export const x = …` / `export function x() {}` to the underlying declaration so the
    // inlined source reads as a plain definition rather than a re-export.
    const declaration = t.isExportNamedDeclaration(stmt) && stmt.declaration ? stmt.declaration : stmt;

    if (t.isVariableDeclaration(declaration)) {
      for (const declarator of declaration.declarations) {
        if (t.isIdentifier(declarator.id)) {
          register(declarator.id.name, declaration);
        }
      }
    } else if (
      (t.isFunctionDeclaration(declaration) ||
        t.isTSTypeAliasDeclaration(declaration) ||
        t.isTSInterfaceDeclaration(declaration) ||
        t.isClassDeclaration(declaration)) &&
      declaration.id
    ) {
      register(declaration.id.name, declaration);
    }
  }

  return declarations;
}

/**
 * Generate a self-contained source snapshot of a story's `render` function: the verbatim render
 * (its `components`/`setup`/`data`/`template` — not just the template string the {@link
 * generateVueSnippet} path captures), preceded by the module-level declarations it references
 * (`const columns = …`, helpers, local types), resolved transitively so the snippet is readable on
 * its own.
 *
 * Returns `undefined` when the story has no `render` function (args-only stories, where the snippet
 * already conveys everything).
 */
export function extractStorySource(
  renderNode: t.Node | undefined,
  programBody: t.Statement[],
  excludeNames: ReadonlySet<string>
): string | undefined {
  if (
    !renderNode ||
    (!t.isArrowFunctionExpression(renderNode) && !t.isFunctionExpression(renderNode))
  ) {
    return undefined;
  }

  const declarations = collectModuleDeclarations(programBody, excludeNames);

  // Transitively gather the declarations the render references (and the declarations those
  // reference), so a snapshot that uses `columns` also carries the helper `columns` is built from.
  const needed = new Set<string>();
  const queue = [...collectReferencedNames(renderNode)];
  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined || needed.has(name) || !declarations.has(name)) {
      continue;
    }
    needed.add(name);
    for (const dep of collectReferencedNames(declarations.get(name)!)) {
      if (!needed.has(dep)) {
        queue.push(dep);
      }
    }
  }

  // Emit the needed declarations in their original program order, then the render itself. A
  // multi-declarator `const a = …, b = …` maps several names to one statement — dedupe by node so
  // it is printed once.
  const orderedDeclarations: string[] = [];
  const emitted = new Set<t.Statement>();
  for (const [name, statement] of declarations) {
    if (needed.has(name) && !emitted.has(statement)) {
      emitted.add(statement);
      orderedDeclarations.push(generate(statement).code);
    }
  }

  const renderCode = `render: ${generate(renderNode).code}`;
  return [...orderedDeclarations, renderCode].join('\n\n');
}

/** Classification of a single arg against the component's extracted meta. */
type ArgKind = 'prop' | 'event' | 'slot';

function classifyArg(key: string, value: unknown, meta: ComponentMeta | undefined): ArgKind {
  if (meta) {
    if (meta.events.some((event) => event.name === key)) {
      return 'event';
    }
    if (/^on[A-Z]/.test(key)) {
      const eventName = lowercaseFirstLetter(key.replace(/^on/, ''));
      if (meta.events.some((event) => event.name === eventName)) {
        return 'event';
      }
    }
    if (meta.slots.some((slot) => slot.name === key) && typeof value === 'string') {
      return 'slot';
    }
    if (meta.props.some((prop) => prop.name === key)) {
      return 'prop';
    }
  }
  // Best-effort classification when the component meta is unavailable or the arg
  // does not match any known prop/event/slot.
  if (/^on[A-Z]/.test(key)) {
    return 'event';
  }
  if (key === 'default' && typeof value === 'string') {
    return 'slot';
  }
  return 'prop';
}

/** Vue event name for an arg key, mapping `onClick` → `click`. */
function toEventName(key: string) {
  return /^on[A-Z]/.test(key) ? lowercaseFirstLetter(key.replace(/^on/, '')) : key;
}

/**
 * Generate a Vue template snippet for a given story.
 *
 * Uses the merged args (meta + story) from the CSF AST and the vue-component-meta data to decide
 * between prop bindings, event listeners and slot content.
 *
 * @example
 *
 * ```html
 * <Button primary label="Click me" :count="3" @click="onClick">Slot content</Button>
 * ```
 */
export function generateVueSnippet(
  args: Record<string, unknown> | undefined,
  componentMeta: ComponentMeta | undefined,
  tagName: string
): string {
  if (!args || Object.keys(args).length === 0) {
    return `<${tagName} />`;
  }

  const bindings: string[] = [];
  const children: string[] = [];

  for (const [key, value] of Object.entries(args)) {
    switch (classifyArg(key, value, componentMeta)) {
      case 'event': {
        bindings.push(`@${toEventName(key)}="${key}"`);
        break;
      }
      case 'slot': {
        if (key === 'default') {
          children.unshift(String(value));
        } else {
          children.push(`<template #${key}>${String(value)}</template>`);
        }
        break;
      }
      case 'prop': {
        bindings.push(formatVueBinding(key, value));
        break;
      }
    }
  }

  const bindingsStr = bindings.length > 0 ? ' ' + bindings.join(' ') : '';

  if (children.length === 0) {
    return `<${tagName}${bindingsStr} />`;
  }
  return `<${tagName}${bindingsStr}>${children.join('')}</${tagName}>`;
}

/**
 * Format a single Vue template binding.
 *
 * - String → name="value"
 * - Boolean true → bare attribute
 * - Boolean false/number/null → :name="value"
 * - Object/array → :name="serialized"
 * - Unresolvable → :name="name" placeholder
 */
function formatVueBinding(name: string, value: unknown): string {
  if (typeof value === 'string') {
    return `${name}="${value.replaceAll('"', '&quot;')}"`;
  }
  if (value === true) {
    return name;
  }
  if (typeof value === 'boolean' || typeof value === 'number' || value === null) {
    return `:${name}="${value}"`;
  }
  if (typeof value === 'object') {
    const serialized = stringifyCircular(value)
      .replaceAll("'", '’')
      .replaceAll(String.raw`\"`, '”')
      .replaceAll(/"([^-"]+)":/g, '$1: ')
      .replaceAll('"', "'")
      .replaceAll('’', String.raw`\'`)
      .replaceAll('”', String.raw`\'`)
      .split(',')
      .join(', ');
    return `:${name}="${serialized}"`;
  }

  // Fallback for unresolvable expressions: use the variable name
  return `:${name}="${name}"`;
}

/** Stringify an object with a placeholder for circular references. */
function stringifyCircular(obj: unknown): string {
  const seen = new Set();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });
}
