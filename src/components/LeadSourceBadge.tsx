import React from 'react'
import { MessageCircle, Instagram, Globe, Tag } from 'lucide-react'
import { LeadSource } from '@/types/crm'

export interface LeadSourceBadgeProps {
  source?: LeadSource | string | null
  showLabel?: boolean
  className?: string
  size?: 'sm' | 'md'
}

interface SourceConfig {
  label: string
  icon: React.ComponentType<{ className?: string }>
  badgeClass: string
  iconClass: string
}

export const LEAD_SOURCE_CONFIG: Record<LeadSource, SourceConfig> = {
  whatsapp: {
    label: 'WhatsApp',
    icon: MessageCircle,
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
    iconClass: 'text-emerald-600',
  },
  instagram: {
    label: 'Instagram',
    icon: Instagram,
    badgeClass: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 hover:bg-fuchsia-100',
    iconClass: 'text-fuchsia-600',
  },
  google: {
    label: 'Google',
    icon: Globe,
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100',
    iconClass: 'text-sky-600',
  },
  other: {
    label: 'Outros',
    icon: Tag,
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200',
    iconClass: 'text-slate-500',
  },
}

export const LEAD_SOURCE_OPTIONS: Array<{ value: LeadSource; label: string }> = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'google', label: 'Google' },
  { value: 'other', label: 'Outros' },
]

export const LeadSourceBadge: React.FC<LeadSourceBadgeProps> = ({
  source,
  showLabel = true,
  className = '',
  size = 'sm',
}) => {
  const normalizedKey: LeadSource =
    source === 'whatsapp' || source === 'instagram' || source === 'google' || source === 'other'
      ? source
      : 'other'

  const config = LEAD_SOURCE_CONFIG[normalizedKey]
  const Icon = config.icon

  const sizeClasses =
    size === 'md' ? 'text-xs px-2.5 py-1 gap-1.5' : 'text-[10px] px-1.5 py-0.5 gap-1'

  const iconSizeClasses = size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'

  return (
    <span
      className={`inline-flex items-center font-medium rounded border ${config.badgeClass} ${sizeClasses} ${className}`}
      title={`Origem: ${config.label}`}
    >
      <Icon className={`${iconSizeClasses} ${config.iconClass} shrink-0`} />
      {showLabel && <span className="font-semibold">{config.label}</span>}
    </span>
  )
}
