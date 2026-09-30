import React, { useEffect, useState } from 'react'
import { Building2, User } from 'lucide-react'
import { fetchProfilePhoto, getCachedProfilePhoto } from '@/services/whatsappProfilePhoto'

export interface CustomerAvatarProps {
  phone: string
  name: string
  type?: 'PF' | 'PJ'
  className?: string
  size?: 'md' | 'sm' | 'lg'
}

export const CustomerAvatar = React.memo(function CustomerAvatar({
  phone,
  name,
  type = 'PF',
  className = '',
  size = 'md',
}: CustomerAvatarProps) {
  // Inicialização síncrona pelo cache (memória ou localStorage)
  const [photoUrl, setPhotoUrl] = useState<string | null>(() => {
    const cached = getCachedProfilePhoto(phone)
    return cached.hit ? cached.url : null
  })
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    let isMounted = true
    setHasError(false)

    // Se já temos no cache, atualiza o estado
    const cached = getCachedProfilePhoto(phone)
    if (cached.hit) {
      setPhotoUrl(cached.url)
      return
    }

    // Busca sob demanda com debounce / fila
    fetchProfilePhoto(phone)
      .then((url) => {
        if (isMounted) {
          setPhotoUrl(url)
        }
      })
      .catch(() => {
        if (isMounted) {
          setPhotoUrl(null)
        }
      })

    return () => {
      isMounted = false
    }
  }, [phone])

  const dimensionClasses =
    size === 'sm' ? 'w-9 h-9 text-xs' : size === 'lg' ? 'w-12 h-12 text-base' : 'w-11 h-11 text-sm'

  const iconDimension = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5'

  // Caso tenha foto e não tenha dado erro de carregamento da imagem
  if (photoUrl && !hasError) {
    return (
      <div
        className={`relative rounded-full overflow-hidden shrink-0 border border-slate-200/60 bg-slate-100 ${dimensionClasses} ${className}`}
      >
        <img
          src={photoUrl}
          alt={name || phone || 'Contato'}
          className="w-full h-full object-cover rounded-full"
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => {
            // Em caso de falha de carregamento da imagem (ex: URL expirou), volta ao círculo atual
            setHasError(true)
          }}
        />
      </div>
    )
  }

  // Fallback: círculo atual colorido com ícone User / Building2
  const bgAndText = type === 'PJ' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'

  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold shrink-0 ${bgAndText} ${dimensionClasses} ${className}`}
      title={name || phone}
    >
      {type === 'PJ' ? <Building2 className={iconDimension} /> : <User className={iconDimension} />}
    </div>
  )
})
