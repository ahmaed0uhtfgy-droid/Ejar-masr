import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { ar } from '../i18n/ar'
import { rt } from '../i18n/rent'
import { useAuth } from '../contexts/AuthContext'
import { ThemeToggle } from './ThemeToggle'
import { ConfigNotice } from './ui'
import { usePolicy } from '../lib/rentals'
import { Logo } from './Logo'

const linkCls = ({ isActive }: { isActive: boolean }) => `rounded-field px-3 py-2 hover:bg-line/60 ${isActive ? 'font-semibold text-nile' : ''}`

export function Layout() {
  const policy = usePolicy()
  const { user, profile, isAdmin, banned, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <div className="flex min-h-screen flex-col">
      <ConfigNotice />
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5 font-display text-xl font-bold text-ink" onClick={close}><Logo size={38} uid="hdr" />{ar.brand}</Link>
          <nav className="ms-4 hidden items-center gap-1 md:flex" aria-label="التنقل الرئيسي">
            <NavLink to="/search" className={linkCls}>{ar.nav.search}</NavLink>
            <NavLink to="/compare" className={linkCls}>{ar.nav.compare}</NavLink>
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <ThemeToggle />
            <Link to="/dashboard/new" className="btn-primary hidden sm:inline-flex">{ar.nav.add}</Link>
            {user ? (
              <div className="hidden items-center gap-1 md:flex">
                <NavLink to="/account" className={linkCls}>{profile?.displayName ?? ar.nav.account}</NavLink>
                <NavLink to="/rentals" className={linkCls}>{rt.nav}</NavLink>
                <NavLink to="/dashboard" className={linkCls}>{ar.nav.dashboard}</NavLink>
                {isAdmin && <NavLink to="/admin" className={linkCls}>{ar.nav.admin}</NavLink>}
                {isAdmin && <NavLink to="/admin/payments" className={linkCls}>{rt.adminPayments}</NavLink>}
                <button type="button" className="btn-ghost" onClick={() => void signOut()}>{ar.nav.logout}</button>
              </div>
            ) : (
              <Link to="/login" className="btn-ghost hidden md:inline-flex">{ar.nav.login}</Link>
            )}
            <button type="button" className="btn-ghost md:hidden" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}>{ar.nav.menu}</button>
          </div>
        </div>
        {open && (
          <nav id="mobile-nav" className="flex flex-col gap-1 border-t border-line px-4 py-3 md:hidden" aria-label="القائمة">
            <NavLink to="/search" className={linkCls} onClick={close}>{ar.nav.search}</NavLink>
            <NavLink to="/dashboard/new" className={linkCls} onClick={close}>{ar.nav.add}</NavLink>
            <NavLink to="/compare" className={linkCls} onClick={close}>{ar.nav.compare}</NavLink>
            {user ? (
              <>
                <NavLink to="/account" className={linkCls} onClick={close}>{ar.nav.account}</NavLink>
                <NavLink to="/rentals" className={linkCls} onClick={close}>{rt.nav}</NavLink>
                <NavLink to="/dashboard" className={linkCls} onClick={close}>{ar.nav.dashboard}</NavLink>
                {isAdmin && <NavLink to="/admin" className={linkCls} onClick={close}>{ar.nav.admin}</NavLink>}
                {isAdmin && <NavLink to="/admin/payments" className={linkCls} onClick={close}>{rt.adminPayments}</NavLink>}
                <button type="button" className="rounded-field px-3 py-2 text-start hover:bg-line/60" onClick={() => { close(); void signOut() }}>{ar.nav.logout}</button>
              </>
            ) : (
              <NavLink to="/login" className={linkCls} onClick={close}>{ar.nav.login}</NavLink>
            )}
          </nav>
        )}
      </header>
      {banned && <div className="bg-danger px-4 py-2 text-center text-sm text-white dark:text-paper" role="alert">{ar.auth.banned}</div>}
      <main className="flex-1"><Outlet /></main>
      <footer className="mt-16 border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-mute">
          <Link to="/" className="flex w-fit items-center gap-2.5 font-display text-lg font-bold text-ink"><Logo size={34} uid="ftr" />{ar.brand}</Link>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="روابط الموقع">
            <Link to="/about">{ar.footer.about}</Link>
            <Link to="/terms">{ar.footer.terms}</Link>
            {policy?.visible !== false && <Link to="/payments-policy">سياسة الإيجار والدفع</Link>}
            <Link to="/privacy">{ar.footer.privacy}</Link>
            <Link to="/safety">{ar.footer.safety}</Link>
            <Link to="/contact">{ar.footer.contact}</Link>
          </nav>
          <p>{ar.footer.disclaimer}</p>
          <p>© {new Date().getFullYear()} {ar.footer.rights}</p>
        </div>
      </footer>
    </div>
  )
}
