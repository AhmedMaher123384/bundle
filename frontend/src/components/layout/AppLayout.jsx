import { NavLink, Outlet, useLocation } from 'react-router-dom'
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
            <NavItem to="/cart-preview" label="Cart Preview" />
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
                <NavItem to="/cart-preview" label="Cart Preview" />
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
            <div className="text-sm font-semibold text-slate-900">
              {location.pathname === '/'
                ? 'Dashboard'
                : location.pathname.startsWith('/products')
                  ? 'Products'
                  : location.pathname.startsWith('/bundles')
                    ? 'Bundles'
                    : location.pathname.startsWith('/cart-preview')
                      ? 'Cart Preview'
                      : 'Bundle Manager'}
            </div>
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
