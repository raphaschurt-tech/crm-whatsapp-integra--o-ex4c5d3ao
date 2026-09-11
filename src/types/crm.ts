import { RecordModel } from 'pocketbase'

export interface User extends RecordModel {
  name?: string
  email: string
  role?: 'admin' | 'colaborador'
  phone?: string
  avatar?: string
  blocked?: boolean
}

export type CustomerType = 'PF' | 'PJ'

export type EntityCustomerType = 'cliente' | 'fornecedor'

export type LeadSource = 'whatsapp' | 'instagram' | 'google' | 'other'

export interface Customer extends RecordModel {
  name: string
  contact_name?: string
  phone: string
  email?: string
  company?: string
  notes?: string
  type?: CustomerType
  customer_type?: EntityCustomerType
  cpf?: string
  cnpj?: string
  pipeline_status?: string
  lead_source?: LeadSource
  deleted?: boolean
  deleted_at?: string
}

export type ProductType = 'comprado' | 'produzido'

export interface Product extends RecordModel {
  name: string
  sku: string
  description?: string
  price: number
  cost?: number
  stock_quantity: number
  min_stock?: number
  external_id?: string
  product_type?: ProductType
  supplier?: string
  is_purchased?: boolean
  is_produced?: boolean
  is_component?: boolean
}

export interface ItemFamily extends RecordModel {
  name: string
  description?: string
  products?: string[]
  expand?: {
    products?: Product[]
  }
}

export interface ProductComposition extends RecordModel {
  product: string
  family: string
  allowed_products?: string[]
  required?: boolean
  expand?: {
    product?: Product
    family?: ItemFamily
    allowed_products?: Product[]
  }
}

export type ProductionOrderStatus = 'aberta' | 'em_producao' | 'concluida' | 'cancelada'

export interface SelectedProductionItem {
  family_id: string
  family_name: string
  product_id: string
  product_name: string
  sku: string
  unit_cost: number
  quantity_used: number
  total_cost: number
  is_produced?: boolean
  stock_available?: number
}

export interface ProductionOrder extends RecordModel {
  code: string
  product: string
  quantity: number
  status: ProductionOrderStatus
  total_cost?: number
  unit_cost?: number
  selected_items?: SelectedProductionItem[]
  notes?: string
  completed_at?: string
  expand?: {
    product?: Product
  }
}

export type QuoteStatus = 'rascunho' | 'enviado' | 'aprovado' | 'rejeitado' | 'pago'

export interface Quote extends RecordModel {
  number: string
  customer: string
  expand?: {
    customer?: Customer
  }
  status: QuoteStatus
  subtotal: number
  discount: number
  total: number
  notes?: string
  payment_link?: string
  payment_token?: string
}

export interface QuoteItem extends RecordModel {
  quote: string
  product: string
  expand?: {
    product?: Product
  }
  quantity: number
  unit_price: number
  total: number
}

export type PaymentMethod = 'pix' | 'cartao' | 'boleto' | 'dinheiro' | 'outros'
export type PaymentStatus = 'pendente' | 'aprovado'

export interface Payment extends RecordModel {
  quote: string
  expand?: {
    quote?: Quote
  }
  amount: number
  method: PaymentMethod
  status: PaymentStatus
  paid_at?: string
  receipt?: string
}

export interface Settings extends RecordModel {
  whatsapp_number?: string
  stock_api_url?: string
  payment_link_template?: string
  ai_enabled?: boolean
  authorized_test_phone?: string
  ai_model?: string
  openai_api_key?: string
  zapi_instance_id?: string
  zapi_token?: string
  zapi_client_token?: string
  ai_system_prompt?: string
}

export type MessageProcessingStatus = 'received' | 'processing' | 'completed' | 'failed'

export interface MessageProcessingRecord extends RecordModel {
  messageId: string
  phone: string
  status: MessageProcessingStatus
  replySent?: boolean
  incomingText?: string
  aiReplyText?: string
  aiModel?: string
  zapiStatus?: number
  errorMessage?: string
  retryCount?: number
}
