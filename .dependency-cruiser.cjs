/**
 * Layer rules (see docs/DESIGN.md §5.2). Dependencies may only point downwards:
 * apps → ui/scene/theme → app → core, adapters → app/core.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-is-pure',
      comment: 'packages/core must not depend on anything outside itself (no npm packages, no other workspace packages).',
      severity: 'error',
      from: { path: '^packages/core/src' },
      to: { pathNot: '^packages/core/src' },
    },
    {
      name: 'app-only-core',
      severity: 'error',
      from: { path: '^packages/app/src' },
      to: { path: '^packages/(scene|ui|theme|adapters)/' },
    },
    {
      name: 'scene-not-domain',
      comment: 'The 3D scene only knows its own SceneModel; apps map ledger state into it (DESIGN.md §5.4).',
      severity: 'error',
      from: { path: '^packages/scene/src' },
      to: { path: '^packages/(core|app)/' },
    },
    {
      name: 'packages-not-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'presentation-not-adapters',
      comment: 'scene/ui receive adapters through the app layer, never import them directly.',
      severity: 'error',
      from: { path: '^packages/(scene|ui)/src' },
      to: { path: '^packages/adapters/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(test|e2e|node_modules|dist|ios|android)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'default'] },
  },
};
