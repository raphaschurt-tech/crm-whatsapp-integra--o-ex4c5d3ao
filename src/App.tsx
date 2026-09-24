import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './hooks/use-auth'
import { TabsProvider } from './contexts/TabsContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import CustomerList from './pages/Customers/CustomerList'
import CustomerForm from './pages/Customers/CustomerForm'
import CustomerDetail from './pages/Customers/CustomerDetail'
import PipelineBoard from './pages/Pipeline/PipelineBoard'
import QuoteList from './pages/Quotes/QuoteList'
import QuoteForm from './pages/Quotes/QuoteForm'
import QuoteDetail from './pages/Quotes/QuoteDetail'
import OrderList from './pages/Orders/OrderList'
import ProductList from './pages/Stock/ProductList'
import ProductForm from './pages/Stock/ProductForm'
import ProductDetail from './pages/Stock/ProductDetail'
import FamilyList from './pages/Stock/FamilyList'
import PipelineCompras from './pages/PipelineCompras/PipelineCompras'
import Atendimento from './pages/WhatsApp/Atendimento'
import UserList from './pages/Users/UserList'
import SettingsPage from './pages/Settings/SettingsPage'
import PaymentPage from './pages/Payment/PaymentPage'
import ProductionOrderList from './pages/Stock/ProductionOrderList'
import NotFound from './pages/NotFound'
import ErrorBoundary from './components/ErrorBoundary'

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <TabsProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/pagamento/:id" element={<PaymentPage />} />

              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="clientes" element={<CustomerList />} />
                <Route path="clientes/novo" element={<CustomerForm />} />
                <Route path="clientes/:id" element={<CustomerDetail />} />
                <Route path="clientes/:id/editar" element={<CustomerForm />} />
                <Route path="funil" element={<PipelineBoard />} />
                <Route path="orcamentos" element={<QuoteList />} />
                <Route path="orcamentos/novo" element={<QuoteForm />} />
                <Route path="orcamentos/:id" element={<QuoteDetail />} />
                <Route path="orcamentos/:id/editar" element={<QuoteForm />} />
                <Route path="pedidos" element={<OrderList />} />
                <Route path="produtos" element={<ProductList />} />
                <Route path="produtos/novo" element={<ProductForm />} />
                <Route path="produtos/:id" element={<ProductDetail />} />
                <Route path="produtos/:id/editar" element={<ProductForm />} />
                <Route path="familias" element={<FamilyList />} />
                <Route path="ordens-producao" element={<ProductionOrderList />} />
                <Route path="pipeline-compras" element={<PipelineCompras />} />
                <Route path="whatsapp" element={null} />
                <Route path="usuarios" element={<UserList />} />
                <Route path="configuracoes" element={<SettingsPage />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </TabsProvider>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
