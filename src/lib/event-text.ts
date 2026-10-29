// Display text for case timeline / recent-activity entries (client-safe).
// CaseEvent.comment stores the system description in Persian (machine descFa,
// service messages). In English mode those known system phrases are shown in
// English; anything else is human-entered text (a reason, a doctor's comment)
// and is shown exactly as written — never machine-translated.

const EXACT: Record<string, string> = {
  'کارشناس اول پرونده را دریافت کرد': 'Expert 1 claimed the case',
  'ارزیابی اولیه ارسال شد': 'Initial assessment sent to the patient',
  'کاربر ادامه درمان را تأیید کرد': 'Patient approved continuing treatment',
  'کاربر ادامه درمان را رد کرد': 'Patient declined treatment',
  'نسخه کارشناس اول ثبت شد': 'Expert 1 submitted the prescription',
  'بازبینی کارشناس دوم و ارسال برای پزشک': 'Expert 2 reviewed and sent to the doctor',
  'کارشناس دوم نسخه را برای اصلاح به کارشناس اول برگرداند': 'Expert 2 returned the prescription to Expert 1',
  'پزشک نسخه را تأیید کرد': 'Doctor approved the prescription',
  'پزشک نسخه را رد کرد — بازگشت برای اصلاح': 'Doctor rejected the prescription — back for revision',
  'پزشک اصلاح درخواست کرد': 'Doctor requested changes',
  'پیش‌فاکتور ایجاد شد': 'Proforma invoice created',
  'پیش‌فاکتور توسط کاربر تأیید شد': 'Patient confirmed the proforma',
  'پیش‌فاکتور رد شد': 'Proforma rejected',
  'پرداخت تأیید شد': 'Payment confirmed',
  'سفارش ارسال شد': 'Order shipped',
  'تحویل ثبت شد': 'Delivery recorded',
  'پیگیری درمان فعال شد': 'Treatment follow-up scheduled',
  'پیگیری تکمیل شد': 'Follow-up completed',
  'ارجاع مجدد ثبت شد': 'Re-referral recorded',
  'ایجاد پرونده و قرارگیری در صف': 'Case created and queued',
  'ایجاد پرونده و ورود به صف کارشناسان': 'Case created and queued for experts',
  'پرونده بایگانی شد': 'Case archived',
  'پرونده از بایگانی بازگردانده شد': 'Case restored from archive',
}

const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^تحلیل اولیه توسط (.+) انجام شد$/, (m) => `Initial AI analysis by ${m[1]}`],
  [/^پیش‌فاکتور (\S+) صادر شد$/, (m) => `Proforma ${m[1]} issued`],
  [/^تحویل مرسوله (.+)$/, (m) => `Shipment ${m[1]} delivered`],
  [/^برگشت به کارشناس اول — ([\s\S]+)$/, (m) => `Returned to Expert 1 — ${m[1]}`],
  [/^کارشناس دوم نسخه را ویرایش کرد \(نسخه (\d+)\) — ([\s\S]+)$/, (m) => `Expert 2 edited the prescription (version ${m[1]}) — ${m[2]}`],
  [/^بازیابی مدیریتی — دلیل: ([\s\S]+)$/, (m) => `Admin recovery — reason: ${m[1]}`],
]

export function eventText(text: string | null | undefined, lang: 'fa' | 'en'): string {
  if (!text || lang === 'fa') return text || ''
  const exact = EXACT[text.trim()]
  if (exact) return exact
  for (const [re, fmt] of PATTERNS) {
    const m = text.trim().match(re)
    if (m) return fmt(m)
  }
  return text
}
