/**
 * Collects the symbols a story file *references* but does not feature as its own `meta.component`:
 * sub-components rendered inside a story (`components: {...}` maps, `h(X)` calls) and non-component
 * helpers/types it imports. These never get their own manifest entry through the story index, yet
 * they are exactly what an AI consumer needs to reproduce a story — so the generator resolves and
 * documents them alongside the primary component.
 */
import { types as t } from 'storybook/internal/babel';
import type { CsfFile } from 'storybook/internal/csf-tools';

import { walkAst } from './generateCodeSnippet.ts';

/** A single imported binding in a story file. */
export interface StoryImport {
  /** Local identifier the import is bound to (e.g. `DataTableHeaderCell`). */
  localName: string;
  /** Name exported by the source module (`default` for default imports). */
  importedName: string;
  /** Import source as written (e.g. `@lib/ui`). */
  source: string;
  /** Whether this is a `import type` / `import { type X }` (type-only) binding. */
  isType: boolean;
  /** Whether the binding is a default import. */
  isDefault: boolean;
}

/** References a story file makes to its imported symbols, split into component vs. plain usage. */
export interface StoryReferences {
  /** Identifiers used as components — registered in a `components: {}` map or passed to `h(...)`. */
  componentNames: Set<string>;
  /** Every identifier referenced anywhere in the walked story nodes. */
  usedNames: Set<string>;
}

/**
 * Import sources that are framework/runtime plumbing rather than documentable project surface.
 * `vue` (h, ref, defineComponent…), Storybook packages and the test helpers never warrant a
 * referenced-symbol entry.
 */
function isFrameworkSource(source: string): boolean {
  return (
    source === 'vue' ||
    source.startsWith('vue/') ||
    source.startsWith('@vue/') ||
    source === 'storybook' ||
    source.startsWith('storybook/') ||
    source.startsWith('@storybook/')
  );
}

/** Extract the string name of an imported/exported module identifier (`Identifier` or `StringLiteral`). */
function moduleExportName(node: t.Identifier | t.StringLiteral): string {
  return t.isIdentifier(node) ? node.name : node.value;
}

/**
 * Collects the non-framework imports of a story file, flattened to one {@link StoryImport} per
 * bound identifier. Namespace imports (`import * as ns`) are skipped — there is no single symbol to
 * document.
 */
export function collectStoryImports(csf: CsfFile): StoryImport[] {
  const imports: StoryImport[] = [];

  for (const stmt of csf._ast.program.body) {
    if (!t.isImportDeclaration(stmt) || isFrameworkSource(stmt.source.value)) {
      continue;
    }
    const source = stmt.source.value;
    const declarationIsType = stmt.importKind === 'type';

    for (const spec of stmt.specifiers) {
      if (t.isImportDefaultSpecifier(spec)) {
        imports.push({
          localName: spec.local.name,
          importedName: 'default',
          source,
          isType: declarationIsType,
          isDefault: true,
        });
      } else if (t.isImportSpecifier(spec)) {
        imports.push({
          localName: spec.local.name,
          importedName: moduleExportName(spec.imported),
          source,
          isType: declarationIsType || spec.importKind === 'type',
          isDefault: false,
        });
      }
    }
  }

  return imports;
}

/** The local identifier of an object property's value (handles `{ Foo }` and `{ Foo: Bar }`). */
function propertyValueIdentifier(prop: t.ObjectExpression['properties'][number]): string | undefined {
  return t.isObjectProperty(prop) && t.isIdentifier(prop.value) ? prop.value.name : undefined;
}

/**
 * Walks a set of story AST nodes (story render functions, meta) and records which imported
 * identifiers are used and which of them act as components — either registered in a `components: {}`
 * option or passed as the first argument to a Vue `h(...)` render call.
 */
export function collectReferences(nodes: Array<t.Node | undefined>): StoryReferences {
  const componentNames = new Set<string>();
  const usedNames = new Set<string>();

  for (const node of nodes) {
    if (!node) {
      continue;
    }
    walkAst(node, (n) => {
      if (t.isIdentifier(n)) {
        usedNames.add(n.name);
        return;
      }
      // `components: { Foo, Bar: Baz }` — the value identifier is the imported component.
      if (
        t.isObjectProperty(n) &&
        !n.computed &&
        t.isIdentifier(n.key) &&
        n.key.name === 'components' &&
        t.isObjectExpression(n.value)
      ) {
        for (const prop of n.value.properties) {
          const name = propertyValueIdentifier(prop);
          if (name) {
            componentNames.add(name);
          }
        }
        return;
      }
      // `h(Foo, …)` — the render-function helper from Vue; first arg is the component.
      if (t.isCallExpression(n) && t.isIdentifier(n.callee) && n.callee.name === 'h') {
        const first = n.arguments[0];
        if (t.isIdentifier(first)) {
          componentNames.add(first.name);
        }
      }
    });
  }

  return { componentNames, usedNames };
}

/**
 * Top-level statements worth scanning for referenced symbols: everything except the import
 * declarations themselves. Walking the whole module (not just render functions) catches
 * sub-components and helpers used from module-level definitions a render pulls in — e.g. a
 * `const columns = [{ header: () => h(DataTableHeaderCell) }]` referenced by `setup()`.
 */
export function storyReferenceNodes(csf: CsfFile): t.Statement[] {
  return csf._ast.program.body.filter((stmt) => !t.isImportDeclaration(stmt));
}
