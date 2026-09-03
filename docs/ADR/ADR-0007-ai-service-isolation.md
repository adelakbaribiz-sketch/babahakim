# ADR-0007: جداسازی AI Service پشت Port (AIModelProvider)

| فیلد | مقدار |
|---|---|
| شماره | ADR-0007 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز تصمیم | PHASE 03 — System Architecture |
| معادل ED | ED-41 |
| اسناد مرتبط | `ARCHITECTURE.md §3, §12` · `ARCHITECTURE-DIAGRAM.md §6, §13` · `src/lib/ai/provider.ts` |

## Context

تحلیل تصویر زبان، هسته ارزش‌آفرین و سنگین‌ترین بار محاسباتی BabaHakim است. قید C3: باید بتواند مستقل (GPU) Scale شود بدون Deploy مجدد کل سیستم. اصل P1/P2: AI صرفاً CDS است و زنجیره انسانی الزمی پس از آن. وضعیت فعلی: `TongueModelV1` به‌صورت **در-پروسه (Node)** اجرا می‌شود — یک پیاده‌سازی واقعی استخراج feature از پیکسل‌ها با explainability، اما برای مدل‌های آینده (CNN/ViT با Torch) Node مناسب نیست. ریسک ثبت‌شده R6.

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| **A) AI در-پروسه همیشگی** | ساده؛ بدون شبکه | قید C3 نقض؛ مدل‌های Torch در Node نامعملیک؛ Release مدل = Release کل اپ |
| **B) AI به‌عنوان Service مستقل از روز اول + Port** | Scale/Release مستقل؛ اکوسیستم Python/Torch؛ کاندیدای Extraction اول | یک Deployable بیشتر (قابل قبول — قبلاً در ADR-0001 لحاظ شد) |
| **C) AI Serverless (Lambda/GF)** | Pay-per-use | GPU سرد؛ Cold-start؛ قفل Vendor |

## Decision

**AI یک Service مستقل (Python/FastAPI + Torch) در Container `ai` است و کد BabaHakim فقط از طریق Port `AIModelProvider` با آن کار می‌کند** — همان Interfaceای که از فاز 00 وجود دارد (`src/lib/ai/provider.ts`):

```ts
interface AIModelProvider {
  analyze(input: TongueImageInput): Promise<AIAnalysisResult>;
  healthCheck(): Promise<Health>;
  getModelVersion(): string;
}
```

- **دو Adapter:** `in-process` (TongueModelV1 فعلی — برای dev بدون Docker و برای دوره انتقال) و `http` (فراخوانی Service `ai`). انتخاب از Env (`AI_PROVIDER`).
- **قرارداد Service:** `POST /analyze` (idempotent با کلید caseId+imageId)، `GET /health`، `GET /model-info` — همه JSON با همان شکل explainability فعلی.
- **مسیر اجرا:** تحلیل همیشه از صف `ai.analyze` (ADR-0005) توسط worker اجرا می‌شود؛ web هرگز مستقیم تحلیل سنگین اجرا نمی‌کند.
- **موقعیت در معماری:** Context `ai` در T3 — وابسته به Medical Records و Identity؛ **هیچ Contextای به AI وابستگی قطعی ندارد** (ED-29: AI پیشنهاد است نه پیش‌نیاز).

## Consequences

**مثبت:**
- قید C3 برآورده: Node/GPU جدا، Release مدل مستقل، بدون تغییر کد مصرف‌کننده.
- مجموعه داده یادگیری (برچسب کارشناسان) در همان Service قابل توسعه (MLOps فاز 07+).

**منفی/هزینه:**
- یک Container و قرارداد API باید نگهداری شوند؛ Health-check و Circuit Breaker لازم است.
- در dev بدون Docker، Adapter in-process می‌ماند ⇒ دو مسیر باید هر دو تست شوند.

## Compliance

- تست Contract: هر دو Adapter باید خروجی هم‌شکل (schema یکسان explainability) بدهند.
- Health endpoint در `/api/health` تجمیع می‌شود؛ شکست AI در فاز بالینی مسیر را متوقف نمی‌کند (تست رفتاری ED-29).
- Circuit Breaker + Retry محدود با ثبت خطا در AIAnalysis (رفتار فعلی حفظ شود).
