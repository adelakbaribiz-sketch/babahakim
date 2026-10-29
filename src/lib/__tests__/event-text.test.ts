// Timeline/recent-activity text: known system phrases localized, human text untouched.
import { describe, test, expect } from 'bun:test'
import { eventText } from '@/lib/event-text'
import { CASE_MACHINE } from '@/lib/workflow/machines/case'

describe('eventText', () => {
  test('every CASE transition description has an English rendering', () => {
    for (const t of CASE_MACHINE.transitions) {
      expect(eventText(t.descFa, 'en')).not.toBe(t.descFa)
    }
  })
  test('templated system phrases keep their dynamic parts', () => {
    expect(eventText('تحلیل اولیه توسط TongueModelV1@v1 انجام شد', 'en')).toBe('Initial AI analysis by TongueModelV1@v1')
    expect(eventText('برگشت به کارشناس اول — دوز نامشخص', 'en')).toBe('Returned to Expert 1 — دوز نامشخص')
  })
  test('Persian mode and human-entered text are returned unchanged', () => {
    expect(eventText('کارشناس اول پرونده را دریافت کرد', 'fa')).toBe('کارشناس اول پرونده را دریافت کرد')
    expect(eventText('Please confirm the dose', 'en')).toBe('Please confirm the dose')
    expect(eventText(null, 'en')).toBe('')
  })
})
