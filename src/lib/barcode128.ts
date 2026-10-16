/**
 * Gerador de Código de Barras Code 128 (Code 128 Auto/B/C) em Puro TypeScript / JavaScript.
 *
 * Gera SVG e dados de barras (módulos 0 e 1) sem dependências externas,
 * garantindo compatibilidade total com leitores ópticos industriais (Zebra, Honeywell, Elgin, etc.)
 * e browsers modernos para impressão térmica em modo vetorial nítido.
 */

// Tabela de padrões Code 128 (107 símbolos: valores 0 a 106)
// Cada símbolo tem 11 módulos de largura (o Stop no 106 tem 13 módulos: 2331112).
// Os números representam larguras alternadas de barras (preto) e espaços (branco).
export const CODE128_PATTERNS: string[] = [
  '212222', // 0
  '222122', // 1
  '222221', // 2
  '121223', // 3
  '121322', // 4
  '131222', // 5
  '122213', // 6
  '122312', // 7
  '132212', // 8
  '221213', // 9
  '221312', // 10
  '231212', // 11
  '112232', // 12
  '122132', // 13
  '122231', // 14
  '113222', // 15
  '123122', // 16
  '123221', // 17
  '223211', // 18
  '221132', // 19
  '221231', // 20
  '213212', // 21
  '223112', // 22
  '312131', // 23
  '311222', // 24
  '321122', // 25
  '321221', // 26
  '312212', // 27
  '322112', // 28
  '322211', // 29
  '212123', // 30
  '212321', // 31
  '232121', // 32
  '111323', // 33
  '131123', // 34
  '131321', // 35
  '112313', // 36
  '132113', // 37
  '132311', // 38
  '211313', // 39
  '231113', // 40
  '231311', // 41
  '112133', // 42
  '112331', // 43
  '132131', // 44
  '113123', // 45
  '113321', // 46
  '133121', // 47
  '313121', // 48
  '211331', // 49
  '231131', // 50
  '213113', // 51
  '213311', // 52
  '213131', // 53
  '311123', // 54
  '311321', // 55
  '331121', // 56
  '312113', // 57
  '312311', // 58
  '332111', // 59
  '314111', // 60
  '221411', // 61
  '431111', // 62
  '111224', // 63
  '111422', // 64
  '121124', // 65
  '121421', // 66
  '141122', // 67
  '141221', // 68
  '112214', // 69
  '112412', // 70
  '122114', // 71
  '122411', // 72
  '142112', // 73
  '142211', // 74
  '241211', // 75
  '221114', // 76
  '413111', // 77
  '241112', // 78
  '134111', // 79
  '111242', // 80
  '121142', // 81
  '121241', // 82
  '114212', // 83
  '124112', // 84
  '124211', // 85
  '411212', // 86
  '421112', // 87
  '421211', // 88
  '212141', // 89
  '214121', // 90
  '412121', // 91
  '111143', // 92
  '111341', // 93
  '131141', // 94
  '114113', // 95
  '114311', // 96
  '411113', // 97
  '411311', // 98
  '113141', // 99
  '114131', // 100
  '311141', // 101
  '411131', // 102
  '211412', // 103 (Start A)
  '211214', // 104 (Start B)
  '211232', // 105 (Start C)
  '2331112', // 106 (Stop: 7 elementos = 13 módulos)
]

const START_B = 104
const START_C = 105
const CODE_B = 100
const CODE_C = 99
const STOP = 106

export interface EncodedBarcode {
  binary: string // Sequência de '1's e '0's (1 = barra preta, 0 = espaço branco)
  totalModules: number
  codes: number[]
}

/**
 * Converte um valor de símbolo (0 a 106) na string binária correspondente de 1s e 0s.
 */
function patternToBinary(pattern: string): string {
  let bin = ''
  let isBar = true
  for (let i = 0; i < pattern.length; i++) {
    const width = parseInt(pattern[i], 10)
    bin += (isBar ? '1' : '0').repeat(width)
    isBar = !isBar
  }
  return bin
}

/**
 * Codifica uma string qualquer em Code 128 (Auto B/C) para máxima densidade e escaneabilidade.
 * Se o texto for puramente numérico com quantidade par de dígitos (ex: "8722"), usa Code C (2 dígitos por símbolo),
 * tornando o código compacto e com barras mais largas/fáceis de ler.
 * Se tiver dígitos ímpares ou letras, faz transição automática entre C e B.
 */
export function encodeCode128(text: string): EncodedBarcode {
  const clean = (text || '').trim()
  if (!clean) {
    return { binary: '', totalModules: 0, codes: [] }
  }

  const codes: number[] = []
  let pos = 0
  const len = clean.length

  // Helper para verificar se a partir de pos temos N dígitos consecutivos
  const hasNDigits = (start: number, n: number): boolean => {
    if (start + n > len) return false
    for (let i = 0; i < n; i++) {
      const ch = clean.charCodeAt(start + i)
      if (ch < 48 || ch > 57) return false
    }
    return true
  }

  // Decide modo inicial: se começa com 4 ou mais dígitos (ou exatamente 2 dígitos se len == 2), inicia no Code C
  let currentMode: 'B' | 'C' = 'B'
  if (hasNDigits(0, 4) || (len === 2 && hasNDigits(0, 2))) {
    currentMode = 'C'
    codes.push(START_C)
  } else {
    currentMode = 'B'
    codes.push(START_B)
  }

  while (pos < len) {
    if (currentMode === 'C') {
      if (hasNDigits(pos, 2)) {
        const pair = parseInt(clean.substring(pos, pos + 2), 10)
        codes.push(pair)
        pos += 2
      } else {
        // Não há 2 dígitos, chaveia para Code B
        codes.push(CODE_B)
        currentMode = 'B'
      }
    } else {
      // Modo B
      // Se encontramos 4 ou mais dígitos pela frente (ou exatamente 2 dígitos no fim), chaveia para Code C
      if (hasNDigits(pos, 4) || (pos + 2 === len && hasNDigits(pos, 2))) {
        codes.push(CODE_C)
        currentMode = 'C'
      } else {
        const codePoint = clean.charCodeAt(pos)
        // Code B aceita ASCII de 32 a 127 (espaço até ~)
        if (codePoint >= 32 && codePoint <= 126) {
          codes.push(codePoint - 32)
        } else {
          // Caractere fora de 32..126: mapeia para espaço (32 - 32 = 0)
          codes.push(0)
        }
        pos++
      }
    }
  }

  // Cálculo do checksum Code 128:
  // (StartValue + SUM(posição * valor)) % 103
  let checksum = codes[0]
  for (let i = 1; i < codes.length; i++) {
    checksum = (checksum + i * codes[i]) % 103
  }
  codes.push(checksum)
  codes.push(STOP)

  // Montar string binária
  let binary = ''
  for (let i = 0; i < codes.length; i++) {
    const pattern = CODE128_PATTERNS[codes[i]]
    if (pattern) {
      binary += patternToBinary(pattern)
    }
  }

  return {
    binary,
    totalModules: binary.length,
    codes,
  }
}

export interface BarcodeSvgOptions {
  width?: number | string // Largura total (ex: '100%', 200, '62mm')
  height?: number | string // Altura das barras (ex: 40, '12mm')
  moduleWidth?: number // Largura mínima em pixels/unidades do módulo mais fino (default 1.5)
  quietZone?: boolean // Incluir quiet zones nas laterais (default: true)
  quietZoneModules?: number // Número de módulos na margem de silêncio (padrão Code 128: 10 módulos)
  barColor?: string // Cor das barras (default '#000000')
  bgColor?: string // Cor de fundo (default 'transparent' ou '#ffffff')
}

/**
 * Converte a codificação em um elemento SVG otimizado e nítido.
 * Renderiza retângulos consolidados para barras consecutivas (reduz número de nós DOM e acelera impressão).
 */
export function generateBarcodeSvgPath(
  binary: string,
  moduleWidth: number = 1,
  height: number = 40,
): { path: string; totalWidth: number } {
  let path = ''
  let currentX = 0
  let runLength = 0
  let inBar = false

  for (let i = 0; i < binary.length; i++) {
    const isOne = binary[i] === '1'
    if (isOne) {
      if (inBar) {
        runLength++
      } else {
        inBar = true
        runLength = 1
      }
    } else {
      if (inBar) {
        const barWidth = runLength * moduleWidth
        path += `M${currentX},0h${barWidth}v${height}h-${barWidth}Z `
        currentX += barWidth
        inBar = false
        runLength = 0
      }
      currentX += moduleWidth
    }
  }

  if (inBar && runLength > 0) {
    const barWidth = runLength * moduleWidth
    path += `M${currentX},0h${barWidth}v${height}h-${barWidth}Z `
    currentX += barWidth
  }

  return {
    path: path.trim(),
    totalWidth: binary.length * moduleWidth,
  }
}
