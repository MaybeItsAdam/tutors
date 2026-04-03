import type { Plugin, ViteDevServer } from 'vite'

/**
 * Vite plugin that replaces the Cloudflare Worker.
 * Intercepts POST /stream requests and forwards them to the AgentService,
 * which handles prompt building and LLM streaming using the Vercel AI SDK.
 *
 * API keys are read from a .env file (or environment variables).
 */
export function agentStreamPlugin(): Plugin {
	return {
		name: 'agent-stream',
		configureServer(server: ViteDevServer) {
			server.middlewares.use(async (req, res, next) => {
				if (req.method === 'OPTIONS' && req.url === '/stream') {
					res.writeHead(204, {
						'Access-Control-Allow-Origin': '*',
						'Access-Control-Allow-Methods': 'POST, OPTIONS',
						'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Provider, X-Model',
					})
					res.end()
					return
				}

				if (req.method !== 'POST' || req.url !== '/stream') {
					return next()
				}

				// Read the request body
				const chunks: Buffer[] = []
				for await (const chunk of req) {
					chunks.push(chunk)
				}
				const body = Buffer.concat(chunks).toString('utf-8')

				let prompt: any
				try {
					prompt = JSON.parse(body)
				} catch {
					res.writeHead(400, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify({ error: 'Invalid JSON body' }))
					return
				}

				// Extract BYOK headers (for future use — Step 4)
				const byokApiKey = req.headers['x-api-key'] as string | undefined
				const byokProvider = req.headers['x-provider'] as string | undefined
				const byokModel = req.headers['x-model'] as string | undefined

				// Load API keys from environment (fallback to .env via Vite's loadEnv)
				const env = {
					OPENAI_API_KEY: byokApiKey && byokProvider === 'openai' ? byokApiKey : (process.env.OPENAI_API_KEY ?? ''),
					ANTHROPIC_API_KEY: byokApiKey && byokProvider === 'anthropic' ? byokApiKey : (process.env.ANTHROPIC_API_KEY ?? ''),
					GOOGLE_API_KEY: byokApiKey && byokProvider === 'google' ? byokApiKey : (process.env.GOOGLE_API_KEY ?? ''),
				}

				// Dynamically import the AgentService to use the same logic as the worker
				try {
					const { AgentService } = await server.ssrLoadModule('/server/AgentService.ts') as any
					const service = new AgentService(env)

					// Set SSE headers
					res.writeHead(200, {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache, no-transform',
						'Connection': 'keep-alive',
						'X-Accel-Buffering': 'no',
						'Access-Control-Allow-Origin': '*',
						'Access-Control-Allow-Methods': 'POST, OPTIONS',
						'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Provider, X-Model',
					})

					for await (const change of service.stream(prompt)) {
						const data = `data: ${JSON.stringify(change)}\n\n`
						res.write(data)
					}

					res.end()
				} catch (error: any) {
					console.error('Stream error:', error)

					if (!res.headersSent) {
						res.writeHead(200, {
							'Content-Type': 'text/event-stream',
							'Cache-Control': 'no-cache, no-transform',
							'Connection': 'keep-alive',
							'Access-Control-Allow-Origin': '*',
						})
					}

					const errorData = `data: ${JSON.stringify({ error: error.message })}\n\n`
					res.write(errorData)
					res.end()
				}
			})
		},
	}
}
