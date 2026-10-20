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

export type EntityCustomerType = 'Cliente' | 'Fornecedor' | 'Ambos' | 'cliente' | 'fornecedor'

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
  lost_reason?: string
  lost_reason_detail?: string
  source?: string
  item_families?: string[]
  whatsapp_status?: 'novo' | 'em_atendimento' | 'resolvido' | string
  lead_viewed?: boolean
  first_message_at?: string
  last_interaction_at?: string
  expand?: {
    item_families?: ItemFamily[]
    [key: string]: any
  }
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
  price_110?: number
  price_130?: number
  reserved_quantity?: number
  location_1?: string
  location_2?: string
  location_3?: string
  brand?: string
  barcode?: string
  reduced_code?: string
  sou_family?: string
  is_active?: boolean
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
  purchase_request?: string
  expand?: {
    customer?: Customer
    purchase_request?: PurchaseRequest
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
  product?: string
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
  ai_payment_methods?: string
  ai_auto_close_minutes?: number
  ai_auto_close_message?: string
  ai_excluded_skus?: string
  allowed_families?: string[]
  sync_integrity_floor?: number
  chat_summaries_migrated?: boolean
  company_cnpj?: string
  family_margins?: Record<string, number>
  stock_phase?: 'souis_master' | 'crm_cutover'
  dfe_enabled?: boolean
  dfe_poll_interval_hours?: number
  dfe_worker_token?: string
  dfe_token_active?: boolean
  dfe_retroactive_days_default?: number
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

export type PurchaseRequestStatus =
  | 'solicitada'
  | 'cotacao'
  | 'aprovada'
  | 'pedido_emitido'
  | 'em_transito'
  | 'recebida'
  | 'entregue'

export interface PurchaseItem {
  part_name: string
  vehicle: string
  quantity: number
  supplier_id?: string
  supplier_name?: string
  supplier_ids?: string[]
  product_id?: string
  reduced_code?: string
  cost_price?: number
  sell_price?: number
}

export interface PurchaseRequest extends RecordModel {
  part_name?: string
  vehicle?: string
  items?: PurchaseItem[]
  os_number?: string
  customer: string
  supplier?: string
  quote?: string
  status: PurchaseRequestStatus
  cost_price?: number
  sell_price?: number
  delivery_days?: number
  received_at?: string
  is_completed?: boolean
  notes?: string
  created_by?: string
  expand?: {
    customer?: Customer
    supplier?: Customer
    created_by?: User
    quote?: Quote
    [key: string]: any
  }
}

export type OrderFinancialStatus = 'pendente' | 'pago'
export type OrderCommercialStatus = 'aberto' | 'cancelado'

export interface OrderItem extends RecordModel {
  order_id: string
  product_id: string
  sku?: string
  name: string
  unit_price: number
  quantity_ordered: number
  quantity_reserved: number
  line_total: number
  expand?: {
    product_id?: Product
    [key: string]: any
  }
}

export interface Order extends RecordModel {
  code: string
  quote_id: string
  client_name: string
  total: number
  financial_status: OrderFinancialStatus
  commercial_status: OrderCommercialStatus
  promised_delivery_date?: string
  responsible?: string
  expand?: {
    quote_id?: Quote
    responsible?: User
    items?: OrderItem[]
    [key: string]: any
  }
}

// ==========================================
// MÓDULO FINANCEIRO (FASE 1)
// ==========================================

export type FinancialCategoryType = 'despesa' | 'receita'
export type FinancialPaymentStatus = 'pendente' | 'pago' | 'cancelado'
export type AccountsPayableOrigin = 'manual' | 'nfe' | 'recorrente'
export type AccountsReceivableOrigin = 'manual' | 'orcamento' | 'recorrente'
export type FinancialPaymentMethod =
  | 'PIX'
  | 'boleto'
  | 'transferencia'
  | 'dinheiro'
  | 'cheque'
  | 'cartao'
  | 'outros'

export interface FinancialCategory extends RecordModel {
  name: string
  type: FinancialCategoryType
  description?: string
  color?: string
  is_active: boolean
}

export interface FinancialRecurringTemplate extends RecordModel {
  description: string
  category?: string
  value_type: 'fixo' | 'variavel'
  fixed_amount?: number
  due_day: number
  default_payment_method: FinancialPaymentMethod
  supplier?: string
  supplier_name?: string
  notes?: string
  is_active: boolean
  expand?: {
    category?: FinancialCategory
    supplier?: Customer
    [key: string]: any
  }
}

export interface AccountsPayable extends RecordModel {
  description: string
  category?: string
  supplier?: string
  supplier_name?: string
  amount: number
  due_date: string
  status: FinancialPaymentStatus
  origin: AccountsPayableOrigin
  nfe_access_key?: string
  nfe_record?: string
  recurring_template?: string
  recurring_competence?: string
  installment_number?: number
  total_installments?: number
  paid_at?: string
  payment_method?: FinancialPaymentMethod
  notes?: string
  attachment?: string
  created_by?: string
  expand?: {
    category?: FinancialCategory
    supplier?: Customer
    nfe_record?: NfeProcessed
    recurring_template?: FinancialRecurringTemplate
    created_by?: User
    [key: string]: any
  }
}

export interface AccountsReceivable extends RecordModel {
  description: string
  category?: string
  customer?: string
  customer_name?: string
  quote?: string
  amount: number
  due_date: string
  status: FinancialPaymentStatus
  origin: AccountsReceivableOrigin
  paid_at?: string
  payment_method?: FinancialPaymentMethod
  notes?: string
  attachment?: string
  created_by?: string
  expand?: {
    category?: FinancialCategory
    customer?: Customer
    quote?: Quote
    created_by?: User
    [key: string]: any
  }
}

export interface FinancialDashboardKpis {
  pendingPayablesAmount: number
  overduePayablesAmount: number
  overduePayablesCount: number
  dueNext7DaysAmount: number
  dueNext7DaysCount: number
  pendingReceivablesAmount: number
  monthInflows: number
  monthOutflows: number
  monthBalance: number
}

export type NfeProcessedStatus = 'processada' | 'pendente_reconciliacao' | 'erro'
export type NfeSouisStockStatus = 'pendente' | 'lancado' | 'nao_aplicavel'
export type NfePriceQueueItemType =
  | 'preco_sugerido'
  | 'reconciliacao_item'
  | 'ajuste_preco_existente'
  | 'excecao'

export interface NfeProcessed extends RecordModel {
  access_key: string
  nfe_number: string
  series?: string
  issue_date?: string
  supplier?: string
  supplier_cnpj?: string
  supplier_name?: string
  total_amount: number
  status: NfeProcessedStatus
  exception_reason?: string
  dest_cnpj?: string
  c_stat?: string
  prot_nfe?: string
  source_channel?: 'manual_upload' | 'whatsapp'
  souis_stock_status?: NfeSouisStockStatus
  souis_stock_launched_at?: string
  souis_stock_launched_by?: string
  items_count: number
  matched_items_count: number
  pending_items_count: number
  raw_items?: any
  xml_payload?: string
  expand?: {
    supplier?: Customer
    souis_stock_launched_by?: User
    [key: string]: any
  }
}

export interface NfePriceQueueItem extends RecordModel {
  nfe?: string
  access_key: string
  product?: string
  sku?: string
  supplier_code?: string
  description: string
  ncm?: string
  quantity: number
  unit_cost: number
  suggested_sell_price: number
  family?: string
  margin_factor?: number
  price_source_payload?: string
  item_type?: NfePriceQueueItemType
  raw_item_data?: any
  status: 'pendente' | 'aplicado' | 'ignorado'
  resolution_notes?: string
  resolved_by?: string
  expand?: {
    nfe?: NfeProcessed
    product?: Product
    resolved_by?: User
    [key: string]: any
  }
}

export interface NfeProductMapping extends RecordModel {
  supplier_cnpj: string
  supplier_name?: string
  supplier_code: string
  supplier_description?: string
  product: string
  product_sku: string
  product_name?: string
  confirmed_by?: string
  expand?: {
    product?: Product
    confirmed_by?: User
    [key: string]: any
  }
}

export interface DfePointerState extends RecordModel {
  ult_nsu: string
  max_nsu?: string
  is_initialized: boolean
  last_poll_at?: string
  last_success_at?: string
  last_error?: string
  consecutive_failures: number
  cert_cnpj?: string
  cert_valid_until?: string
  cert_days_remaining?: number
  worker_status: 'online' | 'offline' | 'error' | 'idle'
  cstat_last?: string
  is_running: boolean
}

export interface DfeHistoryItem extends RecordModel {
  access_key: string
  nsu: string
  schema?: string
  model?: string
  emitter_cnpj?: string
  emitter_name?: string
  issue_date?: string
  total_amount?: number
  nfe_number?: string
  document_type: 'resumo' | 'nfe_completa' | 'evento' | 'outro'
  is_backlog: boolean
  imported_to_crm?: boolean
  raw_xml?: string
}

export interface DfeEventRecord extends RecordModel {
  access_key: string
  nsu?: string
  event_type: string
  event_desc?: string
  event_seq?: number
  event_date?: string
  protocol?: string
  justification?: string
  correction_text?: string
  nfe_found_in_crm: boolean
  accounts_payable_marked: boolean
  raw_xml?: string
}

export interface DfeCommandRecord extends RecordModel {
  command: 'consultar_agora' | 'importacao_retroativa' | 'reset_ponteiro'
  params?: any
  status: 'pendente' | 'em_execucao' | 'concluido' | 'erro'
  result_summary?: string
  created_by?: string
  executed_at?: string
}
