// ── BabaHakim AI/ML ENGINE · Model Registry (PHASE 11, ED-121) ─────────────
// Resolves the ACTIVE model from the DB registry (AIModel row) and maps its
// `provider` string to a factory — swapping TongueModelV1 → V2 or an external
// HTTP model is a DB row flip (or a new factory entry), NOT a code rewrite.
// This closes the audit finding "provider hardcoded in getActiveProvider()".
//
// Resolution order:
//   1. AIModel where isActive AND approvalStatus=DEPLOYED (registry row)
//   2. unknown provider key → safe fallback TongueModelV1 + warning log
//   3. no registry row at all → TongueModelV1 (dev/seed default)
import { AIModelProvider, TongueModelV1, AIResult } from '@/lib/ai/provider'
import { db } from '@/lib/db'
import { childLogger } from '@/server/core/logger'
import { PREPROCESSING_VERSION } from './constants'

const log = childLogger({ svc: 'ai-registry' })

/** Model registry row shape the engine relies on. */
export interface ResolvedModel {
  modelId: string | null
  modelName: string
  modelVersion: number
  provider: string
  datasetVersion: string | null
  promptKey: string | null
  promptVersion: number | null
  preprocessingVersion: number
  confidenceThreshold: number
  providerInstance: AIModelProvider
  fallback: boolean // true → registry miss/unknown, dev default used
}

/**
 * Provider factory map — THE extension point for real models.
 * Add an entry (e.g. `TongueModelV2: () => new TongueModelV2()` or an
 * ExternalHttpProvider backed by ADR-0007 FastAPI service) and flip the
 * AIModel.registry row to switch inference engines.
 */
const PROVIDER_FACTORIES: Record<string, () => AIModelProvider> = {
  TongueModelV1: () => new TongueModelV1(),
}

/** Register a provider factory (used by future modules/tests). */
export function registerProviderFactory(key: string, factory: () => AIModelProvider): void {
  PROVIDER_FACTORIES[key] = factory
}

export function listProviderFactories(): string[] {
  return Object.keys(PROVIDER_FACTORIES)
}

/** Resolve the active model + provider instance from the DB registry. */
export async function resolveActiveModel(): Promise<ResolvedModel> {
  let row: { id: string; name: string; version: number; provider: string; trainingDatasetVersion: string | null; promptKey: string | null; promptVersion: number | null; preprocessingVersion: string | null; confidenceThreshold: number | null; approvalStatus: string } | null = null
  try {
    row = await db.aIModel.findFirst({
      where: { isActive: true, approvalStatus: 'DEPLOYED' },
      orderBy: { version: 'desc' },
      select: {
        id: true, name: true, version: true, provider: true,
        trainingDatasetVersion: true, promptKey: true, promptVersion: true,
        preprocessingVersion: true, confidenceThreshold: true, approvalStatus: true,
      },
    })
  } catch (e) {
    // DB unavailable (cold build) — fall through to dev default
    log.warn('registry lookup failed — using fallback provider', { error: e instanceof Error ? e.message : String(e) })
  }

  const providerKey = row?.provider || 'TongueModelV1'
  const factory = PROVIDER_FACTORIES[providerKey]
  if (row && !factory) {
    log.warn('active model references unknown provider — falling back', {
      model: row.name, requestedProvider: providerKey, known: Object.keys(PROVIDER_FACTORIES),
    })
  }
  const instance = factory ? factory() : new TongueModelV1()

  return {
    modelId: row?.id ?? null,
    modelName: row?.name ?? instance.name,
    modelVersion: row?.version ?? instance.version,
    provider: providerKey,
    datasetVersion: row?.trainingDatasetVersion ?? null,
    promptKey: row?.promptKey ?? null,
    promptVersion: row?.promptVersion ?? null,
    preprocessingVersion: Number(row?.preprocessingVersion) || PREPROCESSING_VERSION,
    confidenceThreshold: row?.confidenceThreshold ?? 0.35,
    providerInstance: instance,
    fallback: !row || !factory,
  }
}

/** Backward-compatible alias for legacy imports of lib/ai/provider. */
export async function getActiveProvider(): Promise<AIModelProvider> {
  return (await resolveActiveModel()).providerInstance
}

export type { AIModelProvider, AIResult }
