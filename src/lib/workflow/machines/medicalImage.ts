// MEDICAL_IMAGE state machine — the clinical AI input gate (PHASE 12).
// Status was previously written directly by the media worker bridge
// (updateMany on storedFileId) and the AI pipeline (status: 'PROCESSED').
// Now the quality-gate outcome and the AI-consumption hop are machine
// transitions: guarded, audited, SLA-tracked (PENDING > 1h = stuck worker).
//
// Note the deliberate asymmetry: REJECTED is recoverable only by ADMIN
// (REVALIDATE) — the patient path is uploading a NEW image (new row, new
// PENDING lifecycle), never resurrecting a rejected one.
import { TransitionDef, MachineDef, WorkflowError } from '../types'

export const MEDICAL_IMAGE_STATUSES = [
  'PENDING',    // uploaded, awaiting worker validation (async, ED-114)
  'VALIDATED',  // quality + scan passed — legal AI input
  'REJECTED',   // quality gate / malware scan / erasure flag
  'PROCESSED',  // consumed by an AI run
] as const

const t = (def: TransitionDef): TransitionDef => def

/** Fields the media worker bridge passes for VALIDATE/REJECT (payload → row). */
function mediaDataEffects(c: { payload: Record<string, unknown> }): Record<string, unknown> {
  const p = c.payload
  return {
    originalPath: p.originalPath != null ? String(p.originalPath) : undefined,
    compressedPath: p.compressedPath != null ? String(p.compressedPath) : undefined,
    aiPath: p.aiPath != null ? String(p.aiPath) : undefined,
    thumbPath: p.thumbPath != null ? String(p.thumbPath) : undefined,
    width: p.width != null ? Number(p.width) : undefined,
    height: p.height != null ? Number(p.height) : undefined,
    sizeOriginal: p.sizeOriginal != null ? Number(p.sizeOriginal) : undefined,
    sizeCompressed: p.sizeCompressed != null ? Number(p.sizeCompressed) : undefined,
    quality: p.quality != null ? JSON.stringify(p.quality) : undefined,
  }
}

export const MEDICAL_IMAGE_MACHINE: MachineDef = {
  entity: 'MEDICAL_IMAGE',
  prismaKey: 'medicalImage',
  ownerField: 'ownerId',
  statuses: MEDICAL_IMAGE_STATUSES,
  initial: 'PENDING',
  transitions: [
    t({
      // quality gate passed (media worker, system) — image becomes AI-legal
      action: 'VALIDATE', from: ['PENDING'], to: 'VALIDATED',
      roles: ['SYSTEM', 'ADMIN'], system: true, descFa: 'تصویر اعتبارسنجی شد و ورودی مجاز تحلیل AI است',
      dataEffects: mediaDataEffects,
    }),
    t({
      // quality gate / scan refused the upload — also the right-to-erasure
      // path (privacy anonymization flags ALL the user's images, whatever
      // state they were in, so REJECT is legal from any non-terminal status)
      action: 'REJECT', from: ['PENDING', 'VALIDATED', 'PROCESSED'], to: 'REJECTED',
      roles: ['SYSTEM', 'ADMIN'], system: true, descFa: 'تصویر رد شد',
      validate: (c) => {
        if (!String(c.payload.reason || '').trim()) {
          throw new WorkflowError('VALIDATION', 'دلیل رد تصویر الزامی است | Reason required', 422)
        }
      },
      dataEffects: (c) => ({
        ...mediaDataEffects(c),
        rejectionReason: String(c.payload.reason || ''),
      }),
    }),
    t({
      // AI pipeline consumed the image for one analysis run
      action: 'MARK_PROCESSED', from: ['VALIDATED'], to: 'PROCESSED',
      roles: ['SYSTEM', 'ADMIN'], system: true, descFa: 'تصویر در تحلیل AI مصرف شد',
    }),
    t({
      // ADMIN recovery: re-queue a rejected image for validation (BR-WF-07)
      action: 'REVALIDATE', from: ['REJECTED'], to: 'PENDING',
      roles: ['ADMIN'], descFa: 'تصویر رد‌شده مجدداً در صف اعتبارسنجی قرار گرفت (بازیابی)',
      dataEffects: (c) => ({ rejectionReason: null }),
    }),
  ],
}
