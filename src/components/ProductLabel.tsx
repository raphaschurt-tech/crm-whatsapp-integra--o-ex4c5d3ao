import React from 'react'
import { Product } from '@/types/crm'
import { Barcode128 } from '@/components/Barcode128'

export interface ProductLabelProps {
  product: Product
  /**
   * 'print': renderizado para impressão física no diálogo / janela de print (70mm x 30mm)
   * 'preview': renderizado em tela (escala 1:1 real ou proporcional)
   */
  mode?: 'print' | 'preview'
  /**
   * Se true, exibe a moldura da etiqueta com linha pontilhada (apenas para pré-visualização)
   */
  showBorder?: boolean
  className?: string
}

/**
 * Formata a localização física completa do produto (ex: "2 · A · 7" ou "RUA 2 / BOX A7")
 */
export function formatLocation(product: Product): string {
  const parts = [product.location_1, product.location_2, product.location_3]
    .map((s) => (s || '').trim())
    .filter(Boolean)
  return parts.join(' · ')
}

/**
 * Componente da Etiqueta de Produto 70mm x 30mm.
 *
 * REQUISITOS DO MODELO:
 * - Dimensões: 70mm de largura por 30mm de altura (alimentação contínua da impressora térmica Argox/Zebra).
 * - O rolo de etiqueta tem 70mm de largura e 30mm de comprimento na direção de avanço do cabeçote.
 * - Na etiqueta física (vertical / girada 90° em relação à leitura horizontal):
 *   O texto é orientado para que a leitura fique vertical:
 *   [ TOPO ] Código de barras Code 128 (do SKU)
 *   [ SUB-TOPO ] SKU em fonte grande de alto contraste (ex: "8722")
 *   [ CORPO ] Descrição completa do produto em caixa alta
 *   [ RODAPÉ ] LOCALIZAÇÃO (ex: "LOC: 2 · A · 7" ou "LOC: —") + Marca/Família opcional
 *
 * No modo de impressão (@media print):
 * Cada etiqueta ocupa exatamente UMA página de 70mm x 30mm com margem zero e quebra de página automática (`page-break-after: always`).
 */
export const ProductLabel: React.FC<ProductLabelProps> = ({
  product,
  mode = 'preview',
  showBorder = true,
  className = '',
}) => {
  const sku = (product.sku || '').trim() || '0000'
  const location = formatLocation(product)
  const isPrint = mode === 'print'

  return (
    <div
      className={`product-label-box relative bg-white text-black overflow-hidden box-border select-none ${
        isPrint
          ? 'product-label-print'
          : `shadow-md rounded-sm ${showBorder ? 'border border-slate-400' : ''}`
      } ${className}`}
      style={{
        width: '70mm',
        height: '30mm',
        minWidth: '70mm',
        maxWidth: '70mm',
        minHeight: '30mm',
        maxHeight: '30mm',
        padding: '1.2mm 2mm 1.2mm 2mm',
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
      }}
    >
      <div className="w-full h-full flex flex-col justify-between leading-none overflow-hidden">
        {/* BLOCO SUPERIOR: Código de Barras Code 128 (do SKU) */}
        <div className="w-full flex flex-col items-center pt-0.5">
          <div className="w-full max-w-[66mm] h-[8.5mm] flex items-center justify-center">
            <Barcode128 value={sku} height={32} quietZone={false} className="w-full h-full" />
          </div>
        </div>

        {/* CÓDIGO DO PRODUTO (SKU) EM FONTE GRANDE */}
        <div className="w-full flex items-center justify-between px-0.5 mt-[-1px]">
          <span
            className="font-extrabold tracking-tight font-mono text-black"
            style={{
              fontSize: '15pt',
              lineHeight: '1.05',
              letterSpacing: '0.02em',
            }}
          >
            {sku}
          </span>
          {product.brand && (
            <span
              className="font-bold uppercase tracking-wider text-black truncate max-w-[32mm] text-right"
              style={{
                fontSize: '7.5pt',
                lineHeight: '1',
              }}
            >
              {product.brand}
            </span>
          )}
        </div>

        {/* CORPO: Descrição / Nome do produto */}
        <div className="w-full px-0.5 flex-1 min-h-0 flex items-center overflow-hidden my-0.5">
          <p
            className="font-semibold uppercase text-black line-clamp-2 leading-[1.1] w-full"
            style={{
              fontSize: '7.5pt',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'break-word',
            }}
            title={product.name}
          >
            {product.name}
          </p>
        </div>

        {/* RODAPÉ: Localização física + Detalhes secundários (Código reduzido / Família) */}
        <div
          className="w-full px-0.5 pt-0.5 border-t border-black flex items-center justify-between"
          style={{
            fontSize: '6.5pt',
            lineHeight: '1',
          }}
        >
          <div className="flex items-center gap-1 min-w-0 font-bold truncate">
            <span className="bg-black text-white px-1 py-[1px] rounded-[1px] tracking-wider text-[6pt]">
              LOC
            </span>
            <span
              className={`truncate ${
                location
                  ? 'text-black tracking-wide font-extrabold'
                  : 'text-gray-500 font-normal italic'
              }`}
            >
              {location || 'NÃO DEFINIDA'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 pl-1 text-[6pt] text-gray-800 font-mono">
            {product.reduced_code && <span>RED: {product.reduced_code}</span>}
            {product.sou_family && !product.reduced_code && (
              <span className="truncate max-w-[24mm] uppercase">{product.sou_family}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ProductLabel
