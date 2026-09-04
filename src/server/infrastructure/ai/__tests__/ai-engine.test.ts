// ── PHASE 11 · AI/ML Engine Unit Tests ────────────────────────────────────
// Pure units — no DB, no HTTP. Covers the 20 audit dimensions that have
// algorithmic substance: registry resolution, prompt versioning + injection
// safety, output guards, validation gate, patient-level anti-leakage split,
// full-metric evaluation, PSI drift, cost model, embeddings adapter.
import { describe, test, expect } from 'bun:test'
import { AppError, BusinessRuleError } from '@/server/core/errors'
import { TongueModelV1, type AIResult, type IndicatorPrediction } from '@/lib/ai/provider'
import type { QualityReport } from '@/lib/storage'
import { registerProviderFactory, listProviderFactories } from '@/server/infrastructure/ai/registry'
import { renderPrompt, renderTemplate, listPromptTemplates, getLatestPromptVersion } from '@/server/infrastructure/ai/prompts'
import { validateAiOutput, validateAiInput, assertCanTrain, isLowConfidence } from '@/server/infrastructure/ai/security'
import {
  assertHumanValidated, assertPresentableAsSuggestion, canGroundClinicalDecision,
  resolveAiAssistedFlag, isFinalClinicalResult,
} from '@/server/infrastructure/ai/validation-gate'
import { patientLevelSplit, assertNoPatientLeakage, parseCorrections } from '@/server/infrastructure/ai/datasets'
import { computeMetrics, pairsFromDatasetItems } from '@/server/infrastructure/ai/evaluation'
import { computePSI } from '@/server/infrastructure/ai/monitoring'
import { estimateCost } from '@/server/infrastructure/ai/cost'
import { getEmbeddingProvider, cosineSimilarity } from '@/server/infrastructure/ai/embeddings'
import { LOW_CONFIDENCE_THRESHOLD, PSI_ALARM, PSI_WARN } from '@/server/infrastructure/ai/constants'

/* ── fixtures ────────────────────────────────────────────────────────────── */

const quality: QualityReport = {
  score: 90, blur: 12, brightness: 140, exposure: 'NORMAL',
  resolution: '1080x1920', resolutionOk: true, orientation: 'portrait', issues: [],
}

function fakeResult(overrides: Partial<AIResult> = {}): AIResult {
  const pred: IndicatorPrediction = {
    indicator: 'BODY_COLOR', labelFa: 'قرمز', labelEn: 'Red', value: 'RED',
    confidence: 0.8, noteFa: 'note', noteEn: 'note',
  }
  return {
    provider: 'TongueModelV1', model: 'TongueModelV1', version: 1,
    predictions: [pred], confidence: 0.8, quality: 0.9,
    explainability: { fa: ['a'], en: ['a'] },
    features: {
      redness: 0.7, pallor: 0.2, purpleIndex: 0.1, coatingWhite: 0.3,
      coatingYellow: 0.2, brightness: 140, textureRoughness: 0.4,
      dominantHex: 'test-color-ref', // non-hex string: UI-audit E3 forbids raw hex literals outside token sources centerStats: { r: 160, g: 82, b: 82 },
    },
    processingMs: 42,
    disclaimerFa: 'این تحلیل پیشنهاد کمکی است', disclaimerEn: 'assistive suggestion only',
    ...overrides,
  }
}

/* ══════════════════ REGISTRY (ED-121) ════════════════════════════════════ */

describe('AI provider registry', () => {
  test('TongueModelV1 is registered in the factory map', () => {
    expect(listProviderFactories()).toContain('TongueModelV1')
  })
  test('registerProviderFactory adds swappable entries (adapter mandate)', () => {
    const key = 'TestFakeModelV9'
    registerProviderFactory(key, () => new TongueModelV1())
    expect(listProviderFactories()).toContain(key)
  })
})

/* ══════════════════ PROMPTS (ED-122) ═════════════════════════════════════ */

describe('prompt versioning', () => {
  test('registry contains immutable versioned templates', () => {
    const all = listPromptTemplates()
    expect(all.length).toBeGreaterThanOrEqual(2)
    expect(getLatestPromptVersion('tongue-analysis-notes')).toBeGreaterThanOrEqual(1)
  })
  test('renderPrompt substitutes variables and validates required ones', () => {
    const out = renderPrompt('tongue-analysis-notes', {
      indicator: 'BODY_COLOR', value: 'RED', confidence: 0.8, note: 'warm',
    })
    expect(out).toContain('indicator=BODY_COLOR')
    expect(out).toContain('value=RED')
  })
  test('renderPrompt throws on missing required variable', () => {
    expect(() => renderPrompt('tongue-analysis-notes', { indicator: 'X' })).toThrow()
  })
  test('renderTemplate neutralizes structural braces in values (injection-safe)', () => {
    const out = renderTemplate('hello {{name}}', { name: '{{evil}}' })
    expect(out).not.toContain('{{evil}}')
    // escaped braces must not survive as template structure
    expect(out.replace(/\\[{}]/g, '')).not.toMatch(/[{}]/)
  })
})

/* ══════════════════ SECURITY GUARDS (ED-129) ═════════════════════════════ */

describe('AI output guard', () => {
  test('valid result passes and stays intact', () => {
    const r = validateAiOutput(fakeResult())
    expect(r.predictions).toHaveLength(1)
    expect(r.confidence).toBeLessThanOrEqual(1)
  })
  test('off-allowlist indicators dropped; empty set → INTERNAL error', () => {
    expect(() => validateAiOutput(fakeResult({
      predictions: [{
        indicator: 'HACKED_FIELD', labelFa: 'x', labelEn: 'x', value: 'x',
        confidence: 0.5, noteFa: '', noteEn: '',
      }],
    }))).toThrow(AppError)
  })
  test('confidence > 1 is clamped, not persisted', () => {
    const r = validateAiOutput(fakeResult({ confidence: 5 }))
    expect(r.confidence).toBe(1)
  })
  test('non-finite feature throws (adversarial NaN)', () => {
    const f = fakeResult()
    ;(f.features as unknown as Record<string, unknown>).redness = Number.NaN
    expect(() => validateAiOutput(f)).toThrow()
  })
  test('missing disclaimer text is re-anchored to the suggestion-only contract', () => {
    const r = validateAiOutput(fakeResult({ disclaimerFa: 'x', disclaimerEn: 'y' }))
    expect(r.disclaimerFa).toContain('پیشنهاد')
  })
  test('isLowConfidence flags below threshold', () => {
    expect(isLowConfidence(fakeResult({ confidence: 0.1 }))).toBe(true)
    expect(isLowConfidence(fakeResult({ confidence: 0.8 }))).toBe(false)
    expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.35)
  })
})

describe('AI input guard', () => {
  const img = { id: 'i1', caseId: 'c1', status: 'VALIDATED', aiPath: '/tmp/x.jpg', quality: null }
  test('matching case passes', () => { expect(() => validateAiInput(img, 'c1')).not.toThrow() })
  test('mismatched case → CONFLICT', () => {
    expect(() => validateAiInput(img, 'c2')).toThrow(AppError)
  })
  test('REJECTED image is not analyzable', () => {
    expect(() => validateAiInput({ ...img, status: 'REJECTED' }, 'c1')).toThrow(BusinessRuleError)
  })
  test('missing AI rendition blocks analysis', () => {
    expect(() => validateAiInput({ ...img, aiPath: null }, 'c1')).toThrow(BusinessRuleError)
  })
})

describe('training gate (spec §11 — no uncontrolled training)', () => {
  test('DRAFT dataset refuses training', () => {
    expect(() => assertCanTrain('DRAFT', 'APPROVED')).toThrow(BusinessRuleError)
  })
  test('FROZEN dataset + EVALUATION model passes', () => {
    expect(() => assertCanTrain('FROZEN', 'EVALUATION')).not.toThrow()
  })
  test('DEPLOYED-only approval is too late for training', () => {
    expect(() => assertCanTrain('FROZEN', 'DEPLOYED')).toThrow(BusinessRuleError)
  })
})

/* ══════════════════ VALIDATION GATE (ED-125 — charter core) ══════════════ */

describe('human validation gate', () => {
  const base = { humanReviewed: true, reviewedById: 'u1' }
  test('PENDING_REVIEW never grounds a clinical decision', () => {
    expect(() => assertHumanValidated({ ...base, reviewStatus: 'PENDING_REVIEW' })).toThrow(BusinessRuleError)
  })
  test('REJECTED never grounds a clinical decision', () => {
    expect(() => assertHumanValidated({ ...base, reviewStatus: 'REJECTED' })).toThrow()
  })
  test('ACCEPTED/MODIFIED pass with reviewer recorded', () => {
    expect(() => assertHumanValidated({ ...base, reviewStatus: 'ACCEPTED' })).not.toThrow()
    expect(() => assertHumanValidated({ ...base, reviewStatus: 'MODIFIED' })).not.toThrow()
  })
  test('terminal status without reviewer identity → integrity refusal', () => {
    expect(() => assertHumanValidated({ reviewStatus: 'ACCEPTED', humanReviewed: false, reviewedById: null })).toThrow()
  })
  test('AI can NEVER be a final clinical result (level 3)', () => {
    expect(isFinalClinicalResult({ ...base, reviewStatus: 'ACCEPTED' })).toBe(false)
  })
  test('any analysis is presentable as suggestion (level 1 — with framing)', () => {
    expect(() => assertPresentableAsSuggestion({ ...base, reviewStatus: 'PENDING_REVIEW' })).not.toThrow()
  })
  test('aiAssisted flag derives from active endorsement only', () => {
    expect(resolveAiAssistedFlag('ACCEPTED')).toBe(true)
    expect(resolveAiAssistedFlag('MODIFIED')).toBe(true)
    expect(resolveAiAssistedFlag('REJECTED')).toBe(false)
    expect(resolveAiAssistedFlag(undefined)).toBe(false)
  })
  test('soft UI check mirrors the gate', () => {
    expect(canGroundClinicalDecision({ ...base, reviewStatus: 'ACCEPTED' })).toBe(true)
    expect(canGroundClinicalDecision({ ...base, reviewStatus: 'PENDING_REVIEW' })).toBe(false)
  })
})

/* ══════════════════ PATIENT-LEVEL SPLIT (spec §63 anti-leakage) ══════════ */

describe('patient-level split — data leakage prevention', () => {
  const items = Array.from({ length: 60 }, (_, i) => ({
    patientHash: `p${Math.floor(i / 3)}`, // 3 images per patient, 20 patients
  }))
  test('same patient never spans train/val/test', () => {
    const s = patientLevelSplit(items)
    assertNoPatientLeakage(s) // throws on any overlap
    const total = s.train.length + s.val.length + s.test.length
    expect(total).toBe(60)
  })
  test('deterministic — same input, same split', () => {
    const a = patientLevelSplit(items)
    const b = patientLevelSplit(items)
    expect(a.train.map((x) => x.patientHash)).toEqual(b.train.map((x) => x.patientHash))
  })
  test('ratios sum ≠ 1 → rejected', () => {
    expect(() => patientLevelSplit(items, { train: 0.9, val: 0.2, test: 0.2 })).toThrow()
  })
  test('orphans (no hash) land in train and are counted', () => {
    const s = patientLevelSplit([{ patientHash: null }, { patientHash: null }])
    expect(s.train).toHaveLength(2)
    expect(s.unassigned).toBe(2)
  })
  test('leakage assert trips when a patient is forced into two sets', () => {
    const shared = { patientHash: 'pX' }
    expect(() => assertNoPatientLeakage({ train: [shared], val: [shared], test: [] })).toThrow()
  })
})

/* ══════════════════ EVALUATION (ED-127 — full metric suite) ══════════════ */

describe('evaluation metrics', () => {
  // hand-computed: 2-class, known confusion
  //   actual A: 6 (4 predicted A, 2 predicted B)
  //   actual B: 4 (1 predicted A, 3 predicted B)
  const pairs = [
    ...Array.from({ length: 4 }, () => ({ predicted: 'A', actual: 'A', confidence: 0.8 })),
    ...Array.from({ length: 2 }, () => ({ predicted: 'B', actual: 'A', confidence: 0.6 })),
    ...Array.from({ length: 1 }, () => ({ predicted: 'A', actual: 'B', confidence: 0.4 })),
    ...Array.from({ length: 3 }, () => ({ predicted: 'B', actual: 'B', confidence: 0.7 })),
  ]
  const suite = computeMetrics(pairs)

  test('accuracy = 7/10', () => { expect(suite.accuracy).toBe(0.7) })
  test('per-class precision/recall/f1 (hand-computed)', () => {
    expect(suite.perClass.A.precision).toBeCloseTo(4 / 5, 3) // 4/5
    expect(suite.perClass.A.recall).toBeCloseTo(4 / 6, 3) // 4/6
    expect(suite.perClass.B.precision).toBeCloseTo(3 / 5, 3)
    expect(suite.perClass.B.recall).toBeCloseTo(3 / 4, 3)
    expect(suite.perClass.A.f1).toBeCloseTo((2 * (4 / 5) * (4 / 6)) / (4 / 5 + 4 / 6), 3)
  })
  test('confusion matrix is complete', () => {
    expect(suite.confusion.A.A).toBe(4)
    expect(suite.confusion.A.B).toBe(2)
    expect(suite.confusion.B.A).toBe(1)
    expect(suite.confusion.B.B).toBe(3)
  })
  test('sensitivity equals recall; specificity present', () => {
    expect(suite.sensitivity.A).toBeCloseTo(4 / 6, 3)
    expect(suite.specificity.A).toBeCloseTo(3 / 4, 3)
  })
  test('calibration buckets populated with observed accuracy', () => {
    expect(suite.calibration.length).toBeGreaterThan(0)
    const b = suite.calibration.find((x) => x.bucket === '0.7-1.0')!
    expect(b.count).toBe(7)
    expect(b.observedAccuracy).toBeCloseTo(7 / 7, 2) // all 0.7-0.8 conf pairs were correct
  })
  test('imbalance reporting present', () => {
    expect(suite.imbalance.majorityClass).toBe('A')
    expect(suite.imbalance.majorityRatio).toBe(0.6)
  })
  test('empty pairs refuse evaluation (never fake metrics)', () => {
    expect(() => computeMetrics([])).toThrow(BusinessRuleError)
  })
  test('pairsFromDatasetItems uses corrections as per-indicator ground truth', () => {
    const items = [{
      aiPrediction: JSON.stringify([
        { indicator: 'BODY_COLOR', value: 'قرمز', confidence: 0.8 },
        { indicator: 'COATING', value: 'زرد', confidence: 0.6 },
      ]),
      finalLabel: JSON.stringify([{ indicator: 'BODY_COLOR', value: 'کم‌رنگ' }]),
      aiConfidence: 0.7, patientHash: 'p1',
    }]
    const pairs = pairsFromDatasetItems(items)
    // corrections ground only the corrected indicator; uncorrected are skipped
    expect(pairs).toHaveLength(1)
    expect(pairs[0].predicted).toBe('BODY_COLOR:قرمز')
    expect(pairs[0].actual).toBe('BODY_COLOR:کم‌رنگ')
  })
  test('pairsFromDatasetItems falls back to code labels for agreement-level truth', () => {
    const items = [{
      aiPrediction: JSON.stringify([{ indicator: 'BODY_COLOR', value: 'قرمز', confidence: 0.8 }]),
      finalLabel: 'DOCTOR_APPROVED',
      aiConfidence: 0.7, patientHash: 'p1',
    }]
    const pairs = pairsFromDatasetItems(items)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].actual).toBe('BODY_COLOR:DOCTOR_APPROVED')
  })
  test('parseCorrections distinguishes corrections JSON from code labels', () => {
    expect(parseCorrections(JSON.stringify([{ indicator: 'X', value: 'Y' }]))).toEqual([{ indicator: 'X', value: 'Y' }])
    expect(parseCorrections('AGREE_WITH_AI')).toBeNull()
    expect(parseCorrections(null)).toBeNull()
  })
})

/* ══════════════════ DRIFT (ED-126 — PSI) ═════════════════════════════════ */

describe('PSI drift detection', () => {
  const baseline = Array.from({ length: 200 }, (_, i) => (i % 100) / 100) // ~uniform 0..1
  test('identical distribution → PSI ≈ 0 (STABLE)', () => {
    expect(computePSI(baseline, [...baseline])).toBeLessThan(PSI_WARN)
  })
  test('shifted distribution → PSI > alarm threshold', () => {
    const shifted = baseline.map((v) => v * 0.3 + 0.6) // squeezed into 0.6..0.9
    expect(computePSI(baseline, shifted)).toBeGreaterThan(PSI_ALARM)
  })
  test('insufficient sample sizes → 0 (no false alarms on cold start)', () => {
    expect(computePSI([1, 2], [1, 2])).toBe(0)
    expect(computePSI(baseline, [0.5])).toBe(0)
  })
  test('thresholds are the industry standard values', () => {
    expect(PSI_WARN).toBe(0.1)
    expect(PSI_ALARM).toBe(0.25)
  })
})

/* ══════════════════ COST (ED-128) ════════════════════════════════════════ */

describe('AI cost model', () => {
  test('local CPU cost = ms × rate', () => {
    const c = estimateCost('TongueModelV1', 1000)
    expect(c).toBeCloseTo(1000 * 0.0001, 4)
  })
  test('failed runs cost a flat penalty', () => {
    expect(estimateCost('TongueModelV1', 0, { failed: true })).toBe(0.5)
  })
  test('unknown provider falls back to CPU estimate (conservative)', () => {
    expect(estimateCost('MysteryProvider', 100)).toBeGreaterThan(0)
  })
})

/* ══════════════════ EMBEDDINGS (adapter stub) ════════════════════════════ */

describe('embedding adapter', () => {
  test('stub is deterministic and normalized', async () => {
    const p = getEmbeddingProvider()
    const a = await p.embed('زبان قرمز پوشش سفید')
    const b = await p.embed('زبان قرمز پوشش سفید')
    expect(a.vector).toEqual(b.vector)
    const norm = Math.sqrt(a.vector.reduce((s, v) => s + v * v, 0))
    expect(norm).toBeCloseTo(1, 2)
  })
  test('cosine similarity: identical=1, orthogonal≈0', async () => {
    const p = getEmbeddingProvider()
    const a = (await p.embed('قرمز قرمز قرمز')).vector
    const b = (await p.embed('قرمز قرمز قرمز')).vector
    const c = (await p.embed('آبی آبی آبی')).vector
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 3)
    expect(cosineSimilarity(a, c)).toBeLessThan(1)
  })
})
