// ── BabaHakim AI/ML ENGINE · Embedding Adapter (PHASE 11) ──────────────────
// EmbeddingProvider is a PORT (ports-and-adapters, ADR-0009 pattern) so a
// real embedding service (sentence-transformers / hosted embeddings per
// ADR-0007) can replace the stub WITHOUT touching callers. The v1 stub is
// a deterministic hashed bag-of-words — enough to wire semantic-search and
// similarity features end-to-end and to keep the contract stable.
//
// NOT used in the clinical path — reserved for future use cases:
// dataset dedup (near-duplicate images/text), case-similarity search,
// RAG over clinical notes. Deliberately isolated here.
import { childLogger } from '@/server/core/logger'

const log = childLogger({ svc: 'ai-embeddings' })

export interface EmbeddingVector {
  vector: number[]
  model: string
  version: number
  dim: number
}

export interface EmbeddingProvider {
  readonly name: string
  readonly version: number
  readonly dim: number
  embed(text: string): Promise<EmbeddingVector>
}

/** Deterministic hash-based stub — same text → same vector, no semantics. */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'HashEmbeddingStub'
  readonly version = 1
  readonly dim = 64

  async embed(text: string): Promise<EmbeddingVector> {
    const vector = new Array<number>(this.dim).fill(0)
    const tokens = text.toLowerCase().split(/[\s,.!?؛،]+/).filter(Boolean)
    for (const tok of tokens) {
      let h = 5381
      for (let i = 0; i < tok.length; i++) h = (h * 33) ^ tok.charCodeAt(i)
      vector[Math.abs(h) % this.dim] += 1
    }
    // L2 normalize — cosine then reduces to dot product
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1
    return { vector: vector.map((v) => +(v / norm).toFixed(6)), model: this.name, version: this.version, dim: this.dim }
  }
}

/** Cosine similarity of two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('dimension mismatch')
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2 }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d ? +(dot / d).toFixed(6) : 0
}

/**
 * Registry — swap in a real provider here (env-driven when the service
 * lands). Single global resolution point, same pattern as model registry.
 */
let activeEmbeddingProvider: EmbeddingProvider | null = null

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!activeEmbeddingProvider) {
    activeEmbeddingProvider = new HashEmbeddingProvider()
    log.debug('embedding provider resolved', { provider: activeEmbeddingProvider.name })
  }
  return activeEmbeddingProvider
}

/** Test/extension hook. */
export function setEmbeddingProvider(p: EmbeddingProvider): void {
  activeEmbeddingProvider = p
}
