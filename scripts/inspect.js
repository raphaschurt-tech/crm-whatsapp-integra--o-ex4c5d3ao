import fs from 'node:fs'

const buf = fs.readFileSync('src/assets/logo-4855f.png')
console.log('PNG size:', buf.length)
const width = buf.readUInt32BE(16)
const height = buf.readUInt32BE(20)
const bitDepth = buf[24]
const colorType = buf[25]
const compression = buf[26]
const filter = buf[27]
const interlace = buf[28]

console.log(JSON.stringify({ width, height, bitDepth, colorType, compression, filter, interlace }))

let pos = 8
const chunks = []
while (pos < buf.length) {
  const cLen = buf.readUInt32BE(pos)
  const cType = buf.subarray(pos + 4, pos + 8).toString('ascii')
  chunks.push({ type: cType, len: cLen, pos })
  pos += 8 + cLen + 4
}
console.log('Chunks:', JSON.stringify(chunks))
