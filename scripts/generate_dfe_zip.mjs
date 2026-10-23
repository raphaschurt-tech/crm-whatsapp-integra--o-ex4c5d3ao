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

  if (loadedPems.length === 0 && fs.existsSync(targetPemPath)) {
    const curText = fs.readFileSync(targetPemPath, 'utf8')
    const regex = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
    const matches = curText.match(regex) || []
    for (const m of matches) {
      loadedPems.push(m.trim())
    }
  }

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

  if (loadedPems.length > 0) {
    fs.writeFileSync(targetPemPath, loadedPems.join('\n\n') + '\n', 'utf8')
    console.log(
      `[GEN-CA] icp-brasil-ca.pem atualizado com ${loadedPems.length} certificados (Assinatura + SERPRO SSL).`,
    )
  }
} catch (e) {
  console.warn('[GEN-CA-WARN] Não foi possível compilar icp-brasil-ca.pem:', e.message)
}

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

    const compressedData = zlib.deflateRawSync(uncompressedData, { level: 9 })
    const compressedSize = compressedData.length
    const { dosTime, dosDate } = dosDateTime(entry.mtime)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt16LE(dosTime, 10)
    localHeader.writeUInt16LE(dosDate, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(compressedSize, 18)
    localHeader.writeUInt32LE(uncompressedSize, 22)
    localHeader.writeUInt16LE(filenameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28)

    const localRecord = Buffer.concat([localHeader, filenameBuf, compressedData])
    localHeaders.push(localRecord)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(compressedSize, 20)
    centralHeader.writeUInt32LE(uncompressedSize, 24)
    centralHeader.writeUInt16LE(filenameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)

    const centralRecord = Buffer.concat([centralHeader, filenameBuf])
    centralHeaders.push(centralRecord)

    offset += localRecord.length
  }

  const centralDirectoryOffset = offset
  const centralDirectoryBuf = Buffer.concat(centralHeaders)
  const centralDirectorySize = centralDirectoryBuf.length

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirectorySize, 12)
  eocd.writeUInt32LE(centralDirectoryOffset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localHeaders, centralDirectoryBuf, eocd])
}

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
  .readdirSync(path.resolve('worker-dfe'))
  .filter((name) => allowedFiles.includes(name))
  .sort()

const entries = files.map((filename) => {
  const filePath = path.resolve('worker-dfe', filename)
  const stat = fs.statSync(filePath)
  const data = fs.readFileSync(filePath)
  return {
    name: filename,
    data,
    mtime: stat.mtime,
  }
})

const zipBuffer = createZip(entries)

// Write zip directly as base64 string
const base64Zip = zipBuffer.toString('base64')
fs.writeFileSync('public/worker-dfe.zip.b64', base64Zip)
fs.writeFileSync('public/worker-dfe.zip', zipBuffer)

// Test reading back
function testZip(buffer) {
  // Simple check of entries in central directory
  let pos = buffer.length - 22
  while (pos > 0 && buffer.readUInt32LE(pos) !== 0x06054b50) {
    pos--
  }
  const totalEntries = buffer.readUInt16LE(pos + 10)
  const cdOffset = buffer.readUInt32LE(pos + 16)
  let cdPos = cdOffset
  const extractedFiles = []
  for (let i = 0; i < totalEntries; i++) {
    const fnLen = buffer.readUInt16LE(cdPos + 28)
    const extraLen = buffer.readUInt16LE(cdPos + 30)
    const commentLen = buffer.readUInt16LE(cdPos + 32)
    const fn = buffer.toString('utf8', cdPos + 46, cdPos + 46 + fnLen)
    const localHeaderOffset = buffer.readUInt32LE(cdPos + 42)
    const compMethod = buffer.readUInt16LE(cdPos + 10)
    const compSize = buffer.readUInt32LE(cdPos + 20)
    const uncompSize = buffer.readUInt32LE(cdPos + 24)
    const locFnLen = buffer.readUInt16LE(localHeaderOffset + 26)
    const locExtraLen = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + locFnLen + locExtraLen
    const compData = buffer.subarray(dataStart, dataStart + compSize)
    const uncompData = compMethod === 8 ? zlib.inflateRawSync(compData) : compData
    if (uncompData.length !== uncompSize) {
      throw new Error(`Size mismatch for ${fn}`)
    }
    extractedFiles.push({ name: fn, size: uncompSize })
    cdPos += 46 + fnLen + extraLen + commentLen
  }
  return extractedFiles
}

const verified = testZip(zipBuffer)
console.log('ZIP verificado com sucesso, arquivos:', verified)
