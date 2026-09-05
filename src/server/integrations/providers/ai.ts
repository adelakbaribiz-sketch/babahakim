// ── BabaHakim Integration · HTTP AI Provider (PHASE 13, ED-146) ───────────
// Implements the PHASE 11 AIModelProvider port (lib/ai/provider) on top of an
// external inference service (ADR-0007 FastAPI-style). Bridging PHASE 11 ↔
// PHASE 13: the model registry (ai/registry.ts) gains a `HttpAI` factory
// entry wired by bootstrap — flipping AIModel.provider to 'HttpAI' (a DB
// row, ED-121) routes inference through this adapter with the FULL
// resilience stack (timeout 30s, retry 1, breaker, telemetry, idempotency).
// The Phase-11 pipeline guards (input/output zod, replay, PENDING_REVIEW)
// stay fully in charge — this adapter is ONLY the transport.
import { readFile } from 'fs/promises'
import { AIModelProvider, AIResult } from '@/lib/ai/provider'
import type { QualityReport } from '@/lib/storage'
import { callIntegration } from '../core/resilience'
import { aiServiceSettings } from '../core/config'
import { IntegrationError } from '../core/types'

/** Contract the external service must answer (validated before use). */
interface RemotePrediction {
  indicator: string
  labelFa: string
  labelEn: string
  value: string
  confidence: number
  noteFa: string
  noteEn: string
}

export class HttpAIProvider implements AIModelProvider {
  name = 'HttpAI'
  version = 1
  private url: string
  private apiKey: string

  constructor(url?: string, apiKey?: string) {
    const s = aiServiceSettings()
    this.url = (url ?? s.url).replace(/\/$/, '')
    this.apiKey = apiKey ?? s.key
  }

  async analyze(aiImagePath: string, quality: QualityReport): Promise<AIResult> {
    // read the image from local storage (zones are driver-relative keys)
    const imageBase64 = (await readFile(aiImagePath)).toString('base64')
    const t0 = Date.now()

    const res = await callIntegration<AIResult>(
      'AI', 'http-ai', 'ai.predict',
      async (signal) => {
        const r = await fetch(`${this.url}/predict`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': this.apiKey },
          body: JSON.stringify({
            imageBase64,
            quality: { score: quality.score, blur: quality.blur, exposure: quality.exposure },
          }),
          signal,
        })
        if (r.status === 401 || r.status === 403) throw new IntegrationError({ code: 'AUTH', kind: 'AI', provider: 'http-ai', operation: 'ai.predict', message: 'AI service auth failed', httpStatus: r.status })
        if (r.status === 429) throw new IntegrationError({ code: 'RATE_LIMIT', kind: 'AI', provider: 'http-ai', operation: 'ai.predict', message: 'AI service rate limit', httpStatus: 429 })
        if (r.status >= 500) throw new IntegrationError({ code: 'SERVER', kind: 'AI', provider: 'http-ai', operation: 'ai.predict', message: `AI service HTTP ${r.status}`, httpStatus: r.status })
        if (!r.ok) throw new IntegrationError({ code: 'VALIDATION', kind: 'AI', provider: 'http-ai', operation: 'ai.predict', message: `AI service rejected input (HTTP ${r.status})`, httpStatus: r.status })
        const j = (await r.json()) as {
          predictions?: RemotePrediction[]
          confidence?: number
          features?: Record<string, number | string>
        }
        if (!Array.isArray(j?.predictions) || j.predictions.length === 0) {
          throw new IntegrationError({ code: 'PARSE', kind: 'AI', provider: 'http-ai', operation: 'ai.predict', message: 'AI service response missing predictions' })
        }
        const features = j.features ?? {}
        return {
          provider: 'HttpAI',
          model: 'remote',
          version: 1,
          predictions: j.predictions.map((p) => ({
            indicator: String(p.indicator), labelFa: String(p.labelFa), labelEn: String(p.labelEn),
            value: String(p.value), confidence: Math.min(1, Math.max(0, Number(p.confidence) || 0)),
            noteFa: String(p.noteFa ?? ''), noteEn: String(p.noteEn ?? ''),
          })),
          confidence: Math.min(1, Math.max(0, Number(j.confidence) || 0.5)),
          quality: quality.score,
          explainability: { fa: ['تحلیل توسط سرویس خارجی هوش مصنوعی انجام شد.'], en: ['Analyzed by the external AI service.'] },
          features: features as unknown as AIResult['features'],
          processingMs: Date.now() - t0,
          disclaimerFa: 'نتیجه هوش مصنوعی صرفاً پیشنهادی است و جایگزین نظر کارشناس نیست.',
          disclaimerEn: 'AI output is advisory only and does not replace expert review.',
        } satisfies AIResult
      },
      {
        request: { path: aiImagePath, qualityScore: quality.score, imageBytes: imageBase64.length },
        policy: { timeoutMs: 30_000, retries: 1 },
      },
    )
    return res.value
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    const t0 = Date.now()
    try {
      await callIntegration('AI', 'http-ai', 'ai.health', async (signal) => {
        const r = await fetch(`${this.url}/health`, { headers: { 'x-api-key': this.apiKey }, signal })
        return r.status
      }, { policy: { retries: 0, timeoutMs: 8_000, idempotent: false } })
      return { ok: true, latencyMs: Date.now() - t0, detail: 'reachable' }
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, detail: e instanceof Error ? e.message : 'unreachable' }
    }
  }
}
