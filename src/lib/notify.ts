// Notification engine: in-app + SMS (via integration adapter) + optional email.
// PHASE 13: SMS delivery is REAL — the SmsProvider adapter (Kavenegar live /
// deterministic mock) sends behind the resilience stack and the SMSLog row
// reflects the ACTUAL outcome (SENT/FAILED + provider + delivery + error).
// Pre-13 bug closed: rows were written as KAVENEGAR/SENT/DELIVERED with zero
// network calls — a falsified delivery record (audit-integrity issue).
//
// ⚠ Client-graph safety (ED-137b): this module sits in the SHARED import
// graph (workflow machines → notify, and machines are imported by client
// constants/atoms). It must NEVER import @/server/* (node builtins would
// break the browser bundle). The SMS/email PROVIDERS are therefore
// INJECTED by the server bootstrap (bindNotificationChannels) — dependency
// inversion instead of an upward import.
import { db } from '@/lib/db'

// ── injected channels (server side only — see bootstrap.ts v7) ─────────────
export interface SmsChannel {
  readonly providerName: string
  send(input: { recipient: string; message: string; templateId?: string }): Promise<unknown>
}

export interface EmailChannel {
  send(input: { to: string; subject: string; text: string; html?: string }): Promise<unknown>
}

const g = globalThis as unknown as { __bhNotifyChannels?: { sms?: SmsChannel; email?: EmailChannel } }
const channels = g.__bhNotifyChannels ?? {}
g.__bhNotifyChannels = channels

/** Server bootstrap wires the integration adapters in (idempotent). */
export function bindNotificationChannels(smsChannel?: SmsChannel, emailChannel?: EmailChannel): void {
  if (smsChannel) channels.sms = smsChannel
  if (emailChannel) channels.email = emailChannel
}

type EventCode =
  | 'REGISTERED' | 'PROFILE_COMPLETED' | 'QUESTIONNAIRE_DONE' | 'IMAGE_RECEIVED' | 'CASE_IN_QUEUE'
  | 'ASSIGNED_EXPERT' | 'AI_ANALYZED' | 'ASSESSMENT_READY' | 'USER_APPROVAL_NEEDED' | 'TREATMENT_APPROVED'
  | 'PRESCRIPTION_CREATED' | 'PRESCRIPTION_REVISED' | 'SENT_TO_DOCTOR' | 'DOCTOR_APPROVED' | 'DOCTOR_COMMENTED'
  | 'PROFORMA_CREATED' | 'PROFORMA_CONFIRMATION_NEEDED' | 'PAYMENT_PENDING' | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_REJECTED' | 'ORDER_PREPARING' | 'ORDER_SHIPPED' | 'ORDER_DELIVERED' | 'FOLLOWUP_DUE'
  | 'REFERRED_AGAIN' | 'CASE_CLOSED' | 'TICKET_UPDATED' | 'RECEIPT_UPLOADED' | 'PRICE_CHANGED' | 'NEW_ORDER'
  | 'FILE_QUARANTINED' // PHASE 10: media engine quarantine notice (ED-116)
  // PHASE 12: workflow governance notices (SLA ladders + recovery)
  | 'WORKFLOW_REMINDER' | 'WORKFLOW_ESCALATED' | 'WORKFLOW_RECOVERED' | 'DELETION_REJECTED'

const TEMPLATES: Record<EventCode, { titleFa: string; titleEn: string; bodyFa: string; bodyEn: string; smsFa: string }> = {
  REGISTERED: { titleFa: 'خوش آمدید', titleEn: 'Welcome', bodyFa: 'حساب شما با موفقیت ایجاد شد. کد معرف شما آماده است.', bodyEn: 'Your account was created successfully.', smsFa: 'TongueAI: ثبت‌نام شما با موفقیت انجام شد.' },
  PROFILE_COMPLETED: { titleFa: 'پروفایل تکمیل شد', titleEn: 'Profile Completed', bodyFa: 'اطلاعات پایه شما ذخیره شد.', bodyEn: 'Your basic info was saved.', smsFa: 'TongueAI: پروفایل شما تکمیل شد.' },
  QUESTIONNAIRE_DONE: { titleFa: 'نتیجه مزاج‌شناسی', titleEn: 'Temperament Result', bodyFa: 'نتیجه مزاج‌شناسی شما در پرونده سلامت ذخیره شد.', bodyEn: 'Your temperament result was saved.', smsFa: 'TongueAI: نتیجه مزاج‌شناسی شما ثبت شد.' },
  IMAGE_RECEIVED: { titleFa: 'تصویر دریافت شد', titleEn: 'Image Received', bodyFa: 'تصویر شما اعتبارسنجی و پردازش شد.', bodyEn: 'Your image was validated and processed.', smsFa: 'TongueAI: تصویر شما دریافت و پردازش شد.' },
  CASE_IN_QUEUE: { titleFa: 'پرونده ایجاد شد', titleEn: 'Case Created', bodyFa: 'پرونده شما در صف بررسی کارشناسان قرار گرفت.', bodyEn: 'Your case is queued for expert review.', smsFa: 'TongueAI: پرونده شما در صف کارشناسان قرار گرفت.' },
  ASSIGNED_EXPERT: { titleFa: 'تخصیص کارشناس', titleEn: 'Expert Assigned', bodyFa: 'پرونده به کارشناس اول تخصیص یافت.', bodyEn: 'A case was assigned to you.', smsFa: 'TongueAI: پرونده جدید به شما تخصیص یافت.' },
  AI_ANALYZED: { titleFa: 'تحلیل AI انجام شد', titleEn: 'AI Analysis Done', bodyFa: 'تحلیل اولیه هوش مصنوعی آماده بازبینی کارشناس است.', bodyEn: 'AI preliminary analysis awaits expert review.', smsFa: 'TongueAI: تحلیل اولیه انجام شد.' },
  ASSESSMENT_READY: { titleFa: 'نتیجه ارزیابی اولیه', titleEn: 'Initial Assessment Ready', bodyFa: 'ارزیابی اولیه پرونده شما آماده است؛ لطفاً برای ادامه درمان تأیید کنید.', bodyEn: 'Your initial assessment is ready; please confirm to continue.', smsFa: 'TongueAI: نتیجه ارزیابی اولیه شما آماده است.' },
  USER_APPROVAL_NEEDED: { titleFa: 'در انتظار تأیید کاربر', titleEn: 'Awaiting User Approval', bodyFa: 'کاربر باید ادامه درمان را تأیید کند.', bodyEn: 'The patient must confirm to continue treatment.', smsFa: 'TongueAI: پرونده در انتظار تأیید بیمار است.' },
  TREATMENT_APPROVED: { titleFa: 'تأیید ادامه درمان', titleEn: 'Treatment Approved', bodyFa: 'کاربر ادامه درمان را تأیید کرد.', bodyEn: 'The patient approved continuing treatment.', smsFa: 'TongueAI: بیمار ادامه درمان را تأیید کرد.' },
  PRESCRIPTION_CREATED: { titleFa: 'نسخه ثبت شد', titleEn: 'Prescription Created', bodyFa: 'نسخه جدیدی ثبت شد و در انتظار بازبینی است.', bodyEn: 'A new prescription version was created.', smsFa: 'TongueAI: نسخه جدیدی ثبت شد.' },
  PRESCRIPTION_REVISED: { titleFa: 'نسخه اصلاح شد', titleEn: 'Prescription Revised', bodyFa: 'نسخه اصلاح و نسخه جدید ایجاد شد.', bodyEn: 'The prescription was revised; a new version exists.', smsFa: 'TongueAI: نسخه اصلاح شد.' },
  SENT_TO_DOCTOR: { titleFa: 'ارسال به پزشک', titleEn: 'Sent to Doctor', bodyFa: 'نسخه برای تأیید نهایی به پزشک ارسال شد.', bodyEn: 'The prescription was sent to the doctor for final approval.', smsFa: 'TongueAI: نسخه برای تأیید پزشک ارسال شد.' },
  DOCTOR_APPROVED: { titleFa: 'تأیید پزشک', titleEn: 'Doctor Approved', bodyFa: 'نسخه توسط پزشک تأیید شد.', bodyEn: 'The prescription was approved by the doctor.', smsFa: 'TongueAI: نسخه توسط پزشک تأیید شد.' },
  DOCTOR_COMMENTED: { titleFa: 'اظهارنظر پزشک', titleEn: 'Doctor Comment', bodyFa: 'پزشک اظهارنظر جدیدی ثبت کرد.', bodyEn: 'The doctor added a comment.', smsFa: 'TongueAI: پزشک اظهارنظر کرد.' },
  PROFORMA_CREATED: { titleFa: 'پیش‌فاکتور صادر شد', titleEn: 'Proforma Issued', bodyFa: 'پیش‌فاکتور شما آماده است؛ پس از تأیید می‌توانید پرداخت کنید.', bodyEn: 'Your proforma is ready for confirmation and payment.', smsFa: 'TongueAI: پیش‌فاکتور شما صادر شد.' },
  PROFORMA_CONFIRMATION_NEEDED: { titleFa: 'در انتظار تأیید پیش‌فاکتور', titleEn: 'Awaiting Proforma Confirmation', bodyFa: 'کاربر باید پیش‌فاکتور را تأیید کند.', bodyEn: 'The patient must confirm the proforma.', smsFa: 'TongueAI: پیش‌فاکتور در انتظار تأیید است.' },
  PAYMENT_PENDING: { titleFa: 'در انتظار پرداخت', titleEn: 'Payment Pending', bodyFa: 'لطفاً پرداخت را تکمیل کنید.', bodyEn: 'Please complete your payment.', smsFa: 'TongueAI: لطفاً پرداخت خود را تکمیل کنید.' },
  PAYMENT_CONFIRMED: { titleFa: 'پرداخت تأیید شد', titleEn: 'Payment Confirmed', bodyFa: 'پرداخت شما تأیید و سفارش وارد مرحله آماده‌سازی شد.', bodyEn: 'Your payment was verified; the order is being prepared.', smsFa: 'TongueAI: پرداخت شما تأیید شد.' },
  PAYMENT_REJECTED: { titleFa: 'پرداخت رد شد', titleEn: 'Payment Rejected', bodyFa: 'رسید پرداخت شما تأیید نشد. لطفاً مجدداً اقدام کنید.', bodyEn: 'Your payment receipt was not approved.', smsFa: 'TongueAI: پرداخت شما تأیید نشد.' },
  ORDER_PREPARING: { titleFa: 'آماده‌سازی سفارش', titleEn: 'Order Preparing', bodyFa: 'سفارش شما در حال آماده‌سازی است.', bodyEn: 'Your order is being prepared.', smsFa: 'TongueAI: سفارش شما در حال آماده‌سازی است.' },
  ORDER_SHIPPED: { titleFa: 'سفارش ارسال شد', titleEn: 'Order Shipped', bodyFa: 'سفارش شما ارسال شد؛ پیگیری ارسال را ببینید.', bodyEn: 'Your order has been shipped.', smsFa: 'TongueAI: سفارش شما ارسال شد.' },
  ORDER_DELIVERED: { titleFa: 'سفارش تحویل شد', titleEn: 'Order Delivered', bodyFa: 'سفارش شما تحویل داده شد. شفا باشید!', bodyEn: 'Your order was delivered. Get well soon!', smsFa: 'TongueAI: سفارش شما تحویل شد.' },
  FOLLOWUP_DUE: { titleFa: 'زمان پیگیری درمان', titleEn: 'Follow-up Due', bodyFa: 'زمان پیگیری درمان شما رسیده است.', bodyEn: 'It is time for your treatment follow-up.', smsFa: 'TongueAI: زمان پیگیری درمان شما رسیده است.' },
  REFERRED_AGAIN: { titleFa: 'ارجاع مجدد', titleEn: 'Re-referred', bodyFa: 'ارجاع مجدد شما ثبت شد.', bodyEn: 'Your re-referral was registered.', smsFa: 'TongueAI: ارجاع مجدد ثبت شد.' },
  CASE_CLOSED: { titleFa: 'پرونده بسته شد', titleEn: 'Case Closed', bodyFa: 'پرونده شما بسته شد.', bodyEn: 'Your case was closed.', smsFa: 'TongueAI: پرونده شما بسته شد.' },
  TICKET_UPDATED: { titleFa: 'به‌روزرسانی تیکت', titleEn: 'Ticket Updated', bodyFa: 'تیکت شما به‌روزرسانی شد.', bodyEn: 'Your ticket was updated.', smsFa: 'TongueAI: تیکت شما به‌روزرسانی شد.' },
  RECEIPT_UPLOADED: { titleFa: 'رسید کارت‌به‌کارت', titleEn: 'Card Receipt', bodyFa: 'رسید پرداخت ارسال شد و در انتظار تأیید اپراتور است.', bodyEn: 'A card-to-card receipt was uploaded and awaits verification.', smsFa: 'TongueAI: رسید پرداخت دریافت شد.' },
  PRICE_CHANGED: { titleFa: 'تغییر قیمت', titleEn: 'Price Changed', bodyFa: 'قیمت‌ها به‌روزرسانی شد.', bodyEn: 'Prices were updated.', smsFa: 'TongueAI: قیمت‌ها به‌روزرسانی شد.' },
  NEW_ORDER: { titleFa: 'سفارش جدید', titleEn: 'New Order', bodyFa: 'سفارش جدیدی ثبت شد.', bodyEn: 'A new order was placed.', smsFa: 'TongueAI: سفایر جدید ثبت شد.' },
  FILE_QUARANTINED: { titleFa: 'فایل قرنطینه شد', titleEn: 'File Quarantined', bodyFa: 'فایل ارسالی شما به دلیل مشکوک بودن به بدافزار رد و قرنطینه شد. لطفاً فایل سالم و اصلی را مجدداً ارسال کنید.', bodyEn: 'Your upload was rejected and quarantined as suspicious. Please upload the clean original file again.', smsFa: 'TongueAI: فایل شما قرنطینه شد.' },
  WORKFLOW_REMINDER: { titleFa: 'یادآوری گردش کار', titleEn: 'Workflow Reminder', bodyFa: 'یک مورد در گردش کار بیش از حد مجاز در وضعیت فعلی مانده است و منتظر اقدام شماست.', bodyEn: 'A workflow item has been waiting for action longer than its SLA allows.', smsFa: 'TongueAI: موردی در گردش کار منتظر اقدام شماست.' },
  WORKFLOW_ESCALATED: { titleFa: 'تشدید گردش کار', titleEn: 'Workflow Escalated', bodyFa: 'یک مورد گردش کار از مهلت مقرر گذشته و به مدیریت تشدید شد.', bodyEn: 'A workflow item breached its SLA and was escalated.', smsFa: 'TongueAI: موردی از مهلت گردش کار گذشته است.' },
  WORKFLOW_RECOVERED: { titleFa: 'بازگردانی گردش کار', titleEn: 'Workflow Recovered', bodyFa: 'وضعیت مورد شما توسط مدیر سیستم به‌صورت اضطراری اصلاح شد.', bodyEn: 'Your item was corrected by an emergency admin recovery.', smsFa: 'TongueAI: وضعیت مورد شما اصلاح شد.' },
  DELETION_REJECTED: { titleFa: 'درخواست حذف رد شد', titleEn: 'Deletion Request Rejected', bodyFa: 'درخواست حذف داده‌های شما بررسی و متأسفانه رد شد.', bodyEn: 'Your data-deletion request was reviewed and rejected.', smsFa: 'TongueAI: درخواست حذف داده شما رد شد.' },
}

export async function notify(
  userId: string,
  event: EventCode,
  opts?: { link?: string; sms?: boolean; phone?: string | null; emailTo?: string | null; extraFa?: string; extraEn?: string },
) {
  const t = TEMPLATES[event]
  try {
    await db.notification.create({
      data: {
        userId, type: event, titleFa: t.titleFa + (opts?.extraFa ? ` — ${opts.extraFa}` : ''),
        titleEn: t.titleEn + (opts?.extraEn ? ` — ${opts.extraEn}` : ''),
        bodyFa: t.bodyFa, bodyEn: t.bodyEn, link: opts?.link || null,
      },
    })
  } catch (e) {
    console.error('notify failed', e)
  }
  // SMS channel — through the INJECTED provider adapter (PHASE 13).
  // Notification failures stay isolated (never break the business flow) but
  // are now HONEST: FAILED rows + provider error, not faked DELIVERED.
  // No channel bound (e.g. browser chunk or cold server) → FAILED row with
  // the wiring reason — never a fake success (ED-143).
  if (opts?.sms && opts?.phone) {
    const channel = channels.sms
    if (!channel) {
      await db.sMSLog.create({
        data: {
          userId, recipient: opts.phone, template: event, content: t.smsFa,
          provider: 'UNWIRED', status: 'FAILED', deliveryStatus: 'FAILED',
          error: 'sms channel not bound (bootstrap did not run on this path)',
        },
      }).catch(() => undefined)
    } else {
      try {
        await channel.send({ recipient: opts.phone, message: t.smsFa, templateId: event })
        await db.sMSLog.create({
          data: {
            userId, recipient: opts.phone, template: event, content: t.smsFa,
            provider: channel.providerName, status: 'SENT', deliveryStatus: 'QUEUED',
          },
        })
      } catch (e) {
        await db.sMSLog.create({
          data: {
            userId, recipient: opts.phone, template: event, content: t.smsFa,
            provider: channel.providerName, status: 'FAILED', deliveryStatus: 'FAILED',
            error: (e instanceof Error ? e.message : String(e)).slice(0, 500),
          },
        }).catch(() => undefined)
      }
    }
  }
  // Email channel — injected likewise; failures isolated by design.
  if (opts?.emailTo && channels.email) {
    try {
      await channels.email.send({
        to: opts.emailTo,
        subject: `${t.titleFa} — باباحکیم`,
        text: `${t.bodyFa}\n\n${t.titleEn}: ${t.bodyEn}`,
      })
    } catch {
      // isolated by design — the in-app notification already landed
    }
  }
}

// notify every user holding a role (e.g. all EXPERT_1 users)
export async function notifyRole(role: string, event: EventCode, opts?: { link?: string; extraFa?: string }) {
  const users = await db.user.findMany({ where: { role, isActive: true, deletedAt: null }, select: { id: true } })
  for (const u of users) await notify(u.id, event, opts)
}
