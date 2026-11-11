import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { RequireAuth } from './components/RequireAuth'
import { BackgroundChecks } from './components/BackgroundChecks'
import { useSettings } from './contexts/SettingsContext'
import { QuotaNotice, Spinner } from './components/ui'
import Home from './pages/Home'

const Search = lazy(() => import('./pages/Search'))
const UnitDetail = lazy(() => import('./pages/UnitDetail'))
const Auth = lazy(() => import('./pages/Auth'))
const Account = lazy(() => import('./pages/Account'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const UnitForm = lazy(() => import('./pages/UnitForm'))
const Compare = lazy(() => import('./pages/Compare'))
const Landing = lazy(() => import('./pages/Landing'))
const Admin = lazy(() => import('./pages/Admin'))
const PaymentsPolicy = lazy(() => import('./pages/PaymentsPolicy'))
const Rentals = lazy(() => import('./pages/Rentals'))
const PayResult = lazy(() => import('./pages/PayResult'))
const AdminPayments = lazy(() => import('./pages/AdminPayments'))
const StaticPage = lazy(() => import('./pages/StaticPage'))
const NotFound = lazy(() => import('./pages/NotFound'))

export default function App() {
  const { quotaExceeded } = useSettings()
  return (
    <>
      <BackgroundChecks />
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="search" element={<Search />} />
            <Route path="unit/:id" element={<UnitDetail />} />
            <Route path="login" element={<Auth />} />
            <Route path="compare" element={<Compare />} />
            <Route path="rent/:gov" element={<Landing />} />
            <Route path="rent/:gov/:type" element={<Landing />} />
            <Route path="account" element={<RequireAuth><Account /></RequireAuth>} />
            <Route path="dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="dashboard/new" element={<RequireAuth><UnitForm /></RequireAuth>} />
            <Route path="dashboard/units/:id/edit" element={<RequireAuth><UnitForm /></RequireAuth>} />
            <Route path="payments-policy" element={<PaymentsPolicy />} />
            <Route path="rentals" element={<RequireAuth><Rentals /></RequireAuth>} />
            <Route path="pay/result" element={<RequireAuth><PayResult /></RequireAuth>} />
            <Route path="admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
            <Route path="admin/payments" element={<RequireAuth admin><AdminPayments /></RequireAuth>} />
            {(['about', 'terms', 'privacy', 'safety', 'contact'] as const).map((p) => <Route key={p} path={p} element={<StaticPage page={p} />} />)}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
      {quotaExceeded && <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl p-4"><QuotaNotice /></div>}
    </>
  )
}
