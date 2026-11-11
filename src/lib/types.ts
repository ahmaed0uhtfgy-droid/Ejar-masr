export type Role = 'user' | 'admin'
export type AccountType = 'owner' | 'broker'
export type RentType = 'monthly' | 'daily'
export type UnitStatus = 'active' | 'hidden' | 'rented' | 'removed'
export type DepositMode = 'none' | 'held-claim' | 'held-auto'
export type Audience = 'all' | 'families' | 'singles'
export type ReportStatus = 'new' | 'review' | 'done'

export interface UserDoc {
  uid: string
  displayName: string
  email: string
  role: Role
  accountType: AccountType
  banned: boolean
  verified: boolean
  createdAt: Date | null
}

export interface Option { id: string; label: string; plural?: string }

export interface AppSettings {
  minImages: number
  maxImages: number
  defaultAdDays: number // 0 = no automatic expiry
  dailyRevealLimit: number
  trackViews: boolean
  unitTypes: Option[]
  amenities: Option[]
}

export interface Unit {
  id: string
  title: string
  description: string
  typeId: string
  typeName: string
  rentType: RentType
  price: number
  deposit: number | null
  governorateId: string
  governorateName: string
  areaId: string
  areaName: string
  localityId: string | null
  localityName: string
  address: string
  lat: number | null
  lng: number | null
  rooms: number
  bathrooms: number
  area: number
  floor: number
  furnished: boolean
  amenities: string[]
  studentHousing: boolean
  audience: Audience
  images: string[]
  ownerId: string
  ownerName: string
  ownerType: AccountType
  ownerVerified: boolean
  status: UnitStatus
  hiddenByAdmin: boolean
  durationMode: 'default' | 'custom'
  depositMode: DepositMode
  lockedUntil: Date | null
  rentedUntil: string | null
  createdAt: Date | null
  expiresAt: Date | null
}

export interface LocItem {
  id: string
  level: 1 | 2 | 3
  parentId: string | null
  name: string
  deleted?: boolean
}

export interface SearchFilters {
  governorateId?: string
  areaId?: string
  typeId?: string
  rentType?: RentType
  priceMin?: number
  priceMax?: number
  roomsMin?: number
  bathroomsMin?: number
  areaMin?: number
  furnished?: 'yes' | 'no'
  amenities?: string[]
  student?: boolean
  audience?: Audience
  ownerType?: AccountType
}
export type SortKey = 'newest' | 'priceAsc' | 'priceDesc'

export interface AppNotification {
  id: string
  type: 'duration' | 'saved-search' | 'report' | 'system'
  title: string
  body: string
  unitId: string | null
  read: boolean
  createdAt: Date | null
}

export interface ReportDoc {
  id: string
  unitId: string
  unitTitle: string
  reporterId: string
  reason: string
  note: string
  status: ReportStatus
  createdAt: Date | null
}

export type LeaseStatus = 'requested' | 'active' | 'rejected' | 'cancelled' | 'ended'
export type PaymentStatus = 'due' | 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded'
export type PayoutStatus = 'none' | 'held' | 'pending' | 'paid' | 'cancelled'
export type DepositStatus = 'none' | 'unpaid' | 'held' | 'claimed' | 'disputed' | 'settled'

export interface Lease {
  id: string; unitId: string; unitTitle: string
  ownerId: string; ownerName: string; tenantId: string; tenantName: string; tenantPhone: string; note: string
  rentType: RentType; price: number; startDate: string; endDate: string
  durationMonths: number | null; cycleMonths: number | null; days: number | null
  total: number; installments: number; status: LeaseStatus; createdAt: Date | null
  reminderDays: number | null; firstPaidAt: Date | null; moveInConfirmedAt: Date | null; moveInIssue: boolean; endedAt: Date | null
  depositMode: DepositMode; depositCents: number; depositStatus: DepositStatus; depositClaimUntil: string; claimCents: number; claimReason: string
  feePayer: 'owner' | 'tenant' | 'split'; cancelRequestedAt: Date | null; policyVersion: string
  contractOwnerAt: Date | null; contractTenantAt: Date | null; contractConfirmedAt: Date | null
  depositToOwnerCents: number; depositToTenantCents: number; depositTransfer: 'pending' | 'done' | ''; depositRef: string
}

export interface Payment {
  id: string; leaseId: string; index: number; unitId: string; ownerId: string; tenantId: string
  amount: number; depositCents: number; tenantFeeCents: number; refundCents: number; feeCents: number; netCents: number; from: string; to: string; dueDate: string
  status: PaymentStatus; payoutStatus: PayoutStatus; paidAt: Date | null; payoutAt: Date | null; payoutRef: string
}
