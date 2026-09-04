// AI analysis runner — DEPRECATED shim (PHASE 11).
// The real pipeline lives in @/server/infrastructure/ai/pipeline.ts with the
// full guard/telemetry chain (registry resolution → input guard → output
// guard → AIAnalysis + AIInferenceLog + cost + event). This shim keeps the
// historical import path working.
export { runAIAnalysis } from '@/server/infrastructure/ai/pipeline'
