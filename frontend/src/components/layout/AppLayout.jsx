import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../../auth/useAuth.js'

function NavItem({ to, label }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        [
          'flex items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition',
          isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
        ].join(' ')
      }
    >
      <span>{label}</span>
    </NavLink>
  )
}

export function AppLayout() {
  const { logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const pageTitle =
    location.pathname === '/'
      ? 'Dashboard'
      : location.pathname.startsWith('/products')
        ? 'Products'
        : location.pathname.startsWith('/bundles')
          ? 'Bundles'
          : location.pathname.startsWith('/announcement-banners')
            ? 'Top Banner'
          : location.pathname.startsWith('/cart-preview')
            ? 'Cart Preview'
          : location.pathname.startsWith('/media-platform')
            ? 'منصة الرفع'
            : 'Bundle Manager'

  const showNewBundlesTabs = location.pathname === '/' || location.pathname === '/bundles'
  const currentTab = String(searchParams.get('tab') || '').trim() === 'all' ? 'all' : 'new'

  function setTab(next) {
    const n = next === 'all' ? 'all' : 'new'
    const sp = new URLSearchParams(searchParams)
    sp.set('tab', n)
    setSearchParams(sp, { replace: true })
  }

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="flex h-16 items-center px-5 text-sm font-semibold text-slate-900">
          Bundle Manager
        </div>
        <nav className="px-3 pb-6">
          <div className="space-y-1">
            <NavItem to="/" label="Dashboard" />
            <NavItem to="/products" label="Products" />
            <NavItem to="/bundles" label="Bundles" />
            <NavItem to="/bundles?tab=new" label="New Bundels" />
            <NavItem to="/announcement-banners" label="Top Banner" />
            <NavItem to="/cart-preview" label="Cart Preview" />
            <NavItem to="/media-platform" label="منصة الرفع" />
          </div>
        </nav>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
            <div className="flex h-16 items-center justify-between px-5">
              <div className="text-sm font-semibold text-slate-900">Bundle Manager</div>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm hover:bg-slate-100"
                onClick={() => setMobileOpen(false)}
              >
                Close
              </button>
            </div>
            <nav className="px-3 pb-6" onClick={() => setMobileOpen(false)}>
              <div className="space-y-1">
                <NavItem to="/" label="Dashboard" />
                <NavItem to="/products" label="Products" />
                <NavItem to="/bundles" label="Bundles" />
                <NavItem to="/bundles?tab=new" label="New Bundels" />
                <NavItem to="/announcement-banners" label="Top Banner" />
                <NavItem to="/cart-preview" label="Cart Preview" />
                <NavItem to="/media-platform" label="منصة الرفع" />
              </div>
            </nav>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-sm hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileOpen(true)}
            >
              Menu
            </button>
            <div className="text-sm font-semibold text-slate-900">{pageTitle}</div>
            {showNewBundlesTabs ? (
              <div className="ml-2 flex items-center gap-2">
                <button
                  type="button"
                  className={[
                    'rounded-xl border px-3 py-2 text-sm font-semibold',
                    currentTab === 'new' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:bg-slate-50',
                  ].join(' ')}
                  onClick={() => setTab('new')}
                >
                  New Bundels
                </button>
                <button
                  type="button"
                  className={[
                    'rounded-xl border px-3 py-2 text-sm font-semibold',
                    currentTab === 'all' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:bg-slate-50',
                  ].join(' ')}
                  onClick={() => setTab('all')}
                >
                  All
                </button>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={logout}
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
