import type { AppSettings } from './types'

export const DEFAULT_SETTINGS: AppSettings = {
  minImages: 1,
  maxImages: 10,
  defaultAdDays: 0,
  dailyRevealLimit: 20,
  trackViews: true,
  unitTypes: [
    { id: 'apartment', label: 'شقة', plural: 'شقق' },
    { id: 'studio', label: 'استوديو', plural: 'استوديوهات' },
    { id: 'room', label: 'غرفة', plural: 'غرف' },
    { id: 'villa', label: 'فيلا', plural: 'فيلل' },
    { id: 'floor', label: 'دور', plural: 'أدوار' },
    { id: 'commercial', label: 'محل / مكتب', plural: 'محلات ومكاتب' },
  ],
  amenities: [
    { id: 'elevator', label: 'مصعد' },
    { id: 'parking', label: 'جراج' },
    { id: 'ac', label: 'تكييف' },
    { id: 'internet', label: 'إنترنت' },
    { id: 'gas', label: 'غاز طبيعي' },
    { id: 'security', label: 'أمن / حارس' },
    { id: 'balcony', label: 'بلكونة' },
    { id: 'water-heater', label: 'سخان' },
  ],
}
