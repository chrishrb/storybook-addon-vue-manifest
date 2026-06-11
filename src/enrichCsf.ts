import { types as t } from 'storybook/internal/babel';
import { type CsfFile } from 'storybook/internal/csf-tools';
import type { PresetPropertyFn } from 'storybook/internal/types';

import type { ComponentMeta } from 'vue-component-meta';

import { generateVueSnippet, mergeArgsFromAst } from './componentManifest/generateCodeSnippet.ts';
import { resolveComponentRef } from './componentManifest/resolveComponent.ts';
import { extractComponentMeta, getChecker } from './componentManifest/vueComponentMetaDocgen.ts';
import { type VueManifestAddonOptions, resolveTsconfigPath } from './options.ts';

/**
 * Enriches CSF files with Vue template source code snippets.
 *
 * Implements the `experimental_enrichCsf` preset property. For each story, generates a Vue
 * template snippet and injects it into `Story.parameters.docs.source.code`.
 */
export const enrichCsf: PresetPropertyFn<'experimental_enrichCsf'> = async (input, options) => {
  const features = await options.presets.apply('features');
  if (!features.experimentalCodeExamples) {
    return;
  }

  const framework = await options.presets.apply('framework');
  const tsconfigPath = resolveTsconfigPath(options as unknown as VueManifestAddonOptions, framework);

  return async (csf: CsfFile, csfSource: CsfFile) => {
    const componentName = csfSource._meta?.component;
    if (!componentName) {
      return;
    }

    // The csf-plugin passes the story file path via loadCsf options.
    const fileName = csfSource._options.fileName ?? csf._options.fileName;
    if (!fileName) {
      return;
    }

    let componentMeta: ComponentMeta | undefined;
    let tagName = componentName;
    try {
      const resolved = resolveComponentRef(csfSource, fileName, tsconfigPath);
      if (resolved.ref) {
        tagName = resolved.ref.localName;
        const checker = await getChecker(tsconfigPath);
        componentMeta = (
          await extractComponentMeta(checker, resolved.ref.absPath, resolved.ref.localName)
        )?.meta;
      }
    } catch {
      // fall through — a best-effort snippet is still generated without component meta
    }

    Object.keys(csf._stories).forEach((key) => {
      let snippet: string | undefined;

      try {
        // Merge meta and story args from AST nodes
        const args = mergeArgsFromAst(csfSource._metaNode, csfSource._storyAnnotations[key]);

        snippet = generateVueSnippet(
          Object.keys(args).length > 0 ? args : undefined,
          componentMeta,
          tagName
        );
      } catch (e) {
        if (!(e instanceof Error)) {
          return;
        }
        snippet = e.message;
      }

      if (!snippet) {
        return;
      }

      // e.g. Story.input.parameters
      const originalParameters = t.memberExpression(
        csf._metaIsFactory
          ? t.memberExpression(t.identifier(key), t.identifier('input'))
          : t.identifier(key),
        t.identifier('parameters')
      );

      // e.g. Story.input.parameters?.docs
      const docsParameter = t.optionalMemberExpression(
        originalParameters,
        t.identifier('docs'),
        false,
        true
      );

      // For example:
      // Story.input.parameters = {
      //   ...Story.input.parameters,
      //   docs: {
      //     ...Story.input.parameters?.docs,
      //     source: {
      //       code: "snippet",
      //       ...Story.input.parameters?.docs?.source
      //     }
      //   }
      // };
      csf._ast.program.body.push(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            originalParameters,
            t.objectExpression([
              t.spreadElement(originalParameters),
              t.objectProperty(
                t.identifier('docs'),
                t.objectExpression([
                  t.spreadElement(docsParameter),
                  t.objectProperty(
                    t.identifier('source'),
                    t.objectExpression([
                      t.objectProperty(t.identifier('code'), t.stringLiteral(snippet)),
                      t.spreadElement(
                        t.optionalMemberExpression(
                          docsParameter,
                          t.identifier('source'),
                          false,
                          true
                        )
                      ),
                    ])
                  ),
                ])
              ),
            ])
          )
        )
      );
    });
  };
};
