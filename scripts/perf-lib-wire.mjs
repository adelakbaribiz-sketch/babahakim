// PHASE 16 · raw wire-size helper — node:http GET that does NOT decompress,
// so the returned byte count is what actually crossed the network.
// fetch() auto-decompresses gzip/br, which silently hides compression gains
// (measurement bug caught during the PHASE 16 baseline).
import http from 'node:http'

export function wireBytes(port, pathName, acceptEncoding = 'gzip, deflate, br') {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: pathName, headers: { 'Accept-Encoding': acceptEncoding } },
      (res) => {
        let bytes = 0
        res.on('data', (chunk) => { bytes += chunk.length })
        res.on('end', () => resolve({ bytes, encoding: res.headers['content-encoding'] ?? null, status: res.statusCode }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}
