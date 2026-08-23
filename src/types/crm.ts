import { RecordModel } from 'pocketbase'

export interface User extends RecordModel {
  name?: string
  email: string
  role?: 'admin' | 'colaborador'
  phone?: string
  avatar?: string
  blocked?: boolean
}

export interface Customer extends RecordModel {
  name: string
  phone: string
  email?: string
  company?: string
  notes?: string
}

export interface Product extends RecordModel {
  name: string
  sku: string
  description?: string
  price: number
  cost?: number
  stock_quantity: number
  min_stock?: number
  external_id?: string
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
  openai_api_key?: string
  zapi_instance_id?: string
  zapi_token?: string
  zapi_client_token?: string
  ai_system_prompt?: string
}
