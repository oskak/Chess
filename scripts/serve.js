#!/usr/bin/env node
/**
 * Minimal static file server for the app — no dependencies, no network.
 * Usage: npm run web   (or: node scripts/serve.js [port])
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const START_PORT = parseInt(process.argv[2] || process.env.PORT || '8080', 10);
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.pgn': 'application/x-chess-pgn',
    '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
    let urlPath;
    try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (e) {
        res.writeHead(400);
        return res.end('Bad request');
    }
    if (urlPath === '/') urlPath = '/index.html';
    const file = path.normalize(path.join(ROOT, urlPath));

    // Stay inside the project and never serve dependencies or git internals
    const rel = path.relative(ROOT, file);
    if (rel.startsWith('..') || path.isAbsolute(rel) || /^(node_modules|\.git)([\\/]|$)/.test(rel)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Not found');
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Content-Length': stat.size,
            'Cache-Control': 'no-cache'
        });
        fs.createReadStream(file).pipe(res);
    });
});

// Deliberately no automatic port switching: the browser stores your
// repertoires per address (including the port), so silently moving to another
// port would make your data look like it disappeared.
server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n  Port ${START_PORT} is already in use — is the app already running in another window?`);
        console.error('  Close it, or open the address it printed. (Your data is tied to the address,');
        console.error(`  so keep using http://localhost:${START_PORT}.)\n`);
    } else {
        console.error('Could not start the server:', err.message);
    }
    process.exit(1);
});

server.listen(START_PORT, '127.0.0.1', () => {
    console.log('\n  Chess Opening Repertoire Trainer is running.\n');
    console.log(`  Open this address in your browser:  http://localhost:${START_PORT}\n`);
    console.log('  Press Ctrl+C to stop.\n');
});
