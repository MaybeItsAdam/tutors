/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react-swc'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import { zodLocalePlugin } from './scripts/vite-zod-locale-plugin.js'

// https://vitejs.dev/config/
export default defineConfig(() => {
	return {
		plugins: [
			zodLocalePlugin(fileURLToPath(new URL('./scripts/zod-locales-shim.js', import.meta.url))),
			react(),
		],
		server: {
			port: 7072,
		},
		test: {
			environment: 'node',
			include: ['client/**/*.test.{ts,tsx}', 'shared/**/*.test.{ts,tsx}'],
		},
	}
})
