import type {
  ComponentMeta,
  EventMeta,
  ExposeMeta,
  PropertyMeta,
  PropertyMetaSchema,
  SlotMeta,
} from 'vue-component-meta';

/**
 * The stock `@storybook/mcp` server renders component APIs from React-shaped docgen fields
 * (`reactDocgen` / `reactDocgenTypescript` / `reactComponentMeta`) and drops any unknown manifest
 * keys during valibot validation — so a Vue-only `vueComponentMeta` field never reaches its
 * formatter. To make Vue manifests render on the *unmodified* published server, this module
 * projects vue-component-meta into:
 *   - `reactComponentMeta` (props), consumed by the server's `## Props` formatter, and
 *   - a Markdown API block (events/slots/exposed) folded into the component description, which the
 *     server renders verbatim.
 */

/** React-docgen-typescript-shaped prop payload understood by `@storybook/mcp`'s `parseReactComponentMeta`. */
export interface ReactComponentMeta {
  props: Record<
    string,
    {
      description?: string;
      type?: { name?: string; raw?: string };
      defaultValue?: { value: string };
      required?: boolean;
    }
  >;
}

/**
 * Serializes a vue-component-meta schema into a TypeScript-like type string, expanding the resolved
 * structure (union members, object shapes, array elements) rather than leaving an opaque alias.
 */
function serializeSchema(schema: PropertyMetaSchema): string {
  if (typeof schema === 'string') {
    return schema;
  }

  switch (schema.kind) {
    case 'enum':
      return schema.schema?.length ? schema.schema.map(serializeSchema).join(' | ') : schema.type;
    case 'array':
      return schema.schema?.length
        ? `${schema.schema.map(serializeSchema).join(' | ')}[]`
        : schema.type;
    case 'object': {
      const properties = schema.schema ? Object.values(schema.schema) : [];
      return properties.length
        ? `{ ${properties
            .map((p) => `${p.name}${p.required ? '' : '?'}: ${serializeSchemaOrType(p)}`)
            .join('; ')} }`
        : schema.type;
    }
    case 'event':
      return schema.type;
    default:
      return (schema as { type?: string }).type ?? 'unknown';
  }
}

/** Resolved type string for a member, expanding its schema when present and falling back to type. */
function serializeSchemaOrType(member: { type: string; schema?: PropertyMetaSchema }): string {
  return member.schema === undefined ? member.type : serializeSchema(member.schema);
}

/** Projects vue-component-meta props into the React docgen shape rendered by `@storybook/mcp`. */
export function vueMetaToReactComponentMeta(meta: ComponentMeta): ReactComponentMeta {
  return {
    props: Object.fromEntries(
      (meta.props ?? []).map((prop: PropertyMeta) => [
        prop.name,
        {
          description: prop.description || undefined,
          type: { name: serializeSchemaOrType(prop) },
          defaultValue: prop.default != null ? { value: prop.default } : undefined,
          required: prop.required,
        },
      ])
    ),
  };
}

/** Renders one TypeScript-like block (matching the server's prop block style) for a set of members. */
function formatMembersSection(
  title: string,
  typeName: string,
  members: { name: string; type: string; description?: string }[]
): string {
  if (members.length === 0) {
    return '';
  }

  const lines = [title, '', '```', `export type ${typeName} = {`];
  for (const member of members) {
    if (member.description) {
      lines.push('  /**');
      lines.push(`    ${member.description}`);
      lines.push('  */');
    }
    lines.push(`  ${member.name}: ${member.type};`);
  }
  lines.push('}', '```');
  return lines.join('\n');
}

function eventMembers(events: EventMeta[] | undefined) {
  return (events ?? []).map((event) => ({
    name: event.name,
    type: event.signature || event.type,
    description: event.description || undefined,
  }));
}

function slotLikeMembers(entries: (SlotMeta | ExposeMeta)[] | undefined) {
  return (entries ?? []).map((entry) => ({
    name: entry.name,
    type: serializeSchemaOrType(entry),
    description: entry.description || undefined,
  }));
}

/**
 * Builds a Markdown block documenting the Vue-specific API surface (events, slots, exposed) that
 * has no dedicated section in the stock server. Returns `''` when there is nothing to document.
 */
export function vueMetaToApiMarkdown(meta: ComponentMeta): string {
  return [
    formatMembersSection('## Events', 'Events', eventMembers(meta.events)),
    formatMembersSection('## Slots', 'Slots', slotLikeMembers(meta.slots)),
    formatMembersSection('## Exposed', 'Exposed', slotLikeMembers(meta.exposed)),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Derives the manifest fields the stock `@storybook/mcp` server can render from vue-component-meta:
 * a `reactComponentMeta` payload for props, and a description with the events/slots/exposed Markdown
 * appended.
 */
export function buildStockDocgenFields(
  description: string | undefined,
  meta: ComponentMeta | undefined
): { description: string | undefined; reactComponentMeta: ReactComponentMeta | undefined } {
  if (!meta) {
    return { description, reactComponentMeta: undefined };
  }
  const apiMarkdown = vueMetaToApiMarkdown(meta);
  return {
    description: [description, apiMarkdown].filter(Boolean).join('\n\n') || undefined,
    reactComponentMeta: vueMetaToReactComponentMeta(meta),
  };
}
