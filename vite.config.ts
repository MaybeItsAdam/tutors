/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react-swc'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { zodLocalePlugin } from './scripts/vite-zod-locale-plugin.js'

/**
 * Inject a Content-Security-Policy meta tag into built HTML.
 *
 * Defense in depth: BYOK keys live in web storage, so any future XSS is a
 * key-theft primitive - the CSP is the second layer that keeps an injected
 * script from running or exfiltrating. 'unsafe-inline' styles are required
 * (inline styles throughout + KaTeX/tldraw); data:/blob: img+font cover PDF
 * page assets and MathLive's fonts. Build-only: 'self' doesn't cover ws:, so
 * a dev-time CSP would break HMR.
 */
function cspPlugin(apiOrigin: string): Plugin {
	const csp = [
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
		"font-src 'self' https://fonts.gstatic.com data:",
		"img-src 'self' data: blob:",
		`connect-src 'self' ${apiOrigin}`,
		"worker-src 'self' blob:",
		"object-src 'none'",
		"base-uri 'self'",
	].join('; ')
	return {
		name: 'inject-csp',
		apply: 'build',
		transformIndexHtml(html) {
			return html.replace(
				'<meta charset="UTF-8" />',
				`<meta charset="UTF-8" />\n\t\t<meta http-equiv="Content-Security-Policy" content="${csp}" />`
			)
		},
	}
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), 'VITE_')
	const apiOrigin = (env.VITE_API_URL_CSP ?? env.VITE_API_URL ?? 'http://localhost:8000').replace(
		/\/$/,
		''
	)

	return {
		plugins: [
			zodLocalePlugin(fileURLToPath(new URL('./scripts/zod-locales-shim.js', import.meta.url))),
			react(),
			cspPlugin(apiOrigin),
		],
		server: {
			port: 7072,
		},
		build: {
			rollupOptions: {
				output: {
					// Big, rarely-changing deps get their own cached chunks.
					// three/pdfjs/mathlive are deliberately NOT listed: they're
					// reached only via dynamic import() and listing them here
					// would hoist them back into the eager graph.
					advancedChunks: {
						groups: [
							{ name: 'tldraw', test: /node_modules[\\/]@?tldraw[\\/]/ },
							{ name: 'mathjs', test: /node_modules[\\/]mathjs[\\/]/ },
							{ name: 'katex', test: /node_modules[\\/]katex[\\/]/ },
						],
					},
				},
			},
		},
		test: {
			environment: 'node',
			include: ['client/**/*.test.{ts,tsx}', 'shared/**/*.test.{ts,tsx}'],
		},
	}
})
