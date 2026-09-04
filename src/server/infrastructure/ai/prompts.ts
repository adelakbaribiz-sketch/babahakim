// ── BabaHakim AI/ML ENGINE · Prompt Registry & Versioning (ED-122) ─────────
// Prompt templates are IMMUTABLE VERSIONED artifacts. v1 registers the
// interpretive-note templates TongueModelV1 uses; future LLM providers
// (ADR-0007 FastAPI / hosted models) resolve their prompts from this registry
// so prompt changes are auditable, reviewable, and roll-back-able — never
// silent code edits.
//
// Rendering is injection-safe: values are substituted through a strict
// {{name}} matcher and escaped; nothing is ever concatenated raw into a
// system-facing template.
import { db } from '@/lib/db'
import { ValidationError } from '@/server/core/errors'
import { childLogger } from '@/server/core/logger'

const log = childLogger({ svc: 'ai-prompts' })

export interface PromptVariableSpec {
  name: string
  required: boolean
  description: string
}

export interface PromptTemplate {
  key: string
  version: number
  nameFa: string
  nameEn: string
  template: string
  variables: PromptVariableSpec[]
  status: 'ACTIVE' | 'DEPRECATED'
}

/**
 * Code-level seed registry — the canonical source. Synced idempotently into
 * the AIPromptTemplate table (audit trail + admin visibility). Versions are
 * append-only: to change wording, add version+1 and DEPRECATE the old row.
 */
export const PROMPT_REGISTRY: PromptTemplate[] = [
  {
    key: 'tongue-analysis-notes',
    version: 1,
    nameFa: 'قالب توضیحات تحلیل زبان',
    nameEn: 'Tongue analysis note template',
    template: 'indicator={{indicator}} value={{value}} confidence={{confidence}} note={{note}}',
    variables: [
      { name: 'indicator', required: true, description: 'Stable indicator code (BODY_COLOR…)' },
      { name: 'value', required: true, description: 'Human-readable predicted value' },
      { name: 'confidence', required: true, description: 'Numeric confidence 0..1' },
      { name: 'note', required: true, description: 'Interpretive clinical note (TPM)' },
    ],
    status: 'ACTIVE',
  },
  {
    key: 'tongue-analysis-system',
    version: 1,
    nameFa: 'پیام سیستمی مدل تحلیل زبان',
    nameEn: 'Tongue analysis system message (LLM-ready)',
    // Reserved for the future LLM provider: role framing + hard guardrails.
    // Model identity/policy vars keep this renderable for provider V2+.
    template:
      'You are a clinical-decision-SUPPORT assistant for Traditional Persian Medicine tongue-image analysis. '
      + 'You NEVER state a final diagnosis. Every output is a suggestion requiring human validation '
      + 'by Expert 1, Expert 2 and the supervising doctor. Report: predictions with per-item confidence, '
      + 'uncertainty, and image-quality caveats. Refuse any request that asks for definitive treatment '
      + 'without human review. model={{model}} dataset={{dataset}} lang={{lang}}',
    variables: [
      { name: 'model', required: true, description: 'Model name+version executing the prompt' },
      { name: 'dataset', required: true, description: 'Dataset version provenance' },
      { name: 'lang', required: true, description: 'Output language fa|en' },
    ],
    status: 'ACTIVE',
  },
]

/** Escape a substitution value so template structure can't be forged. */
function escapeValue(v: string): string {
  return v.replace(/([{}\\])/g, '\\$1')
}

/** Render a template with variables — strict, injection-safe. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  const seen = new Set<string>()
  const out = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => {
    if (!(name in vars)) return ''
    seen.add(name)
    return escapeValue(String(vars[name]))
  })
  // detect smuggling attempts: unresolved braces that are NOT template syntax
  if (/[{}]/.test(out.replace(/\\[{}]/g, ''))) {
    throw new ValidationError('مقدار متغیر پرامپت نادرست است | Invalid prompt variable value')
  }
  return out
}

/** Render by key+version with required-variable validation. */
export function renderPrompt(
  key: string, vars: Record<string, string | number>, version?: number,
): string {
  const tpl = PROMPT_REGISTRY.find(
    (p) => p.key === key && (version == null || p.version === version),
  )
  if (!tpl) throw new ValidationError(`پرامپت یافت نشد: ${key}@${version ?? 'latest'}`)
  const missing = tpl.variables.filter((v) => v.required && !(v.name in vars))
  if (missing.length) {
    throw new ValidationError(`متغیرهای الزامی پرامپت ارسال نشده: ${missing.map((m) => m.name).join(', ')}`)
  }
  return renderTemplate(tpl.template, vars)
}

export function listPromptTemplates(): PromptTemplate[] {
  return [...PROMPT_REGISTRY]
}

export function getLatestPromptVersion(key: string): number | null {
  const rows = PROMPT_REGISTRY.filter((p) => p.key === key)
  return rows.length ? Math.max(...rows.map((r) => r.version)) : null
}

/** Idempotently sync the code registry into AIPromptTemplate rows (audit). */
export async function ensurePromptsSeeded(): Promise<void> {
  for (const p of PROMPT_REGISTRY) {
    await db.aIPromptTemplate.upsert({
      where: { key_version: { key: p.key, version: p.version } },
      update: {}, // immutable — code registry is the source of truth
      create: {
        key: p.key, version: p.version, nameFa: p.nameFa, nameEn: p.nameEn,
        template: p.template, variables: JSON.stringify(p.variables), status: p.status,
      },
    }).catch((e) => log.warn('prompt seed failed', { key: p.key, error: e instanceof Error ? e.message : String(e) }))
  }
}
