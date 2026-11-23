export { DEFAULT_SETTINGS } from './defaultSettings'
import { DEFAULT_SITE_URL } from './brand'

export const REPORT_REASONS = [
  { id: 'unavailable', label: 'الوحدة غير متاحة' },
  { id: 'wrong-info', label: 'بيانات أو صور غير صحيحة' },
  { id: 'scam', label: 'شبهة نصب' },
  { id: 'duplicate', label: 'إعلان مكرر' },
  { id: 'other', label: 'سبب آخر' },
] as const

export const PAGE_SIZE = 12
export const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) ?? DEFAULT_SITE_URL
