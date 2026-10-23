// scripts/build_zip.mjs
// Gera public/worker-dfe.zip a partir dos arquivos em worker-dfe/
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// Gerar icp-brasil-ca.pem se não existir ou a partir dos certs disponíveis
try {
  const dfeAdapter = require('../worker-dfe/dfeAdapter.js')
  if (dfeAdapter && typeof dfeAdapter.buildIcpBrasilCaFile === 'function') {
    dfeAdapter.buildIcpBrasilCaFile(path.resolve('worker-dfe/icp-brasil-ca.pem'))
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

// Lista explícita dos 8 arquivos do pacote worker-dfe (nunca node_modules ou config.json real)
const allowedFiles = [
  'certUtils.js',
  'config.example.json',
  'crmClient.js',
  'dfeAdapter.js',
  'icp-brasil-ca.pem',
  'index.js',
  'package.json',
  'README.md',
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
