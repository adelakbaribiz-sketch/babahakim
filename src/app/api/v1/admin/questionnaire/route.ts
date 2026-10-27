// API layer (thin controller) — business logic in @/server/application (ED-93).
import { z } from 'zod'
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { putQuestionnaire } from '@/server/application/services/adminService'

const questionnairePutSchema = z.object({
  questions: z.array(z.object({
    textFa: z.string().min(1).max(500),
    textEn: z.string().max(500).optional(),
    helpFa: z.string().max(500).optional(),
    required: z.boolean().optional().default(false),
    weight: z.number().min(0).max(10).optional().default(1),
    category: z.string().max(120).optional().nullable(),
    active: z.boolean().optional().default(true),
    options: z.array(z.object({
      textFa: z.string().min(1).max(300),
      textEn: z.string().max(300).optional(),
      score: z.number().int().min(-20).max(20),
      dimension: z.enum(['HOT', 'COLD', 'WET', 'DRY']),
    })).min(2).max(10), // default set is 5 (خیلی کم … خیلی زیاد) — never fixed in code
  })).min(1).max(200),
})

// PUT /api/v1/admin/questionnaire — versioned questionnaire editor → NEW version
export const PUT = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN')
  const input = await parseBody(req, questionnairePutSchema)
  return putQuestionnaire(auth, env.ctx, input.questions)
})
