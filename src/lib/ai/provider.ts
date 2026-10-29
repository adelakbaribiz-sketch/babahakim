// AI Model Provider abstraction — swappable inference engines
// Design: AI → suggestion only. Human (Expert1 → Expert2 → Doctor) makes the final decision.
import { TongueFeatures, extractTongueFeatures, QualityReport } from '@/lib/storage'

export interface IndicatorPrediction {
  indicator: string // stable code
  labelFa: string
  labelEn: string
  value: string // human-readable value (Persian)
  valueEn?: string // English value (optional: analyses stored before 2026-10 lack it)
  confidence: number // 0..1
  noteFa: string
  noteEn: string
}

export interface AIResult {
  provider: string
  model: string
  version: number
  predictions: IndicatorPrediction[]
  confidence: number // overall
  quality: number
  explainability: { fa: string[]; en: string[] }
  features: TongueFeatures
  processingMs: number
  disclaimerFa: string
  disclaimerEn: string
}

export interface AIModelProvider {
  name: string
  version: number
  analyze(aiImagePath: string, quality: QualityReport): Promise<AIResult>
}

// ── TongueModelV1: rule-based interpretable mapping of extracted features ──
// to Traditional Persian Medicine indicators. Deterministic & explainable.
export class TongueModelV1 implements AIModelProvider {
  name = 'TongueModelV1'
  version = 1

  async analyze(aiImagePath: string, quality: QualityReport): Promise<AIResult> {
    const t0 = Date.now()
    const f = await extractTongueFeatures(aiImagePath)
    const preds: IndicatorPrediction[] = []
    const qFactor = quality.score / 100 // low quality → dampen confidence

    // 1. Tongue body color (رنگ زبان)
    let bodyColor = 'NORMAL'
    let bodyConf = 0.72
    if (f.redness > 0.62) { bodyColor = 'RED'; bodyConf = Math.min(0.95, 0.65 + f.redness * 0.3) }
    else if (f.pallor > 0.55) { bodyColor = 'PALE'; bodyConf = Math.min(0.92, 0.6 + f.pallor * 0.3) }
    else if (f.purpleIndex > 0.5) { bodyColor = 'PURPLE'; bodyConf = Math.min(0.85, 0.55 + f.purpleIndex * 0.35) }
    const bodyLabels: Record<string, [string, string, string, string]> = {
      RED: ['قرمز', 'Red', 'نشانه غلبه صفرا یا حرارت در بدن (مزاج گرم)', 'May indicate bile (safra) dominance or internal heat (warm temperament)'],
      PALE: ['کم‌رنگ', 'Pale', 'نشانه احتمالی کم‌خونی یا غلبه بلغم (مزاج سرد)', 'Possible sign of low blood or phlegm (balgham) dominance (cold temperament)'],
      PURPLE: ['بنفش/کبود', 'Purple', 'نشانه احتمالی غلبه سودا یا اختلاف گردش خون', 'Possible sign of black-bile (sauda) dominance or a circulation issue'],
      NORMAL: ['طبیعی', 'Normal', 'رنگ زبان در محدوده طبیعی مشاهده می‌شود', 'Tongue colour appears within the normal range'],
    }
    preds.push({
      indicator: 'BODY_COLOR', labelFa: 'رنگ بدنه زبان', labelEn: 'Tongue Body Color',
      value: bodyLabels[bodyColor][0], valueEn: bodyLabels[bodyColor][1], confidence: +(bodyConf * qFactor).toFixed(2),
      noteFa: bodyLabels[bodyColor][2], noteEn: bodyLabels[bodyColor][3],
    })

    // 2. Coating (پوشش زبان)
    let coating = 'THIN_NORMAL', coatConf = 0.6
    if (f.coatingWhite > 0.55) { coating = 'THICK_WHITE'; coatConf = Math.min(0.93, 0.62 + f.coatingWhite * 0.3) }
    else if (f.coatingYellow > 0.45) { coating = 'YELLOW'; coatConf = Math.min(0.9, 0.58 + f.coatingYellow * 0.32) }
    else if (f.coatingWhite > 0.3) { coating = 'WHITE'; coatConf = 0.66 }
    const coatLabels: Record<string, [string, string]> = {
      THIN_NORMAL: ['طبیعی/نازک', 'Thin/Normal'],
      WHITE: ['سفید مایل به غلیظ', 'Whitish'],
      THICK_WHITE: ['سفید غلیظ', 'Thick White'],
      YELLOW: ['زرد', 'Yellow'],
    }
    preds.push({
      indicator: 'COATING', labelFa: 'پوشش زبان', labelEn: 'Tongue Coating',
      value: coatLabels[coating][0], valueEn: coatLabels[coating][1], confidence: +(coatConf * qFactor).toFixed(2),
      noteFa: coating === 'YELLOW' ? 'پوشش زرد غالباً با حرارت معده/صفرا مرتبط است' : coating === 'THICK_WHITE' ? 'پوشش سفید غلیظ معمولاً نشانه غلبه بلغم و ضعف گوارش است' : 'پوشش در محدوده طبیعی است',
      noteEn: coating === 'YELLOW' ? 'A yellow coating is often associated with stomach/bile heat' : coating === 'THICK_WHITE' ? 'A thick white coating usually suggests phlegm dominance and weak digestion' : 'Coating within the normal range',
    })

    // 3. Moisture (رطوبت — از روشنایی و بافت)
    const moisture = f.brightness > 155 ? 'WET' : f.textureRoughness > 0.5 ? 'DRY' : 'NORMAL'
    const moistureLabels: Record<string, [string, string]> = { WET: ['تر', 'Wet'], DRY: ['خشک', 'Dry'], NORMAL: ['معتدل', 'Moderate'] }
    preds.push({
      indicator: 'MOISTURE', labelFa: 'رطوبت زبان', labelEn: 'Moisture',
      value: moistureLabels[moisture][0], valueEn: moistureLabels[moisture][1],
      confidence: +(Math.min(0.8, 0.5 + Math.abs(f.brightness - 130) / 200) * qFactor).toFixed(2),
      noteFa: moisture === 'WET' ? 'رطوبت بالا معمولاً با غلبه رطوبت/بلغم مرتبط است' : moisture === 'DRY' ? 'خشکی زبان می‌تواند نشانه غلبه یبوست باشد' : 'رطوبت متعادل',
      noteEn: moisture === 'WET' ? 'High moisture is usually associated with dampness/phlegm dominance' : moisture === 'DRY' ? 'A dry tongue can indicate dryness (yubusat) dominance' : 'Balanced moisture',
    })

    // 4. Texture (بافت)
    preds.push({
      indicator: 'TEXTURE', labelFa: 'بافت زبان', labelEn: 'Texture',
      value: f.textureRoughness > 0.55 ? 'زبر/ناهموار' : f.textureRoughness < 0.25 ? 'صاف' : 'نسبتاً صاف',
      valueEn: f.textureRoughness > 0.55 ? 'Rough / uneven' : f.textureRoughness < 0.25 ? 'Smooth' : 'Fairly smooth',
      confidence: +(Math.min(0.75, 0.45 + f.textureRoughness) * qFactor).toFixed(2),
      noteFa: f.textureRoughness > 0.55 ? 'ناهمواری بافت ممکن است با تجمع ماده همراه باشد' : 'بافت یکنواخت است',
      noteEn: f.textureRoughness > 0.55 ? 'Uneven texture may accompany accumulated matter' : 'Texture is uniform',
    })

    // 5. Temperature estimate (حرارت غالب از ترکیب قرمزی/پوشش)
    const heatScore = f.redness * 0.5 + f.coatingYellow * 0.3 + (f.brightness > 150 ? 0.1 : 0)
    const coldScore = f.pallor * 0.5 + f.coatingWhite * 0.3 + (f.brightness < 110 ? 0.1 : 0)
    const dominant = heatScore > coldScore + 0.08 ? 'HOT' : coldScore > heatScore + 0.08 ? 'COLD' : 'BALANCED'
    preds.push({
      indicator: 'TEMPERAMENT_HINT', labelFa: 'برآورد اولیه مزاج (فقط پیشنهادی)', labelEn: 'Temperament Hint (suggestion only)',
      value: dominant === 'HOT' ? 'غلبه حرارت' : dominant === 'COLD' ? 'غلبه برودت' : 'نسبتاً معتدل',
      valueEn: dominant === 'HOT' ? 'Heat dominant' : dominant === 'COLD' ? 'Cold dominant' : 'Fairly balanced',
      confidence: +(Math.min(0.7, Math.abs(heatScore - coldScore) + 0.35) * qFactor).toFixed(2),
      noteFa: 'این برآورد صرفاً پیشنهاد مدل است و مزاج نهایی توسط پرسشنامه و ارزیابی کارشناس تعیین می‌شود',
      noteEn: 'Model suggestion only; final temperament is determined via questionnaire and expert review',
    })

    const confidence = +(preds.reduce((s, p) => s + p.confidence, 0) / preds.length).toFixed(2)

    return {
      provider: this.name, model: this.name, version: this.version,
      predictions: preds,
      confidence,
      quality: quality.score / 100,
      features: f,
      explainability: {
        fa: [
          `رنگ غالب تصویر: ${f.dominantHex}، میانگین RGB مرکز زبان: (${f.centerStats.r}, ${f.centerStats.g}, ${f.centerStats.b})`,
          `شاخص قرمزی ${(f.redness * 100).toFixed(0)}٪، کم‌رنگی ${(f.pallor * 100).toFixed(0)}٪، پوشش سفید ${(f.coatingWhite * 100).toFixed(0)}٪، پوشش زرد ${(f.coatingYellow * 100).toFixed(0)}٪`,
          `کیفیت تصویر ورودی: ${quality.score} از ۱۰۰ — در صورت کاهش کیفیت، اطمینان خروجی کاهش یافته است`,
          'خروجی مدل صرفاً پیشنهادی است و توسط کارشناس اول، کارشناس دوم و پزشک بازبینی می‌شود (AI-Assisted Clinical Decision Support).',
        ],
        en: [
          `Dominant color ${f.dominantHex}; tongue-center mean RGB (${f.centerStats.r}, ${f.centerStats.g}, ${f.centerStats.b})`,
          `Redness ${(f.redness * 100).toFixed(0)}%, pallor ${(f.pallor * 100).toFixed(0)}%, white coating ${(f.coatingWhite * 100).toFixed(0)}%, yellow coating ${(f.coatingYellow * 100).toFixed(0)}%`,
          `Input image quality: ${quality.score}/100 — low quality reduces output confidence`,
          'Model output is a suggestion only and is reviewed by Expert 1, Expert 2 and the doctor (AI-Assisted CDS).',
        ],
      },
      processingMs: Date.now() - t0,
      disclaimerFa: 'این تحلیل توسط هوش مصنوعی و به‌صورت «پیشنهاد کمکی» تولید شده است؛ تشخیص نهایی پس از بازبینی کارشناسان و تأیید پزشک اعلام می‌شود.',
      disclaimerEn: 'This AI analysis is an assistive suggestion only; final diagnosis is confirmed after expert review and doctor approval.',
    }
  }
}

// Registry — swap models here (TongueModelV2/V3 in future)
export function getActiveProvider(): AIModelProvider {
  return new TongueModelV1()
}
