const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = 8084;
const TARGET = 'https://pro.aave.com';

app.use(cors());

app.use((req, res, next) => {
  if (req.path === '/' || (req.headers.accept && req.headers.accept.includes('text/html'))) {
    res.sendFile(path.join(process.cwd(), 'index.html'));
  } else {
    next();
  }
});

// Serve Legion inject script before proxy
app.get('/legion-proxy-inject.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(process.cwd(), 'legion-proxy-inject.js'));
});

// Serve inject script before proxy middleware
app.get('/legion-proxy-inject.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(process.cwd(), 'legion-proxy-inject.js'));
});

// Proxy setup
const onProxyReq = function(proxyReq, req, res) {
    proxyReq.removeHeader('x-forwarded-for');
    proxyReq.removeHeader('x-forwarded-host');
    proxyReq.removeHeader('x-forwarded-proto');
    proxyReq.removeHeader('x-vercel-id');
    proxyReq.removeHeader('x-vercel-forwarded-for');
    proxyReq.removeHeader('x-vercel-deployment-url');
    proxyReq.removeHeader('x-real-ip');

    proxyReq.setHeader('origin', TARGET);
    proxyReq.setHeader('referer', TARGET + '/');
    proxyReq.setHeader('host', 'pro.aave.com');
};

const onProxyRes = function(proxyRes, req, res) {
    proxyRes.headers['access-control-allow-origin'] = '*';
    delete proxyRes.headers['content-security-policy'];
    delete proxyRes.headers['content-security-policy-report-only'];
};

app.use('/', createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    secure: false,
    onProxyReq: onProxyReq,
    onProxyRes: onProxyRes
}));

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Aave proxy running at http://localhost:${PORT}`);
    });
}
module.exports = app;
