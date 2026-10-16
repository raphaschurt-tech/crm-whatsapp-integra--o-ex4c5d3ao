import React, { useMemo } from 'react'
import { encodeCode128, generateBarcodeSvgPath } from '@/lib/barcode128'

export interface Barcode128Props {
  value: string
  height?: number // Altura das barras no SVG (ex: 36)
  className?: string
  showText?: boolean
  textClassName?: string
  quietZone?: boolean
}

/**
 * Componente React que renderiza o código de barras Code 128 via SVG puro,
 * escalável vetorialmente e com fidelidade perfeita para impressoras térmicas (Zebra, Argox, etc).
 */
export const Barcode128: React.FC<Barcode128Props> = ({
  value,
  height = 36,
  className = '',
  showText = false,
  textClassName = '',
  quietZone = true,
}) => {
  const { pathData, totalWidth, totalHeight } = useMemo(() => {
    const encoded = encodeCode128(value)
    if (!encoded.binary) {
      return { pathData: '', totalWidth: 0, totalHeight: height }
    }

    const qz = quietZone ? 10 : 0 // Margem de silêncio (10 módulos recomendados para Code 128)
    const paddedBinary = '0'.repeat(qz) + encoded.binary + '0'.repeat(qz)
    const svgRes = generateBarcodeSvgPath(paddedBinary, 1, height)

    return {
      pathData: svgRes.path,
      totalWidth: svgRes.totalWidth,
      totalHeight: height,
    }
  }, [value, height, quietZone])

  if (!pathData) {
    return <div className="text-xs text-red-500 italic">Código inválido</div>
  }

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <svg
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        preserveAspectRatio="none"
        className="w-full h-full block"
        style={{ shapeRendering: 'crispEdges' }}
      >
        <path d={pathData} fill="#000000" />
      </svg>
      {showText && (
        <span
          className={`font-mono font-bold tracking-wider text-center block ${
            textClassName || 'text-xs text-slate-800'
          }`}
        >
          {value}
        </span>
      )}
    </div>
  )
}

export default Barcode128
