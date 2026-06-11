import { types as t } from 'storybook/internal/babel';

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
