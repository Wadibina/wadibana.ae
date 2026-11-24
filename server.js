'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8000);
const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp'
};

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
}

function respond(res, status, message, method) {
    const body = Buffer.from(message, 'utf8');
    res.writeHead(status, {
        'Content-Length': body.length,
        'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end(method === 'HEAD' ? undefined : body);
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        respond(res, 405, 'Method not allowed', req.method);
        return;
    }

    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
    } catch {
        respond(res, 400, 'Bad request', req.method);
        return;
    }

    const segments = pathname.replace(/\\/g, '/').split('/').filter(Boolean);
    if (segments.some(segment => segment === '..' || segment.startsWith('.'))) {
        respond(res, 403, 'Forbidden', req.method);
        return;
    }
    if (segments.length === 0) segments.push('index.html');

    try {
        const root = await fs.realpath(__dirname);
        const requestedPath = path.resolve(root, ...segments);
        const requestedRelativePath = path.relative(root, requestedPath);
        if (requestedRelativePath === '..' || requestedRelativePath.startsWith(`..${path.sep}`) || path.isAbsolute(requestedRelativePath)) {
            respond(res, 403, 'Forbidden', req.method);
            return;
        }

        const filePath = await fs.realpath(requestedPath);
        const actualRelativePath = path.relative(root, filePath);
        if (actualRelativePath === '..' || actualRelativePath.startsWith(`..${path.sep}`) || path.isAbsolute(actualRelativePath)) {
            respond(res, 403, 'Forbidden', req.method);
            return;
        }

        const fileInfo = await fs.stat(filePath);
        if (!fileInfo.isFile()) {
            respond(res, 404, 'Not found', req.method);
            return;
        }

        res.writeHead(200, {
            'Content-Length': fileInfo.size,
            'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
        });
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        res.end(await fs.readFile(filePath));
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
            respond(res, 404, 'Not found', req.method);
            return;
        }
        console.error('Failed to serve request:', error);
        respond(res, 500, 'Internal server error', req.method);
    }
});

server.on('error', error => {
    console.error('Development server failed:', error);
    process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
    console.log(`Wadi Bina is available at http://${HOST}:${PORT}/`);
});