# AI/ML Engineering — BabaHakim (PHASE 11)

> فاز ۱۱ — مهندسی هوش مصنوعی: ممیزی کامل AI Stack (۲۰ محور)، موتور MLOps با ۱۰ ماژول، حلقه بازخورد انسانی→دیتاست، دروازه اعتبارسنجی انسانی، و رفع یک باگ پروداکشن واقعی در گردش کار بازبینی AI.
>
> Charter mandate (this phase's core invariant): **«AI نتیجه‌ای تولید نکند که بدون Human/Business Validation نیاز به اعتماد قطعی داشته باشد»** — AI output is never a final medical result; the human chain (Expert1 → Expert2 → Doctor) owns every final decision. Adapter/Interface mandate: the model is swappable **from the DB registry, without code changes**.

---

## 1. ممیزی AI Stack — ۲۰ محور (Audit)

وضعیت قبل از فاز ۱۱ → وضعیت پس از فاز ۱۱:

| # | محور | وضعیت قبل (یافته ممیزی) | وضعیت بعد (پیاده‌سازی) |
|---|------|--------------------------|------------------------|
| 1 | **Data** | تصاویر MedicalImage با کیفیت JSON؛ بدون حاکمیت دادهٔ AI | Input guard (وضعیت/مالکیت/کیفیت) + hash محتوا + provenance کامل در هر استنتاج |
| 2 | **Dataset** | کوئری ad-hoc روی ۱۰۰ تحلیل آخر («دیتاست» فقط نمایشی) | موجودیت `AIDataset` نسخه‌دار (DRAFT→FROZEN→ARCHIVED) + `AIDatasetItem` + آمار + فریز |
| 3 | **Labels** | فقط `reviewStatus` روی تحلیل — بدون ذخیرهٔ برچسب ساختاریافته | زنجیرهٔ برچسب: AI prediction → Expert1 → Expert2 → Final/Doctor + فلگ اختلاف + اصلاحات per-indicator |
| 4 | **Features** | TongueFeatures از پیکسل‌ها (تعویض‌ناپذیر و مقید به مدل) | استخراج مستقل + نسخهٔ Preprocessing (`PREPROCESSING_VERSION`) + باند-چک خروجی |
| 5 | **Models** | رجیستری DB موجود ولی `getActiveProvider()` **هاردکد** | رزولوشن DB-محور (`resolveActiveModel`) + نقشهٔ Factory — تعویض مدل = تغییر رکورد DB (ED-121) |
| 6 | **Prompts** | هیچ (مدل قاعده‌محور) | رجیستری نسخه‌دار و تغییرناپذیر `AIPromptTemplate` + رندر امن ضد-تزریق (ED-122) |
| 7 | **Embeddings** | هیچ | پورت `EmbeddingProvider` + استب Hash قطعی + cosine — آمادهٔ تعویض با سرویس واقعی |
| 8 | **Inference** | async در JobQueue ✅ (فاز ۸) | همان مسیر + گارد ورودی/خروجی + هزینه + تله‌متری `AIInferenceLog` + قابلیت Re-run |
| 9 | **Evaluation** | `metrics` JSON **دستی/سید‌شده** (داده جعلی!) | فریم‌ورک محاسبهٔ واقعی: accuracy/precision/recall/F1/confusion/sensitivity/specificity/calibration/imbalance (ED-127) |
| 10 | **Model Versioning** | ثبت نسخه در هر تحلیل ✅ | + پیوند trainingDatasetVersion/preprocessingVersion/promptVersion در رجیستری |
| 11 | **Prompt Versioning** | هیچ | ED-122 — نسخه‌های تغییرناپذیر، append-only |
| 12 | **Dataset Versioning** | هیچ | DRAFT→FROZEN با `@@unique(name,version)` — آموزش فقط روی FROZEN |
| 13 | **Feedback** | بازبینی‌ها ثبت می‌شد ولی **هیچ‌وقت به دیتاست تبدیل نمی‌شد** (حلقه باز) | حلقهٔ بستهٔ رویداد-محور: `AiReviewDecided` → برچسب دیتاست (ED-124) |
| 14 | **Monitoring** | فقط processingMs | آمار استنتاج (حجم/لاتنسی/اطمینان/خطا/replay) + شاخص Bias کلاس |
| 15 | **Data Leakage** | N/A (آموزشی نبود) | تفکیک **بیمار-محور** با hash نمک‌خورده + `assertNoPatientLeakage` (spec §63) |
| 16 | **Bias** | N/A | توزیع کلاس پیش‌بینی + فلگ کلاس-غالب>۸۰٪ + imbalance در گزارش ارزیابی |
| 17 | **Drift** | N/A | PSI (Population Stability Index) روی ویژگی‌ها + اطمینان؛ WARN 0.1 / ALARM 0.25 + رویداد و اعلان (ED-126) |
| 18 | **AI Security** | امضای URL + اسکن بدافزار (فاز ۱۰) ✅ | + گارد خروجی (zod + allowlist شاخص + clamp) + گارد ورودی + replay + دروازهٔ آموزش + رندر امن پرامپت (ED-129) |
| 19 | **AI Cost** | فقط processingMs | مدل هزینه (CPU-ms / token-ready)، ثبت در هر استنتاج، سقف بودجهٔ ماهانه + هشدار ۸۰٪ (ED-128) |
| 20 | **Human Validation** | معماریت AI-Assisted CDS ✅ ولی بدون دروازهٔ صریح | دروازهٔ سه‌سطحی صریح + `AI_SUGGESTION_ONLY` + `aiAssisted` مشتق از تأیید واقعی (ED-125) |

### یافته بحرانی ممیزی — باگ پروداکشن واقعی (رفع شد)

**B-11-1**: موتور گردش کار `row.status` را می‌خواند؛ `AIAnalysis` وضعیت ماشین را در `reviewStatus` نگه می‌دارد. نتیجه: هر انتقال AI_REVIEW از فاز ۰۲ تا ۱۰ **بی‌صدا شکست می‌خورد** (`INVALID_TRANSITION` نرم که caller نادیده می‌گرفت) — بازبینی‌های انسانی هرگز ثبت نمی‌شدند، `humanReviewed` همیشه false، حلقهٔ یادگیری کاملاً باز. رفع: `statusKey` در `MachineDef` + موتور (خواندن/نوشتن/audit/نتیجه از یک کلید) + caseActionService حالا شکست انتقال را FATAL می‌کند.

---

## 2. معماری موتور AI/ML

```
src/server/infrastructure/ai/          ← ۱۰ ماژول (الگوی موتور رسانهٔ فاز ۱۰)
├── constants.ts      سیاست‌ها و آستانه‌ها (تک‌منبعی)
├── registry.ts       ED-121 — رزولوشن مدل فعال از DB + نقشه Factory
├── prompts.ts        ED-122 — رجیستری پرامپت نسخه‌دار + رندر امن
├── security.ts       ED-129 — گارد ورودی/خروجی/بازیابی/آموزش
├── validation-gate.ts ED-125 — دروازهٔ اعتبارسنجی انسانی سه‌سطحی
├── datasets.ts       ED-123/124 — دیتاست + حلقهٔ بازخورد + تفکیک بیمار-محور
├── evaluation.ts     ED-127 — متریک کامل + گزارش ارزیابی
├── monitoring.ts     ED-126/130 — تله‌متری + آمار + PSI drift + bias
├── cost.ts           ED-128 — مدل هزینه + سقف بودجه
├── embeddings.ts     پورت Embedding (استب قطعی، قابل تعویض)
├── pipeline.ts       مسیر واحد استنتاج (guard→analyze→guard→persist→telemetry→event)
└── index.ts          سطح عمومی
```

### زنجیرهٔ استنتاج (مسیر واحد)

```
JobQueue 'ai-analysis' (خارج از مسیر درخواست — ED-102/114)
  → resolveActiveModel()           [DB: isActive + DEPLOYED → Factory]
  → validateAiInput()              [مالکیت/وضعیت/aiPath]
  → sha256File + isReplayedInput   [تله‌متری replay]
  → provider.analyze()             [TongueModelV1 یا مدل آینده]
  → validateAiOutput()             [zod + allowlist + clamp + فینیت]
  → AIAnalysis.create              [reviewStatus=PENDING_REVIEW — همیشه]
  → AIInferenceLog.create          [provenance + هزینه]
  → publish AiAnalysisCompleted
```

شکست در هر نقطه → تله‌متری FAILED (با هزینهٔ هدررفته) + rethrow → JobQueue retry/DLQ.

---

## 3. حلقهٔ بازخورد (Feedback Loop — spec §11/§12)

```
SUBMIT_ASSESSMENT (Expert 1, aiAgreement + aiCorrections)
  → AI_REVIEW machine transition (اکنون واقعاً اجرا می‌شود — B-11-1)
  → publish AiReviewDecided {analysisId, decision, corrections}
  → bootstrap subscriber → recordReviewLabel()
      → AIDatasetItem: expert1Label (اصلاحات JSON یا کد توافق)
        + patientHash (نمک‌خورده — بدون PHI)
        + فلگ disagreement وقتی E1≠E2
DOCTOR_APPROVE / DOCTOR_REJECT
  → finalizeFinalLabel() → reviewStatus=FINALIZED (ground truth)
POST /admin/ai/evaluate → job ai-evaluation
  → computeMetrics (FINALIZED items) → AIEvaluationReport
  → AIModel.metrics تازه می‌شود (محاسبه‌شده، نه دستی)
POST /admin/ai/datasets {freeze} → FROZEN تغییرناپذیر + پیش‌نویس جدید
```

**ارزش برچسب اصلاحی**: وقتی Expert 1 `aiCorrections: [{indicator, value}]` بفرستد، برچسب = JSON اصلاحات (ground truth واقعی per-indicator)؛ در غیر این صورت کد توافق (AGREE_WITH_AI/PARTIALLY_AGREE/DISAGREE) یا برچسب نهایی دکتر (DOCTOR_APPROVED/DOCTOR_REJECTED). ارزیابی فقط جفت‌های دارای ground truth واقعی را مصرف می‌کند.

---

## 4. دروازهٔ اعتبارسنجی انسانی (ED-125 — هستهٔ منشور)

| سطح | معنا | قاعده |
|-----|------|-------|
| ۱ | نمایش به بیمار | همیشه مجاز — **با** قاب «پیشنهاد کمکی + اطمینان + عدم قطعیت + نیاز بازبینی» (AIAnalysisCard موجود) |
| ۲ | مبنا تصمیم بالینی | فقط `ACCEPTED`/`MODIFIED` + reviewer ثبت‌شده (`assertHumanValidated`) |
| ۳ | نتیجهٔ نهایی بالینی | **هرگز** از AI به‌تنهایی (`isFinalClinicalResult` همیشه false) |

اجرای عملی:
- `AIAnalysis` همیشه با `reviewStatus=PENDING_REVIEW` ساخته می‌شود (pipeline invariant).
- `Diagnosis.aiAssisted` حالت از `resolveAiAssistedFlag(aiAgreement)` مشتق می‌شود — REJECT/no-review ⇒ false.
- UI اکشن‌ها از ماشین مشتق می‌شوند (فاز ۹، ED-113) — هیچ مسیر خودکار بدون گیت انسانی وجود ندارد.

---

## 5. نسخه‌بندی (Versioning — spec §61/§11)

| نوع | مکانیزم | تغییرناپذیری |
|-----|---------|--------------|
| Model | `AIModel` (version, approvalStatus DRAFT→…→DEPLOYED, isActive) + ثبت modelName/modelVersion در هر AIAnalysis/InferenceLog | رکورد‌های جدید فقط append |
| Prompt | `AIPromptTemplate` `@@unique(key,version)` + رجیستری کد (منبع حقیقت) | update = noop؛ تغییر متن = نسخهٔ جدید |
| Dataset | `AIDataset` `@@unique(name,version)`، DRAFT→FROZEN | freeze = قطعی؛ آموزش/ارزیابی فقط روی FROZEN |
| Preprocessing | `PREPROCESSING_VERSION` ثابت + ثبت در هر استنتاج | bump دستی هنگام تغییر منطق ویژگی |
| Provenance | هر Prediction: model_id/version, dataset_version, preprocessing_version, prompt key/version, timestamp, confidence, threshold | ✅ spec §61 کامل |

---

## 6. Drift / Bias / Cost (پایش عملیاتی)

- **PSI**: مقایسهٔ توزیع پنجرهٔ اخیر (۲۴h) با خط پایهٔ مدل (ثبت خودکار پس از ۱۰ تحلیل، `captureBaseline`). آستانه‌ها: `<0.1` پایدار · `0.1–0.25` WARN · `>0.25` ALARM → رویداد `AiDriftDetected` → اعلان ادمین‌ها. Job تکرارشوندهٔ `ai-monitor` هر ۵ دقیقه.
- **Bias**: توزیع کلاس پیش‌بینی در پنجرهٔ ۷ روز؛ کلاس غالب >۸۰٪ ⇒ فلگ. + imbalance و per-class metrics در ارزیابی (هرگز accuracy تنها — spec §60).
- **Cost**: واحد هزینهٔ نرمال per inference (CPU-ms×نرخ برای مدل محلی؛ token-ready برای LLM آینده). سقف ماهانه: `AI_MONTHLY_BUDGET_UNITS` (پیش‌فرض ۵۰k)، هشدار در ۸۰٪ (`AiBudgetAlert`).

---

## 7. امنیت AI (ED-129)

| گارد | شرح |
|------|------|
| Input | تصویر به پرونده تعلق دارد، REJECTED نیست، aiPath آماده |
| Output | zod schema کامل؛ شاخص‌ها فقط از allowlist؛ confidence/quality clamp 0..1؛ ویژگی‌ها finite (ضد NaN/Infinity)؛ disclaimer همیشه متن قراردادی |
| Replay | hash SHA-256 ورودی؛ تحلیل مجدد مجاز ولی `replay=true` در تله‌متری (شفاف) |
| Training gate | آموزش فقط روی دیتاست FROZEN + مدل EVALUATION/APPROVED (`assertCanTrain`) |
| Prompt injection | رندر با جایگزینی `{{var}}` + escape براکت‌ها؛ هیچ ورودی خام به قالب سیستم نمی‌چسبد |
| De-identification | دیتاست فقط `patientHash` (SHA-256 نمک‌خورده) — بدون هیچ PHI |
| Malware/Virus | از موتور رسانهٔ فاز ۱۰ (اسکن L1-L4 + قرنطینه) — تصویر قبل از رسیدن به AI اسکن می‌شود |

Salt تولید باید در پروداکشن از env `AI_DATASET_HASH_SALT` بخوانده شود (D-11-2).

---

## 8. API (همه نازک، ED-93)

| مسیر | متد | نقش‌ها | شرح |
|------|-----|--------|------|
| `/api/v1/admin/ai/overview` | GET | ADMIN, E1, E2, DR | رجیستری + دیتاست + پایش + bias + هزینه + گزارش‌ها (یک فراخوانی داشبورد) |
| `/api/v1/admin/ai/datasets` | GET | ADMIN, E1, E2 | نسخه‌ها + آیتم‌ها + آمار |
| `/api/v1/admin/ai/datasets` | POST | ADMIN | `{action:'freeze'\|'exclude'}` (exclude با reason الزامی) |
| `/api/v1/admin/ai/prompts` | GET | ADMIN, E1, E2 | رجیستری پرامپت (DB + شمارش کد) |
| `/api/v1/admin/ai/evaluate` | POST | ADMIN, E1 | enqueue job ارزیابی (async) |
| `/api/v1/admin/ai/monitoring` | GET | ADMIN, E1, E2 | snapshot زنده (inference/bias/cost/drift) |
| `/api/v1/cases/[id]/rerun-ai` | POST | ADMIN, E1 | استنتاج مجدد — AIAnalysis جدید، تاریخچه حفظ، PENDING_REVIEW |

---

## 9. فرانت‌اند (ادمین)

`AdminAIModelsPage` بازنویسی شد به داشبورد ۴-تبی:
1. **رجیستری مدل** — کارت مدل با metrics محاسبه‌شده + provenance (dataset/prompt/preproc/baseline) + دکمهٔ «اجرای ارزیابی» + گزارش‌های ارزیابی
2. **دیتاست** — ۶ آمار + نسخه‌ها + آیتم‌های یادگیری (E1/E2/F برچسب‌ها + فلگ اختلاف + hash بیمار) + دکمهٔ فریز
3. **پایش و Drift** — آمار استنتاج + توزیع bias + نوار بودجه + توضیح آستانه‌های PSI
4. **پرامپت‌ها** — جدول نسخه‌های تغییرناپذیر

رفع باگ قدیمی UI: استفاده از `lang` بدون تعریف در نسخهٔ قبلی (ReferenceError) — حالا از `useApp()`.

---

## 10. تست

- **۵۱ unit** (`ai-engine.test.ts`): رجیستری، پرامپت (نسخه/رندر/ضد-تزریق)، گارد خروجی (allowlist/clamp/NaN/disclaimer)، گارد ورودی، دروازهٔ اعتبارسنجی (۳ سطح + aiAssisted)، تفکیک بیمار-محور (عدم-نشت تضمینی + قطعیت)، متریک کامل (ماتریس دست‌محاسبه + calibration)، PSI (پایدار/شیفت/سرد)، هزینه، embedding.
- **۱۱ integration** (`ai-mlops.test.ts`): آپلود→پرونده→AI async (provenance + PENDING_REVIEW) → تله‌متری → پرامپت سیدشده → بازبینی E1 با اصلاحات → آیتم دیتاست (hash بدون PHI) → دروازهٔ دکتر → FINALIZED → ارزیابی با متریک کامل → re-run (تاریخچه + PENDING_REVIEW) → مجوزدهی ۶ مسیر → فریز.
- **رگرسیون**: ۲۵۱/۲۵۱ bun test (گلدن‌پس حالا با بازبینی AI واقعی) + ۴۵/۴۵ pentest + backend/media audit سبز.
- **مرورگر**: ۴ تب با دادهٔ زنده (۲۰ استنتاج، ۱۳ نسخهٔ دیتاست، گزارش ارزیابی) — بدون خطای صفحه.

---

## 11. Engineering Decisions (رجیستری ED)

| ED | تصمیم |
|----|--------|
| ED-120 | موتور AI/ML در `src/server/infrastructure/ai/` با ۱۰ ماژول (الگوی فاز ۱۰) |
| ED-121 | رزولوشن provider از DB رجیستری + نقشه Factory — تعویض مدل بدون کد |
| ED-122 | پرامپت‌ها نسخه‌دار تغییرناپذیر؛ رجیستری کد = منبع حقیقت؛ DB = ردّ ممیزی |
| ED-123 | دیتاست DRAFT→FROZEN؛ تفکیک بیمار-محور (hash نمک‌خورده) — ضد-نشت §63 |
| ED-124 | حلقهٔ بازخورد رویداد-محور (`AiReviewDecided`) — بدون کوپلینگ کد بالینی |
| ED-125 | دروازهٔ اعتبارسنجی سه‌سطحی؛ `aiAssisted` فقط از تأیید واقعی |
| ED-126 | PSI برای drift (0.1/0.25) + خط پایهٔ خودکار + اعلان ALARM |
| ED-127 | ارزیابی با متریک کامل؛ metrics رجیستری فقط محاسبه‌شده (نه دستی) |
| ED-128 | واحد هزینهٔ نرمال + سقف ماهانه + هشدار ۸۰٪ |
| ED-129 | گارد خروجی zod + allowlist شاخص + clamp؛ رد پیش از persist |
| ED-130 | هر استنتاج → یک `AIInferenceLog` با provenance کامل (منبع پایش/هزینه) |
| ED-131 | `statusKey` در MachineDef — رفع B-11-1 (بازبینی AI از فاز ۰۲ بی‌صدا dead بود) |
| ED-132 | ارزیابی فقط جفت‌های دارای ground-truth واقعی؛ لیبل توافق = fallback صادقانه |
| ED-133 | EmbeddingProvider پورت با استب Hash (آمادهٔ تعویض، بیرون از مسیر بالینی) |
| ED-134 | شکست انتقال بازبینی AI در SUBMIT_ASSESSMENT = FATAL (نه بی‌صدا) |

---

## 12. بدهی‌ها (Debt — صادقانه)

| ID | شرح |
|----|-----|
| D-11-1 | UI اصلاح per-indicator برای Expert 1 (فیلد `aiCorrections` در DTO/سرویس/تست موجود؛ فقط فرم UI مانده — فاز ۰۹) |
| D-11-2 | `AI_DATASET_HASH_SALT` باید در پروداکشن از env ست شود (پیش‌فرض dev) |
| D-11-3 | رکورد InferenceLog نگهداری-نشده (retention) — بعد از فاز Deployment |
| D-11-4 | drift baseline پس از تعویض مدل دستی refresh می‌شود (auto در اولین monitor tick اگر NO_BASELINE) |
| D-11-5 | ارزیابی v1 روی لیبل‌های توافق درصدهای پایین می‌دهد (صادقانه) — با ورود corrections UI دقیق می‌شود |
| D-11-6 | آموزش واقعی/ریترین خارج از scope — همهٔ زیرساخت (گیت، دیتاست FROZEN، ارزیابی) آماده |

---

## 13. Runbook عملیاتی

```bash
# ارزیابی مدل فعال روی آخرین دیتاست فریز‌شده (یا includeDraft برای دود)
POST /api/v1/admin/ai/evaluate  {"includeDraft": true}

# فریز دیتاست جاری (پیش‌نویس جدید باز می‌شود)
POST /api/v1/admin/ai/datasets  {"action":"freeze"}

# استنتاج مجدد یک پرونده (تاریخچه حفظ می‌شود)
POST /api/v1/cases/{id}/rerun-ai

# تعویض مدل (بدون تغییر کد):
#   1. رکورد AIModel جدید (version+1, provider='TongueModelV2', approvalStatus='EVALUATION')
#   2. ارزیابی → APPROVED → isActive=true (رکورد قبلی false)
#   3. اولین monitor tick خط پایهٔ drift را تازه می‌کند

# پایش: GET /api/v1/admin/ai/overview  → monitoring/cost/drift/reports
```

---

## 14. پوشش مستندات مرتبط

- PRD §12 — ردیف فاز ۱۱
- BUSINESS-RULES.md — ED-120..ED-134
- REQUIREMENTS-TRACEABILITY-MATRIX.md — یادداشت فاز ۱۱ + بازه ED-01..ED-134
- ARCHITECTURE.md §3 — وضعیت AI Service (in-process → آمادهٔ استخراج ADR-0007)
- FILE-MEDIA.md — تحویل تصویر به AI (پل فاز ۱۰)
