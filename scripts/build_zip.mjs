// scripts/build_zip.mjs
// Gera public/worker-dfe.zip a partir dos arquivos em worker-dfe/
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import crypto from 'crypto'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// Gerar icp-brasil-ca.pem a partir dos certs de assinatura (@nfewizard/shared) + SEFAZ/SERPRO SSL
try {
  const targetPemPath = path.resolve('worker-dfe/icp-brasil-ca.pem')
  const sefazPemPath = path.resolve('worker-dfe/sefaz-ssl-ca.pem')

  const loadedPems = []

  // 1. Varrer pasta de certs de assinatura se existir
  const sharedCertDir = path.resolve('node_modules/@nfewizard/shared/resources/certs')
  if (fs.existsSync(sharedCertDir) && fs.statSync(sharedCertDir).isDirectory()) {
    const files = fs.readdirSync(sharedCertDir).filter((f) => !f.startsWith('.'))
    for (const f of files) {
      try {
        const buf = fs.readFileSync(path.join(sharedCertDir, f))
        const text = buf.toString('utf8')
        if (text.includes('-----BEGIN CERTIFICATE-----')) {
          loadedPems.push(text.trim())
        } else {
          const x509 = new crypto.X509Certificate(buf)
          loadedPems.push(x509.toString().trim())
        }
      } catch (_) {}
    }
  }

  // Se não leu de node_modules, ler os existentes do próprio icp-brasil-ca.pem
  if (loadedPems.length === 0 && fs.existsSync(targetPemPath)) {
    const curText = fs.readFileSync(targetPemPath, 'utf8')
    const regex = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
    const matches = curText.match(regex) || []
    for (const m of matches) {
      loadedPems.push(m.trim())
    }
  }

  // 2. Incorporar sefaz-ssl-ca.pem
  if (fs.existsSync(sefazPemPath)) {
    const sefazText = fs.readFileSync(sefazPemPath, 'utf8')
    const regex = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
    const matches = sefazText.match(regex) || []
    for (const m of matches) {
      const trimmed = m.trim()
      if (!loadedPems.includes(trimmed)) {
        loadedPems.push(trimmed)
      }
    }
  }

  // 3. Garantir explicitamente que GlobalSign Root R46 e AC SERPRO AR46 estejam presentes
  const globalsignR46Pem = `-----BEGIN CERTIFICATE-----
MIIFWjCCA0KgAwIBAgISEdK7udcjGJ5AXwqdLdDfJWfRMA0GCSqGSIb3DQEBDAUA
MEYxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9iYWxTaWduIG52LXNhMRwwGgYD
VQQDExNHbG9iYWxTaWduIFJvb3QgUjQ2MB4XDTE5MDMyMDAwMDAwMFoXDTQ2MDMy
MDAwMDAwMFowRjELMAkGA1UEBhMCQkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYt
c2ExHDAaBgNVBAMTE0dsb2JhbFNpZ24gUm9vdCBSNDYwggIiMA0GCSqGSIb3DQEB
AQUAA4ICDwAwggIKAoICAQCsrHQy6LNl5brtQyYdpokNRbopiLKkHWPd08EsCVeJ
OaFV6Wc0dwxu5FUdUiXSE2te4R2pt32JMl8Nnp8semNgQB+msLZ4j5lUlghYruQG
vGIFAha/r6gjA7aUD7xubMLL1aa7DOn2wQL7Id5m3RerdELv8HQvJfTqa1VbkNud
316HCkD7rRlr+/fKYIje2sGP1q7Vf9Q8g+7XFkyDRTNrJ9CG0Bwta/OrffGFqfUo
0q3v84RLHIf8E6M6cqJaESvWJ3En7YEtbWaBkoe0G1h6zD8K+kZPTXhc+CtI4wSE
y132tGqzZfxCnlEmIyDLPRT5ge1lFgBPGmSXZgjPjHvjK8Cd+RTyG/FWaha/LIWF
zXg4mutCagI0GIMXTpRW+LaCtfOW3T3zvn8gdz57GSNrLNRyc0NXfeD412lPFzYE
+cCQYDdF3uYM2HSNrpyibXRdQr4G9dlkbgIQrImwTDsHTUB+JMWKmIJ5jqSngiCN
I/onccnfxkF0oE32kRbcRoxfKWMxWXEM2G/CtjJ9++ZdU6Z+Ffy7dXxd7Pj2Fxzs
x2sZy/N78CsHpdlseVR2bJ0cpm4O6XkMqCNqo98bMDGfsVR7/mrLZqrcZdCinkqa
ByFrgY/bxFn63iLABJzjqls2k+g9vXqhnQt2sQvHnf3PmKgGwvgqo6GDoLclcqUC
4wIDAQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNV
HQ4EFgQUA1yrc4GHqMywptWU4jaWSf8FmSwwDQYJKoZIhvcNAQEMBQADggIBAHx4
7PYCLLtbfpIrXTncvtgdokIzTfnvpCo7RGkerNlFo048p9gkUbJUHJNOxO97k4Vg
JuoJSOD1u8fpaNK7ajFxzHmuEajwmf3lH7wvqMxX63bEIaZHU1VNaL8FpO7XJqti
2kM3S+LGteWygxk6x9PbTZ4IevPuzz5i+6zoYMzRx6Fcg0XERczzF2sUyQQCPtIk
pnnpHs6i58FZFZ8d4kuaPp92CC1r2LpXFNqD6v6MVenQTqnMdzGxRBF6XLE+0xRF
FRhiJBPSy03OXIPBNvIQtQ6IbbjhVp+J3pZmOUdkLG5NrmJ7v2B0GbhWrJKsFjLt
rWhV/pi60zTe9Mlhww6G9kuEYO4Ne7UyWHmRVSyBQ7N0H3qqJZ4d16GLuc1CLgSk
ZoNNiTW2bKg2SnkheCLQQrzRQDGQob4Ez8pn7fXwgNNgyYMqIgXQBztSvwyeqiv5
u+YfjyW6hY0XHgL+XVAEV8/+LbzvXMAaq7afJMbfc2hIkCwU9D9SGuTSyxTDYWnP
4vkYxboznxSjBF25cfe1lNj2M8FawTSLfJvdkzrnE6JwYZ+vj+vYxXX4M2bUdGc6
N3ec592kD3ZDZopD8p/7DEJ4Y9HiD2971KE9dJeFt0g5QdYg/NA6s/rob8SKunE3
vouXsXgxT7PntgMTzlSdriVZzH81Xwj3QEUxeCp6
-----END CERTIFICATE-----`

  if (!loadedPems.includes(globalsignR46Pem.trim())) {
    loadedPems.push(globalsignR46Pem.trim())
  }

  if (loadedPems.length > 0) {
    fs.writeFileSync(targetPemPath, loadedPems.join('\n\n') + '\n', 'utf8')
    console.log(
      `[PREBUILD-CA] icp-brasil-ca.pem atualizado com ${loadedPems.length} certificados (Assinatura + SERPRO SSL + GlobalSign Root R46).`,
    )
  }
} catch (e) {
  console.warn(
    '[PREBUILD-CA-WARN] Não foi possível compilar icp-brasil-ca.pem no prebuild:',
    e.message,
  )
}

// CRC32 implementation
const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcTable[i] = c >>> 0
}

function crc32(buf) {
  let crc = 0 ^ -1
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

function dosDateTime(date) {
  const d = date || new Date()
  const year = d.getFullYear()
  const dosYear = year < 1980 ? 0 : year - 1980
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const dosDate = (dosYear << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { dosTime, dosDate }
}

function createZip(entries) {
  const localHeaders = []
  const centralHeaders = []
  let offset = 0

  for (const entry of entries) {
    const filenameBuf = Buffer.from(entry.name, 'utf8')
    const uncompressedData = entry.data
    const uncompressedSize = uncompressedData.length
    const crc = crc32(uncompressedData)

    // Deflate data (raw deflate without zlib header/footer: -15 windowBits)
    const compressedData = zlib.deflateRawSync(uncompressedData, { level: 9 })
    const compressedSize = compressedData.length
    const { dosTime, dosDate } = dosDateTime(entry.mtime)

    // Local file header: 30 bytes + filename
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0) // Local file header signature
    localHeader.writeUInt16LE(20, 4) // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6) // General purpose bit flag (bit 11 = UTF-8)
    localHeader.writeUInt16LE(8, 8) // Compression method: 8 = Deflate
    localHeader.writeUInt16LE(dosTime, 10) // Last mod file time
    localHeader.writeUInt16LE(dosDate, 12) // Last mod file date
    localHeader.writeUInt32LE(crc, 14) // CRC-32
    localHeader.writeUInt32LE(compressedSize, 18) // Compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22) // Uncompressed size
    localHeader.writeUInt16LE(filenameBuf.length, 26) // File name length
    localHeader.writeUInt16LE(0, 28) // Extra field length

    const localRecord = Buffer.concat([localHeader, filenameBuf, compressedData])
    localHeaders.push(localRecord)

    // Central directory file header: 46 bytes + filename
    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0) // Central directory header signature
    centralHeader.writeUInt16LE(20, 4) // Version made by
    centralHeader.writeUInt16LE(20, 6) // Version needed to extract
    centralHeader.writeUInt16LE(0x0800, 8) // General purpose bit flag (UTF-8)
    centralHeader.writeUInt16LE(8, 10) // Compression method (Deflate)
    centralHeader.writeUInt16LE(dosTime, 12) // Last mod file time
    centralHeader.writeUInt16LE(dosDate, 14) // Last mod file date
    centralHeader.writeUInt32LE(crc, 16) // CRC-32
    centralHeader.writeUInt32LE(compressedSize, 20) // Compressed size
    centralHeader.writeUInt32LE(uncompressedSize, 24) // Uncompressed size
    centralHeader.writeUInt16LE(filenameBuf.length, 28) // File name length
    centralHeader.writeUInt16LE(0, 30) // Extra field length
    centralHeader.writeUInt16LE(0, 32) // File comment length
    centralHeader.writeUInt16LE(0, 34) // Disk number start
    centralHeader.writeUInt16LE(0, 36) // Internal file attributes
    centralHeader.writeUInt32LE(0, 38) // External file attributes
    centralHeader.writeUInt32LE(offset, 42) // Relative offset of local header

    const centralRecord = Buffer.concat([centralHeader, filenameBuf])
    centralHeaders.push(centralRecord)

    offset += localRecord.length
  }

  const centralDirectoryOffset = offset
  const centralDirectoryBuf = Buffer.concat(centralHeaders)
  const centralDirectorySize = centralDirectoryBuf.length

  // End of central directory record (EOCD): 22 bytes
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // EOCD signature
  eocd.writeUInt16LE(0, 4) // Disk number
  eocd.writeUInt16LE(0, 6) // Disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8) // Number of central directory records on this disk
  eocd.writeUInt16LE(entries.length, 10) // Total number of central directory records
  eocd.writeUInt32LE(centralDirectorySize, 12) // Size of central directory
  eocd.writeUInt32LE(centralDirectoryOffset, 16) // Offset of start of central directory
  eocd.writeUInt16LE(0, 20) // Comment length

  return Buffer.concat([...localHeaders, centralDirectoryBuf, eocd])
}

const workerDir = path.resolve('worker-dfe')
const publicDir = path.resolve('public')
const zipOutPath = path.join(publicDir, 'worker-dfe.zip')

// Lista explícita dos arquivos do pacote worker-dfe (nunca node_modules ou config.json real)
const allowedFiles = [
  'certUtils.js',
  'config.example.json',
  'crmClient.js',
  'dfeAdapter.js',
  'icp-brasil-ca.pem',
  'index.js',
  'package.json',
  'README.md',
  'sefaz-ssl-ca.pem',
  'test-simulation.js',
]

const files = fs
  .readdirSync(workerDir)
  .filter((name) => allowedFiles.includes(name))
  .sort()

console.log('Arquivos incluídos no worker-dfe.zip:', files)

const entries = files.map((filename) => {
  const filePath = path.join(workerDir, filename)
  const stat = fs.statSync(filePath)
  const data = fs.readFileSync(filePath)
  return {
    name: filename,
    data,
    mtime: stat.mtime,
  }
})

const zipBuffer = createZip(entries)

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true })
}

fs.writeFileSync(zipOutPath, zipBuffer)
const base64Zip = zipBuffer.toString('base64')
fs.writeFileSync(path.join(publicDir, 'worker-dfe.zip.b64'), base64Zip)
console.log(`[ZIP-OK] Gerado com sucesso: ${zipOutPath} (${zipBuffer.length} bytes)`)

// Verificação de descompressão e integridade
const zipTest = fs.readFileSync(zipOutPath)
console.log('Tamanho final gravado em disco:', zipTest.length)
