import { Suspense, lazy } from 'react'
import { ar } from '../i18n/ar'
import { useSettings } from '../contexts/SettingsContext'
import { usePageMeta } from '../lib/seo'
import { Spinner } from '../components/ui'
import { HomeClassic } from './home/HomeClassic'
import { useHomeData } from './home/useHomeData'

// The royal design is only downloaded when the admin has switched the site to it.
const HomeRoyal = lazy(() => import('./home/HomeRoyal').then((m) => ({ default: m.HomeRoyal })))

/** Home page: the admin's chosen design (Admin > المظهر) decides the layout; the data, text and links are the same in both. */
export default function Home() {
  usePageMeta({ title: ar.home.title, description: ar.home.description, path: '/' })
  const data = useHomeData()
  const { design } = useSettings()
  if (design === 'royal') return <Suspense fallback={<Spinner />}><HomeRoyal {...data} /></Suspense>
  return <HomeClassic {...data} />
}
