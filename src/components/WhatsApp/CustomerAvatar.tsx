import React, { useEffect, useState } from 'react'
import { Building2, User } from 'lucide-react'
import { fetchProfilePhoto, getCachedProfilePhoto } from '@/services/whatsappProfilePhoto'

export interface CustomerAvatarProps {
  phone: string
  name: string
  type?: 'PF' | 'PJ'
  className?: string
  size?: 'md' | 'sm' | 'lg'
  /**
   * Se true (default), carrega sob demanda se estiver visível no viewport (IntersectionObserver)
   * Se false, usa apenas o cache existente sem disparar fetch de rede
   */
  lazy?: boolean
}

export const CustomerAvatar = React.memo(function CustomerAvatar({
  phone,
  name,
  type = 'PF',
  className = '',
  size = 'md',
  lazy = true,
}: CustomerAvatarProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [isVisible, setIsVisible] = useState(!lazy)

  // Inicialização síncrona pelo cache (memória ou localStorage)
  const [photoUrl, setPhotoUrl] = useState<string | null>(() => {
    const cached = getCachedProfilePhoto(phone)
    return cached.hit ? cached.url : null
  })
  const [hasError, setHasError] = useState(false)

  // IntersectionObserver para lazy loading: dispara fetch apenas quando o item entrar na tela
  useEffect(() => {
    if (!lazy || isVisible) return

    // Se já está no cache, não precisa esperar IntersectionObserver
    const cached = getCachedProfilePhoto(phone)
    if (cached.hit) {
      setIsVisible(true)
      setPhotoUrl(cached.url)
      return
    }

    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setIsVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry && entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '120px' }, // margem antecipada para carregar antes do usuário ver
    )

    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    return () => {
      observer.disconnect()
    }
  }, [lazy, isVisible, phone])

  useEffect(() => {
    let isMounted = true
    setHasError(false)

    // Se já temos no cache, atualiza o estado
    const cached = getCachedProfilePhoto(phone)
    if (cached.hit) {
      setPhotoUrl(cached.url)
      return
    }

    // Só busca se o elemento estiver visível / permitido
    if (!isVisible) return

    // Busca sob demanda com fila de concorrência limitada (3-4 simultâneas) e dedupe por telefone
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
  }, [phone, isVisible])

  const dimensionClasses =
    size === 'sm' ? 'w-9 h-9 text-xs' : size === 'lg' ? 'w-12 h-12 text-base' : 'w-11 h-11 text-sm'

  const iconDimension = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5'

  // Caso tenha foto e não tenha dado erro de carregamento da imagem
  if (photoUrl && !hasError) {
    return (
      <div
        ref={containerRef}
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
      ref={containerRef}
      className={`rounded-full flex items-center justify-center font-bold shrink-0 ${bgAndText} ${dimensionClasses} ${className}`}
      title={name || phone}
    >
      {type === 'PJ' ? <Building2 className={iconDimension} /> : <User className={iconDimension} />}
    </div>
  )
})
