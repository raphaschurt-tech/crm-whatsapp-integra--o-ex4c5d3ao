/* Main App Component - Handles routing (using react-router-dom), query client and other providers - use this file to add all routes */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/hooks/use-auth'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import Layout from '@/components/Layout'

// Pages
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import PipelineBoard from '@/pages/Pipeline/PipelineBoard'
import WhatsAppAtendimento from '@/pages/WhatsApp/Atendimento'
import QuoteList from '@/pages/Quotes/QuoteList'
import QuoteForm from '@/pages/Quotes/QuoteForm'
import QuoteDetail from '@/pages/Quotes/QuoteDetail'
import CustomerList from '@/pages/Customers/CustomerList'
import CustomerForm from '@/pages/Customers/CustomerForm'
import CustomerDetail from '@/pages/Customers/CustomerDetail'
import ProductList from '@/pages/Stock/ProductList'
import ProductForm from '@/pages/Stock/ProductForm'
import ProductDetail from '@/pages/Stock/ProductDetail'
import UserList from '@/pages/Users/UserList'
import SettingsPage from '@/pages/Settings/SettingsPage'
import PaymentPage from '@/pages/Payment/PaymentPage'
import NotFound from '@/pages/NotFound'

const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Routes>
          {/* Rota pública: Login */}
          <Route path="/login" element={<Login />} />

          {/* Rota pública: Checkout / Pagamento do Orçamento para clientes */}
          <Route path="/pagamento/:id" element={<PaymentPage />} />

          {/* Rotas protegidas (exigem autenticação e utilizam o Layout) */}
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              {/* Pipeline de Vendas */}
              <Route path="/pipeline" element={<PipelineBoard />} />
              {/* Atendimento WhatsApp */}
              <Route path="/atendimento" element={<WhatsAppAtendimento />} />
              {/* Orçamentos */}
              <Route path="/orcamentos" element={<QuoteList />} />
              <Route path="/orcamentos/novo" element={<QuoteForm />} />
              <Route path="/orcamentos/:id" element={<QuoteDetail />} />
              <Route path="/orcamentos/:id/editar" element={<QuoteForm />} />
              {/* Clientes */}
              <Route path="/clientes" element={<CustomerList />} />
              <Route path="/clientes/novo" element={<CustomerForm />} />
              <Route path="/clientes/:id" element={<CustomerDetail />} />
              <Route path="/clientes/:id/editar" element={<CustomerForm />} />
              {/* Gestão de Usuários (Admin) */}
              <Route element={<ProtectedRoute adminOnly />}>
                <Route path="/usuarios" element={<UserList />} />
              </Route>
              {/* Estoque / Produtos */}
              <Route path="/estoque" element={<ProductList />} />
              <Route path="/estoque/novo" element={<ProductForm />} />
              <Route path="/estoque/:id" element={<ProductDetail />} />
              <Route path="/estoque/:id/editar" element={<ProductForm />} />
              {/* Configurações (Admin) */}
              <Route element={<ProtectedRoute adminOnly />}>
                <Route path="/configuracoes" element={<SettingsPage />} />
              </Route>{' '}
            </Route>
          </Route>

          {/* Fallback 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </TooltipProvider>
    </AuthProvider>
  </BrowserRouter>
)

export default App
