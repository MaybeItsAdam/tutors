// @ts-check
import eslint from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	{
		ignores: ['dist/', '.tsbuild/', 'node_modules/', 'backend/', 'scripts/', 'docs/', 'public/'],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	reactHooks.configs.flat['recommended-latest'],
	{
		rules: {
			// The codebase has intentional dep omissions (e.g. mount-only effects in
			// shape utils) - keep as a warning until those are annotated case by case.
			'react-hooks/exhaustive-deps': 'warn',
			// The compiler-based checks flag real issues, but the flagged sites are
			// exactly what the audit-remediation shape/panel PRs rewrite - keep them
			// visible as warnings until those land, then promote to errors.
			'react-hooks/refs': 'warn',
			'react-hooks/set-state-in-effect': 'warn',
			'react-hooks/immutability': 'warn',
			'react-hooks/component-hook-factories': 'warn',
			'react-hooks/static-components': 'warn',
			// Replaces the tsconfig noUnusedLocals/noUnusedParameters flags.
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			// tldraw interop still relies on a number of escape hatches; tighten later.
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-empty-object-type': 'off',
		},
	},
	// Must be last: disables stylistic rules that conflict with prettier.
	prettierConfig
)
