const http = require('http')
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const port = 8000

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
}

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  })
  res.end(body)
}

const server = http.createServer((req, res) => {
  const rawPath = decodeURIComponent(String((req.url || '/').split('?')[0] || '/'))
  const requestPath = rawPath === '/' ? '/index.html' : rawPath
  const safePath = requestPath.replace(/^\/+/, '')
  let filePath = path.join(root, safePath)

  fs.stat(filePath, (statErr, stat) => {
    if (!statErr && stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html')
    }

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        send(res, 404, 'Not found')
        return
      }

      const ext = path.extname(filePath).toLowerCase()
      send(res, 200, data, mime[ext] || 'application/octet-stream')
    })
  })
})

server.listen(port, () => {
  console.log(`http://localhost:${port}/`)
})
