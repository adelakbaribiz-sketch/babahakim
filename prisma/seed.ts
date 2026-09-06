// Seed: RBAC + demo users (all 6 roles) + questionnaire + diseases + products + AI model
// Run: bunx bun prisma/seed.ts  (or: bun prisma/seed.ts)
import { PrismaClient } from '@prisma/client'
import { scryptSync, randomBytes } from 'crypto'

const db = new PrismaClient()

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

import { ROLES, ROLE_LABELS, ROLE_PERMISSIONS, PERMISSIONS } from '../src/lib/constants'

async function main() {
  console.log('🌱 Seeding TongueAI platform...')

  // ── PHASE 20 (PERF1 root-cause): WAL from birth, not just from boot ────────
  // ED-182 tuning lives at app boot (src/lib/db.ts) — but a freshly db:push'ed
  // database is born journal_mode=delete and only becomes WAL after the first
  // app boot. The seed is the canonical rebuild step (db:push → db:seed), so
  // asserting it here makes every rebuilt DB WAL-native: PERF1 becomes a
  // property of the construction path, not of "did the app boot since rebuild".
  // Guarded + idempotent — same contract as the boot seam (tuning never blocks).
  try {
    await db.$queryRaw`PRAGMA journal_mode=WAL`
    await db.$queryRaw`PRAGMA synchronous=NORMAL`
    await db.$queryRaw`PRAGMA busy_timeout=5000`
    console.log('  ✓ SQLite WAL asserted (ED-182 — construction-time, not boot-time)')
  } catch {
    console.log('  · WAL assert skipped (non-SQLite/managed environment)')
  }

  // ── Permissions & Roles ──
  for (const code of PERMISSIONS) {
    await db.permission.upsert({ where: { code }, update: {}, create: { code, nameFa: code, nameEn: code } })
  }
  for (const role of ROLES) {
    const rec = await db.role.upsert({
      where: { code: role }, update: {},
      create: { code: role, nameFa: ROLE_LABELS[role].fa, nameEn: ROLE_LABELS[role].en },
    })
    const perms = ROLE_PERMISSIONS[role]
    for (const p of perms) {
      const perm = await db.permission.findUnique({ where: { code: p } })
      if (perm) {
        await db.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: rec.id, permissionId: perm.id } },
          update: {}, create: { roleId: rec.id, permissionId: perm.id },
        })
      }
    }
  }

  // ── Users ──
  const users = [
    { phone: '09120000001', firstName: 'رعیا', lastName: 'سیستمی', role: 'ADMIN', email: 'admin@tongueai.ir' },
    { phone: '09120000002', firstName: 'کیارش', lastName: 'کارشناس‌اول', role: 'EXPERT_1', email: 'expert1@tongueai.ir' },
    { phone: '09120000003', firstName: 'ثریا', lastName: 'کارشناس‌دوم', role: 'EXPERT_2', email: 'expert2@tongueai.ir' },
    { phone: '09120000004', firstName: 'پویا', lastName: 'اپراتور', role: 'OPERATOR', email: 'operator@tongueai.ir' },
    { phone: '09120000005', firstName: 'دکتر', lastName: 'آرش', lastName2: 'نیک‌پور', role: 'DOCTOR', email: 'doctor@tongueai.ir' },
    { phone: '09120000006', firstName: 'سارا', lastName: 'مریدی', role: 'PATIENT', email: 'patient@tongueai.ir' },
    { phone: '09120000007', firstName: 'امیر', lastName: 'رضایی', role: 'PATIENT' },
    { phone: '09120000008', firstName: 'نگار', lastName: 'حسینی', role: 'PATIENT' },
  ]
  const pw = hashPassword('Pass1234')
  const created: Record<string, string> = {}
  for (const u of users) {
    const rec = await db.user.upsert({
      where: { phone: u.phone }, update: {},
      create: {
        phone: u.phone, email: u.email, passwordHash: pw,
        firstName: u.firstName, lastName: u.role === 'DOCTOR' ? 'نیک‌پور' : u.lastName,
        role: u.role, isActive: true, profileComplete: true,
      },
    })
    created[u.role] = rec.id
    if (u.role === 'PATIENT') created[u.phone] = rec.id
  }
  // referral: امیر by سارا
  await db.referral.upsert({
    where: { referredUserId: created['09120000007'] }, update: {},
    create: { referrerId: created['PATIENT'], referredUserId: created['09120000007'], status: 'ACTIVE', ordersCount: 1, revenue: 420000 },
  })
  await db.patientProfile.upsert({
    where: { userId: created['09120000006'] }, update: {},
    create: {
      userId: created['09120000006'], province: 'تهران', city: 'تهران', postalCode: '1466783514',
      addressLine: 'خیابان ولیعصر، کوچه بهار، پلاک ۱۲', heightCm: 168, weightKg: 62,
      allergies: 'None', referredBy: '—',
    },
  })
  await db.patientProfile.upsert({
    where: { userId: created['09120000007'] }, update: {},
    create: { userId: created['09120000007'], province: 'اصفهان', city: 'اصفهان', addressLine: 'خیابان چهارباغ' },
  })

  // ── Questionnaire (مزاج‌شناسی) v1 ──
  const q = await db.questionnaire.upsert({
    where: { id: 'q-mizaj-v1' }, update: { isActive: true },
    create: { id: 'q-mizaj-v1', version: 1, titleFa: 'پرسشنامه تشخیص مزاج', titleEn: 'Temperament Assessment', isActive: true },
  })
  const questions: { textFa: string; textEn: string; helpFa?: string; options: { textFa: string; textEn: string; score: number; dimension: string }[] }[] = [
    {
      textFa: 'کالبد بدن شما چگونه است؟', textEn: 'What is your body frame?',
      options: [
        { textFa: 'لاغر و عضلانی', textEn: 'Slim & muscular', score: 3, dimension: 'HOT' },
        { textFa: 'درشت و با برجستگی استخوانی', textEn: 'Large with prominent bones', score: 3, dimension: 'COLD' },
        { textFa: 'متوسط و عضلانی', textEn: 'Medium & muscular', score: 2, dimension: 'HOT' },
        { textFa: 'شکم‌دار و نرم', textEn: 'Belly & soft', score: 2, dimension: 'COLD' },
      ],
    },
    {
      textFa: 'رنگ پوست صورت شما؟', textEn: 'Your facial skin color?',
      options: [
        { textFa: 'قرمز و برنزه', textEn: 'Red & tan', score: 3, dimension: 'HOT' },
        { textFa: 'سفید و روشن', textEn: 'White & bright', score: 2, dimension: 'COLD' },
        { textFa: 'زرد کم‌رنگ', textEn: 'Pale yellow', score: 2, dimension: 'DRY' },
        { textFa: 'تیره و برنزه', textEn: 'Dark & tan', score: 2, dimension: 'DRY' },
      ],
    },
    {
      textFa: 'مقدار موهای بدن شما؟', textEn: 'Amount of body hair?',
      options: [
        { textFa: 'زیاد', textEn: 'Much', score: 3, dimension: 'HOT' },
        { textFa: 'متوسط', textEn: 'Medium', score: 2, dimension: 'HOT' },
        { textFa: 'کم', textEn: 'Little', score: 3, dimension: 'COLD' },
      ],
    },
    {
      textFa: 'کیفیت پوست شما؟', textEn: 'Your skin quality?',
      options: [
        { textFa: 'گرم و نرم', textEn: 'Warm & soft', score: 3, dimension: 'HOT' },
        { textFa: 'سرد و خشک و زبر', textEn: 'Cold & rough', score: 3, dimension: 'COLD' },
        { textFa: 'سرد و نرم و لطیف', textEn: 'Cold & soft', score: 3, dimension: 'WET' },
        { textFa: 'گرم و خشک', textEn: 'Warm & dry', score: 3, dimension: 'DRY' },
      ],
    },
    {
      textFa: 'احساس تشنگی شما؟', textEn: 'Your thirst?',
      options: [
        { textFa: 'زیاد و سریع', textEn: 'High & frequent', score: 3, dimension: 'HOT' },
        { textFa: 'کم', textEn: 'Low', score: 3, dimension: 'WET' },
        { textFa: 'متوسط', textEn: 'Medium', score: 2, dimension: 'HOT' },
      ],
    },
    {
      textFa: 'اشتهای شما؟', textEn: 'Your appetite?',
      options: [
        { textFa: 'زیاد', textEn: 'High', score: 3, dimension: 'HOT' },
        { textFa: 'کم', textEn: 'Low', score: 3, dimension: 'COLD' },
        { textFa: 'متوسط', textEn: 'Medium', score: 2, dimension: 'HOT' },
      ],
    },
    {
      textFa: 'نبض شما معمولاً چگونه است؟', textEn: 'Your typical pulse?',
      options: [
        { textFa: 'سریع و پر و بزرگ', textEn: 'Fast & full', score: 3, dimension: 'HOT' },
        { textFa: 'کند و کم‌حجم', textEn: 'Slow & weak', score: 3, dimension: 'COLD' },
        { textFa: 'متوسط', textEn: 'Medium', score: 2, dimension: 'HOT' },
      ],
    },
    {
      textFa: 'خواب شما؟', textEn: 'Your sleep?',
      options: [
        { textFa: 'کم و پر از رویا', textEn: 'Short & dreamful', score: 3, dimension: 'DRY' },
        { textFa: 'زیاد و عمیق', textEn: 'Long & deep', score: 3, dimension: 'WET' },
        { textFa: 'متوسط', textEn: 'Medium', score: 2, dimension: 'HOT' },
      ],
    },
    {
      textFa: 'افکار و ذهنتان؟', textEn: 'Your thoughts?',
      options: [
        { textFa: 'تیز، فراوان و پیوسته', textEn: 'Sharp & abundant', score: 3, dimension: 'HOT' },
        { textFa: 'کند و آرام', textEn: 'Slow & calm', score: 3, dimension: 'COLD' },
        { textFa: 'معمولی', textEn: 'Ordinary', score: 2, dimension: 'HOT' },
      ],
    },
    {
      textFa: 'حال عمومی در هوای گرم؟', textEn: 'General state in hot weather?',
      options: [
        { textFa: 'بی‌قرار و کلاف', textEn: 'Restless', score: 3, dimension: 'HOT' },
        { textFa: 'راحت و بی‌آزار', textEn: 'Comfortable', score: 3, dimension: 'COLD' },
        { textFa: 'متوسط', textEn: 'Medium', score: 1, dimension: 'HOT' },
      ],
    },
    {
      textFa: 'حال عمومی در هوای سرد؟', textEn: 'General state in cold weather?',
      options: [
        { textFa: 'بی‌قرار و کلاف', textEn: 'Restless', score: 3, dimension: 'COLD' },
        { textFa: 'راحت و بی‌آزار', textEn: 'Comfortable', score: 3, dimension: 'HOT' },
        { textFa: 'متوسط', textEn: 'Medium', score: 1, dimension: 'COLD' },
      ],
    },
    {
      textFa: 'رطوبت پوست و عرق شما؟', textEn: 'Skin moisture & sweat?',
      options: [
        { textFa: 'عرق زیاد', textEn: 'Sweaty', score: 3, dimension: 'WET' },
        { textFa: 'خشک بدون عرق', textEn: 'Dry, no sweat', score: 3, dimension: 'DRY' },
        { textFa: 'متوسط', textEn: 'Medium', score: 2, dimension: 'WET' },
      ],
    },
    {
      textFa: 'دهان و زبان شما معمولاً؟', textEn: 'Your mouth & tongue usually?',
      options: [
        { textFa: 'خشک و تشنه', textEn: 'Dry & thirsty', score: 3, dimension: 'DRY' },
        { textFa: 'تر و بزاق‌دار', textEn: 'Wet & salivating', score: 3, dimension: 'WET' },
        { textFa: 'عادی', textEn: 'Normal', score: 2, dimension: 'WET' },
      ],
    },
    {
      textFa: 'شخصیت و رفتار کلی شما؟', textEn: 'Your overall personality?',
      options: [
        { textFa: 'شتاب‌زده، سریع، عصبی', textEn: 'Hasty, quick, nervous', score: 3, dimension: 'HOT' },
        { textFa: 'آرام و بادآورده', textEn: 'Calm & easygoing', score: 3, dimension: 'COLD' },
        { textFa: 'متوسط', textEn: 'Medium', score: 2, dimension: 'HOT' },
      ],
    },
    {
      textFa: 'هضم غذا و دفع شما؟', textEn: 'Digestion & excretion?',
      options: [
        { textFa: 'سریع و روان', textEn: 'Fast & smooth', score: 3, dimension: 'HOT' },
        { textFa: 'کند و یبوست‌دار', textEn: 'Slow & constipated', score: 3, dimension: 'COLD' },
        { textFa: 'معمولی', textEn: 'Normal', score: 2, dimension: 'HOT' },
      ],
    },
  ]
  let order = 0
  for (const qq of questions) {
    order++
    await db.question.upsert({
      where: { id: `q1-${order}` }, update: { order, textFa: qq.textFa, textEn: qq.textEn },
      create: { id: `q1-${order}`, questionnaireId: q.id, order, textFa: qq.textFa, textEn: qq.textEn },
    })
    for (let oi = 0; oi < qq.options.length; oi++) {
      const o = qq.options[oi]
      await db.questionOption.upsert({
        where: { id: `q1-${order}-${oi}` }, update: { score: o.score, dimension: o.dimension, order: oi },
        create: { id: `q1-${order}-${oi}`, questionId: `q1-${order}`, textFa: o.textFa, textEn: o.textEn, score: o.score, dimension: o.dimension, order: oi },
      })
    }
  }
  // Remove demo response if any leftover

  // ── PHASE 20 (ED-157 root-cause): demo case chain for the seed patient ────
  // The search/reporting suite asserts the seed patient owns ≥1 case ("TC-"
  // code) to verify patient-side search scoping (own data only, never other
  // patients'). That contract was written in the test's comment ("seed patient
  // سارا has ≥1 case") but never implemented — the suite stayed green only on
  // legacy DB residue, and broke the moment the DB was rebuilt from source
  // (state/source separation, PHASE 19). Deterministic + idempotent chain:
  //   questionnaireResponse → CLOSED demo case → timeline event.
  // CLOSED status keeps expert queues and workflow tests untouched (queues
  // filter WAITING_FOR_EXPERT_*; search only filters deletedAt + ownership).
  await db.questionnaireResponse.upsert({
    where: { id: 'qr-demo-sara' }, update: {},
    create: {
      id: 'qr-demo-sara', userId: created['09120000006'], questionnaireId: q.id,
      answers: JSON.stringify([{ questionId: 'q1-1', optionId: 'q1-1-0', score: 3, dimension: 'HOT' }]),
      scores: JSON.stringify({ HOT: 9, COLD: 4, WET: 6, DRY: 3 }),
      mizajFa: 'گرم و تر', mizajEn: 'Warm & Moist', summary: 'پاسخ دموی seed',
    },
  })
  await db.medicalCase.upsert({
    where: { id: 'case-demo-sara' }, update: {},
    create: {
      id: 'case-demo-sara', code: 'TC-DEMO-000001', patientId: created['09120000006'],
      status: 'CLOSED', priority: 'NORMAL',
      description: 'پرونده نمونه seed — برای دمو و تست محدودهٔ جستجوی بیمار (ED-157)',
      mizajSnapshot: JSON.stringify({ mizajFa: 'گرم و تر', mizajEn: 'Warm & Moist', scores: { HOT: 9, COLD: 4, WET: 6, DRY: 3 }, province: 'تهران', city: 'تهران' }),
      closedAt: new Date('2026-08-20T10:00:00Z'),
    },
  })
  await db.caseEvent.upsert({
    where: { id: 'event-demo-sara-close' }, update: {},
    create: {
      id: 'event-demo-sara-close', caseId: 'case-demo-sara', actorId: created['09120000006'],
      action: 'STATUS_CHANGE', fromStatus: 'NEW', toStatus: 'CLOSED',
      comment: 'بستن پروندهٔ دموی seed (PHASE 20)',
    },
  })

  // ── Diseases ──
  const diseases = [
    { code: 'D-MAJN', nameFa: 'م غلبه صفرا', nameEn: 'Bile (Safra) Dominance', category: 'مزاجی', descriptionFa: 'غلبه اخلاط صفراوی با نشانه‌های گرمی، قرمزی زبان و تشنگی', symptomsFa: 'تشنگی، قرمزی زبان، بی‌قراری، یبوست', expertNotes: 'اصلاح تغذیه + داروهای مبرّد صفرا' },
    { code: 'D-BLGH', nameFa: 'غعبه بلغم', nameEn: 'Phlegm (Balgham) Dominance', category: 'مزاجی', descriptionFa: 'غعبه اخلاط بلغمی با نشانه‌های سردی، رطوبت و سنگینی', symptomsFa: 'سنگینی، خواب زیاد، رطوبت زبان، کسالت', expertNotes: 'داروهای گرم‌کننده + کاهش لبنیات' },
    { code: 'D-SUDA', nameFa: 'غعبه سودا', nameEn: 'Soda (Black Bile) Dominance', category: 'مزاجی', descriptionFa: 'غعبه سودا با نشانه‌های خشکی، کبودی و افکار غالب', symptomsFa: 'خشکی پوست، وسواس فکری، بی‌خوابی', expertNotes: 'معتدل‌کننده سودا + اصلاح خواب' },
    { code: 'D-DAM', nameFa: 'غعبه دم', nameEn: 'Blood (Dam) Dominance', category: 'مزاجی', descriptionFa: 'غعبه اخلاط دمی با گرمی و رطوبت زیاد', symptomsFa: 'سرفه، پرخوری، سنگینی سر', expertNotes: 'فصد/حجامت + رژیم' },
    { code: 'D-ZOH', nameFa: 'ضعف معده', nameEn: 'Stomach Weakness', category: 'گوارشی', descriptionFa: 'ضعف نیروی هاضمه معده', symptomsFa: 'نفخ، سنگینی بعد غذا، بی‌اشتهایی', expertNotes: 'مقوی معده + تدابیر غذایی' },
    { code: 'D-AML', nameFa: 'کم‌خونی', nameEn: 'Anemia (Pale Tongue)', category: 'خونی', descriptionFa: 'کم‌رنگی زبان مرتبط با کاهش خون', symptomsFa: 'کم‌رنگی زبان، خستگی، سرگیجه', expertNotes: 'مقوی خون + آهن گیاهی' },
  ]
  for (const d of diseases) {
    await db.disease.upsert({
      where: { code: d.code }, update: {},
      create: { code: d.code, nameFa: d.nameFa, nameEn: d.nameEn, category: d.category, descriptionFa: d.descriptionFa, descriptionEn: d.descriptionFa, symptomsFa: d.symptomsFa, symptomsEn: d.symptomsFa, expertNotes: d.expertNotes, active: true },
    })
  }

  // ── Products ──
  const products = [
    { sku: 'P-1001', nameFa: 'شربت گلاب', nameEn: 'Rosewater Syrup', brand: 'گیاه‌دارو', category: 'شربت', price: 145000, purchase: 110000, stock: 40, otc: true, usage: 'روزی ۲ قاشق بعد غذا' },
    { sku: 'P-1002', nameFa: 'رب آلو', nameEn: 'Prune Paste', brand: 'طبی‌سبز', category: 'ملین', price: 98000, purchase: 72000, stock: 60, otc: true, usage: 'روزی ۱ قاشق صبح ناشتا' },
    { sku: 'P-1003', nameFa: 'دمنوش بابونه', nameEn: 'Chamomile Tea', brand: 'گیاه‌دارو', category: 'دمنوش', price: 76000, purchase: 52000, stock: 80, otc: true, usage: '۱ کیسه در آب جوش' },
    { sku: 'P-1004', nameFa: 'شربت سنبل‌الطیب', nameEn: 'Valerian Syrup', brand: 'سحردارو', category: 'آرام‌بخش', price: 210000, purchase: 160000, stock: 25, otc: false, usage: 'شب‌ها ۱ قاشق قبل خواب' },
    { sku: 'P-1005', nameFa: 'قرص مفرح قلب', nameEn: 'Cardiac Tonic Tablets', brand: 'نورهش', category: 'قرص', price: 320000, purchase: 240000, stock: 15, otc: false, usage: 'روزی ۲ قرص بعد غذا' },
    { sku: 'P-1006', nameFa: 'حلوой بذر کتان', nameEn: 'Flaxseed Halva', brand: 'طبی‌سبز', category: 'حلوا', price: 165000, purchase: 120000, stock: 30, otc: true, usage: 'روزی ۲ قاشق' },
    { sku: 'P-1007', nameFa: 'قرص آهن گیاهی', nameEn: 'Herbal Iron Tablets', brand: 'نورهش', category: 'قرص', price: 285000, purchase: 210000, stock: 20, otc: false, usage: 'روزی ۱ قرص بعد ناهار' },
    { sku: 'P-1008', nameFa: 'شربت هلیله', nameEn: 'Helle Syrup', brand: 'سحردارو', category: 'شربت', price: 190000, purchase: 140000, stock: 18, otc: false, usage: 'روزی ۱ قاشق صبح' },
    { sku: 'P-1009', nameFa: 'دم‌کرده زنجبیل', nameEn: 'Ginger Infusion', brand: 'گیاه‌دارو', category: 'دمنوش', price: 68000, purchase: 45000, stock: 90, otc: true, usage: 'روزی ۱ فنجان بعد غذا' },
    { sku: 'P-1010', nameFa: 'قرص شکر رنگ', nameEn: 'Rose Tablets', brand: 'نورهش', category: 'قرص', price: 155000, purchase: 115000, stock: 35, otc: true, usage: 'روزی ۲ قرص مکیدنی' },
    { sku: 'P-1011', nameFa: 'قرص سکنجبین', nameEn: 'Sekanjabin Tablets', brand: 'سحردارو', category: 'قرص', price: 132000, purchase: 98000, stock: 22, otc: true, usage: 'روزی ۳ قرص' },
    { sku: 'P-1012', nameFa: 'مرهم زخم زبان', nameEn: 'Tongue Ulcer Ointment', brand: 'طبی‌سبز', category: 'مرهم', price: 240000, purchase: 175000, stock: 12, otc: true, usage: 'مواضعی روزی ۲ بار' },
  ]
  for (const p of products) {
    await db.product.upsert({
      where: { sku: p.sku }, update: {},
      create: {
        sku: p.sku, nameFa: p.nameFa, nameEn: p.nameEn, brand: p.brand, category: p.category,
        descriptionFa: `${p.nameFa} — فرآورده گیاهی طب سنتی ایرانی`, descriptionEn: `${p.nameEn} — herbal product`,
        currentPrice: p.price, purchasePrice: p.purchase, stock: p.stock, active: true,
        requiresPrescription: !p.otc, usageFa: p.usage,
      },
    })
    await db.productPriceHistory.create({
      data: { productId: p.sku === 'P-1001' ? 'seed-price-1' : '', newPrice: p.price, reason: 'INITIAL', changedById: created['ADMIN'] },
    }).catch(() => { /* ignore: seed history handled below */ })
  }
  // proper price history rows
  const allProducts = await db.product.findMany()
  for (const p of allProducts) {
    const exists = await db.productPriceHistory.findFirst({ where: { productId: p.id } })
    if (!exists) {
      await db.productPriceHistory.create({ data: { productId: p.id, newPrice: p.currentPrice, reason: 'INITIAL', changedById: created['ADMIN'] } })
    }
  }

  // ── AI model registry ──
  await db.aIModel.upsert({
    where: { id: 'model-v1' }, update: {},
    create: {
      id: 'model-v1', name: 'TongueModelV1', version: 1, provider: 'TongueModelV1', isActive: true,
      metrics: JSON.stringify({ accuracy: 0.78, precision: 0.76, recall: 0.74, f1: 0.75, samples: 1240 }),
      trainingDataset: 'dataset-v0.3', trainingDate: new Date('2026-08-01'), approvalStatus: 'DEPLOYED',
    },
  })

  // ── Sample expense ──
  await db.financialTransaction.createMany({
    data: [
      { type: 'EXPENSE', category: 'TRANSPORT', amount: 350000, description: 'هزینه پیک شهری — مهر', createdById: created['OPERATOR'] },
      { type: 'EXPENSE', category: 'SALARY', amount: 8500000, description: 'حقوق اپراتور — آبان', createdById: created['ADMIN'] },
    ],
  }).catch(() => {})

  console.log('✅ Seed complete.')
  console.log('   Admin:    09120000001 / Pass1234')
  console.log('   Expert1:  09120000002 / Pass1234')
  console.log('   Expert2:  09120000003 / Pass1234')
  console.log('   Operator: 09120000004 / Pass1234')
  console.log('   Doctor:   09120000005 / Pass1234')
  console.log('   Patient:  09120000006 / Pass1234 (سارا مریدی)')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
