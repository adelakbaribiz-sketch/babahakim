// API layer (thin controller) — business logic in @/server/application (ED-93).
import { z } from 'zod'
import { apiRoute, parseBody } from '@/server/api/handler'
import { verifyOtpChallenge } from '@/server/application/services/authService'

const otpVerifyRouteSchema = z.object({
  phone: z.string().optional(),
  challengeId: z.string().optional(),
  purpose: z.enum(['LOGIN_MFA', 'PASSWORD_RESET', 'PHONE_VERIFY']),
  code: z.string().regex(/^\d{6}$/, 'کد ۶ رقمی وارد کنید'),
})

// POST /api/v1/auth/otp/verify {phone?, challengeId?, purpose, code}
export const POST = apiRoute(async (req, _route, env) => {
  const input = await parseBody(req, otpVerifyRouteSchema)
  return verifyOtpChallenge(env.ctx, {
    phone: input.phone ? input.phone.replace(/\D/g, '') : undefined,
    challengeId: input.challengeId,
    purpose: input.purpose,
    code: input.code,
  })
})
