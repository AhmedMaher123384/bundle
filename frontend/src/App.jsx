import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider.jsx'
import { useAuth } from './auth/useAuth.js'
import { ToastProvider } from './components/ToastProvider.jsx'
import { AppLayout } from './components/layout/AppLayout.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { DashboardPage } from './pages/DashboardPage.jsx'
import { ProductsPage } from './pages/ProductsPage.jsx'
import { BundlesPage } from './pages/BundlesPage.jsx'
import { BundleEditorPage } from './pages/BundleEditorPage.jsx'
import { CartPreviewPage } from './pages/CartPreviewPage.jsx'

function Protected({ children }) {
  const { token } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/:productId/bundles/new" element={<BundleEditorPage mode="create" />} />
        <Route path="bundles" element={<BundlesPage />} />
        <Route path="bundles/:id/edit" element={<BundleEditorPage mode="edit" />} />
        <Route path="cart-preview" element={<CartPreviewPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
