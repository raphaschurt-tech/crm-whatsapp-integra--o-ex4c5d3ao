// ==============================================================================
// BACKUP E AUDITORIA PRÉ-MIGRAÇÃO — FASE 2 CONTATOS UNIFICADOS
// Data da captura: 2026-10-31
// Protocolo de Âncora 🟡: BACKUP PRIMEIRO executado antes de qualquer alteração
// ==============================================================================

export interface BackupMetadata {
  timestamp: string
  totalCustomers: number
  activeCustomers: number
  deletedCustomers: number
  duplicateReport: Array<{
    type: 'phone' | 'document' | 'name'
    key: string
    reason: string
    records: Array<{
      id: string
      name: string
      phone: string
      cpf?: string
      cnpj?: string
      deleted: boolean
      customer_type?: string
      pipeline_status?: string
    }>
  }>
}

export const PRE_MIGRATION_BACKUP_SUMMARY: BackupMetadata = {
  timestamp: '2026-10-31T00:00:00.000Z',
  totalCustomers: 122,
  activeCustomers: 111,
  deletedCustomers: 11,
  duplicateReport: [
    {
      type: 'phone',
      key: '11963970333',
      reason:
        'Mesmo telefone 11963970333 em dois registros (um ativo, um deleted). Sinalizado para revisão humana; nunca fundir automaticamente.',
      records: [
        {
          id: '7l62hjo397ratjv',
          name: 'Natalia Schurt',
          phone: '11963970333',
          deleted: true,
          customer_type: 'Cliente',
          pipeline_status: 'perdido',
        },
        {
          id: 'plhfhbjufsp8sfb',
          name: 'Natalia',
          phone: '11963970333',
          deleted: false,
          customer_type: 'Cliente',
          pipeline_status: 'perdido',
        },
      ],
    },
    {
      type: 'phone',
      key: '11912452830',
      reason:
        'Mesmo telefone (11) 91245-2830 em dois registros (um ativo, um deleted: 5511912452830 e Pietro schurt).',
      records: [
        {
          id: '8hg4qxm8hw1bmmd',
          name: '5511912452830',
          phone: '5511912452830',
          deleted: true,
          customer_type: 'Cliente',
          pipeline_status: 'perdido',
        },
        {
          id: '6ndh9ifkm8x469j',
          name: 'Pietro schurt',
          phone: '(11) 91245-2830',
          deleted: false,
          customer_type: 'Ambos',
          pipeline_status: 'fechado',
        },
      ],
    },
    {
      type: 'phone',
      key: '11947518805',
      reason: 'Telefone 5511947518805 em registro deletado (Raphael schurt).',
      records: [
        {
          id: 'm9wmm41gyqi8tlx',
          name: 'Raphael schurt',
          phone: '5511947518805',
          deleted: true,
          customer_type: 'Cliente',
          pipeline_status: 'perdido',
        },
      ],
    },
    {
      type: 'document',
      key: '61136701000147',
      reason:
        'JAHU BORRACHAS E AUTOPECAS LTDA registrada via email NF-e (id ukuwsuetw0d3p2m). Raiz 61136701 agrupa futuras unidades como 61136701000372 à mesma entidade.',
      records: [
        {
          id: 'ukuwsuetw0d3p2m',
          name: 'JAHU BORRACHAS E AUTOPECAS LTDA',
          phone: '1136190000',
          cnpj: '61136701000147',
          deleted: false,
          customer_type: 'Fornecedor',
          pipeline_status: '',
        },
      ],
    },
  ],
}
