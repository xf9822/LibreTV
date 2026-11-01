import path from 'path';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import dns from 'dns';
import net from 'net';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  port: process.env.PORT || 8080,
  password: process.env.PASSWORD || '',
  passwordHash: process.env.PASSWORD_HASH || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  timeout: parseInt(process.env.REQUEST_TIMEOUT || '5000'),
  maxRetries: parseInt(process.env.MAX_RETRIES || '2'),
  cacheMaxAge: process.env.CACHE_MAX_AGE || '1d',
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  debug: process.env.DEBUG === 'true'
};

const log = (...args) => {
  if (config.debug) {
    console.log('[DEBUG]', ...args);
  }
};

const app = express();

app.use(cors({
  origin: config.corsOrigin,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

function sha256Hash(input) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    hash.update(input);
    resolve(hash.digest('hex'));
  });
}

// 页面里注入的密码哈希：优先用 PASSWORD_HASH（不留明文的部署方式），否则由 PASSWORD 计算
async function pagePasswordHash() {
  const configuredHash = config.passwordHash.trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(configuredHash)) return configuredHash;
  return config.password !== '' ? sha256Hash(config.password) : '';
}

async function renderPage(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.replace('{{PASSWORD}}', await pagePasswordHash());
}

// 页面每次都向服务器确认，发版后不会拿到旧页面配新脚本
function sendPage(res, content) {
  res.setHeader('Cache-Control', 'no-cache');
  res.send(content);
}

app.get(['/', '/index.html', '/player.html', '/diagnostics.html'], async (req, res) => {
  try {
    let filePath;
    switch (req.path) {
      case '/player.html':
        filePath = path.join(__dirname, 'player.html');
        break;
      case '/diagnostics.html':
        filePath = path.join(__dirname, 'diagnostics.html');
        break;
      default: // '/' 和 '/index.html'
        filePath = path.join(__dirname, 'index.html');
        break;
    }
    
    const content = await renderPage(filePath);
    sendPage(res, content);
  } catch (error) {
    console.error('页面渲染错误:', error);
    res.status(500).send('读取静态页面失败');
  }
});

app.get('/s=:keyword', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'index.html');
    const content = await renderPage(filePath);
    sendPage(res, content);
  } catch (error) {
    console.error('搜索页面渲染错误:', error);
    res.status(500).send('读取静态页面失败');
  }
});

// 内网与保留地址：代理不能被用来访问服务器所在的内网或云厂商的元数据接口。
// 224.0.0.0/4 不在其中：设置 PROXY_URL 时 proxychains 的 proxy_dns 会把域名解析成这个网段的占位地址。
function isPrivateAddress(address) {
  let ip = String(address || '').toLowerCase();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  }
  return false;
}

const usesEnvProxy = Boolean(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy);

// 每次建立连接（包括跳转后的地址）都检查解析出的 IP，域名指向内网或跳转到内网都会被拒绝
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
      return callback(new Error('目标地址指向内网，已拒绝'));
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

// 代理返回的内容出现在本站域名下：上游网页或脚本不能在这里运行，也不能写 Cookie、注册
// Service Worker。网页 / 脚本类内容改成纯文本（前端用 fetch 读取不受影响），并统一加上沙箱。
const DROPPED_PROXY_HEADERS = new Set([
  'set-cookie', 'service-worker-allowed', 'clear-site-data', 'refresh', 'link',
  'content-security-policy', 'x-frame-options', 'access-control-allow-origin',
  // 上游压缩过的内容已被解压、改成分块传输，原来的长度与编码不再适用
  'content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive'
]);

function proxyResponseHeaders(upstreamHeaders) {
  const extra = (process.env.FILTERED_HEADERS || '').split(',').map(name => name.trim().toLowerCase()).filter(Boolean);
  const headers = {};
  for (const [key, value] of Object.entries(upstreamHeaders || {})) {
    const lowerKey = key.toLowerCase();
    if (DROPPED_PROXY_HEADERS.has(lowerKey) || extra.includes(lowerKey) || value === undefined) continue;
    headers[lowerKey] = value;
  }
  const contentType = String(headers['content-type'] || '');
  if (/html|xml|javascript|ecmascript/i.test(contentType) && !/svg/i.test(contentType)) {
    headers['content-type'] = 'text/plain; charset=utf-8';
  }
  headers['x-content-type-options'] = 'nosniff';
  headers['content-security-policy'] = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";
  return headers;
}

function isValidUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    const allowedProtocols = ['http:', 'https:'];
    
    // 从环境变量获取阻止的主机名列表
    const blockedHostnames = (process.env.BLOCKED_HOSTS || 'localhost,127.0.0.1,0.0.0.0,::1').split(',');
    
    // 从环境变量获取阻止的 IP 前缀
    const blockedPrefixes = (process.env.BLOCKED_IP_PREFIXES || '192.168.,10.,172.').split(',');
    
    if (!allowedProtocols.includes(parsed.protocol)) return false;
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    if (blockedHostnames.includes(parsed.hostname) || blockedHostnames.includes(hostname)) return false;
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || isPrivateAddress(hostname)) return false;
    
    for (const prefix of blockedPrefixes) {
      if (parsed.hostname.startsWith(prefix)) return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

function getTargetReferer(targetUrl) {
  const target = new URL(targetUrl);
  if (target.hostname.endsWith('doubanio.com')) {
    return 'https://movie.douban.com/';
  }
  return `${target.origin}/`;
}

// 验证代理请求的鉴权
function validateProxyAuth(req) {
  const authHash = req.query.auth;
  const timestamp = req.query.t;
  
  // 获取服务器端密码哈希
  const serverPassword = config.password;
  const configuredPasswordHash = config.passwordHash.trim().toLowerCase();
  const acceptedHashes = new Set();

  if (/^[a-f0-9]{64}$/.test(configuredPasswordHash)) {
    acceptedHashes.add(configuredPasswordHash);
  }

  if (!serverPassword && acceptedHashes.size === 0) {
    console.error('服务器未设置 PASSWORD 环境变量，代理访问被拒绝');
    return false;
  }
  
  // 使用 crypto 模块计算 SHA-256 哈希
  const serverPasswordHash = crypto.createHash('sha256').update(serverPassword).digest('hex');
  if (serverPassword) {
    acceptedHashes.add(serverPasswordHash);
    if (/^[a-f0-9]{64}$/i.test(serverPassword)) {
      acceptedHashes.add(serverPassword.toLowerCase());
    }
  }
  
  if (!authHash || !acceptedHashes.has(authHash.toLowerCase())) {
    console.warn('代理请求鉴权失败：密码哈希不匹配');
    if (config.debug) {
      console.debug('代理请求鉴权失败：参数摘要', {
        hasAuth: Boolean(authHash),
        authLength: authHash ? String(authHash).length : 0,
        configuredHashLength: configuredPasswordHash.length,
        acceptedHashCandidates: acceptedHashes.size
      });
    }
    return false;
  }
  
  // 验证时间戳（10分钟有效期）
  if (timestamp) {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10分钟
    if (now - parseInt(timestamp) > maxAge) {
      console.warn('代理请求鉴权失败：时间戳过期');
      return false;
    }
  }
  
  return true;
}

app.get('/proxy/:encodedUrl', async (req, res) => {
  try {
    // 验证鉴权
    if (!validateProxyAuth(req)) {
      return res.status(401).json({
        success: false,
        error: '代理访问未授权：请检查密码配置或鉴权参数'
      });
    }

    // Express 已经解码过路径参数，这里不能再解码一次，否则地址里的 %2B、%26 等会被改坏
    const targetUrl = req.params.encodedUrl;
    const probe = req.query.probe === '1';
    const range = String(req.headers.range || '');
    // 测速只读开头至多 2 MiB，与 Cloudflare 版代理一致
    if (probe) {
      const rangeEnd = /^bytes=0-(\d+)$/.exec(range);
      if (!rangeEnd || Number(rangeEnd[1]) > 2097151) {
        return res.status(400).set('Cache-Control', 'no-store').send('无效的测速范围');
      }
    }

    // 安全验证
    if (!isValidUrl(targetUrl)) {
      return res.status(400).send('无效的 URL');
    }

    log(`代理请求: ${targetUrl}`);

    // 添加请求超时和重试逻辑
    const maxRetries = config.maxRetries;
    let retries = 0;
    
    const makeRequest = async () => {
      try {
        return await axios({
          method: 'get',
          url: targetUrl,
          responseType: 'stream',
          timeout: config.timeout,
          // 通过 HTTP(S)_PROXY 出站时目标由代理解析，这里只能检查地址本身
          ...(usesEnvProxy ? {} : { lookup: safeLookup }),
          maxRedirects: 5,
          headers: {
            'User-Agent': config.userAgent,
            'Referer': getTargetReferer(targetUrl),
            'Accept': '*/*',
            // 拖动 MP4 进度与测速都依赖分段请求
            ...(range ? { Range: range } : {})
          }
        });
      } catch (error) {
        if (retries < maxRetries) {
          retries++;
          log(`重试请求 (${retries}/${maxRetries}): ${targetUrl}`);
          return makeRequest();
        }
        throw error;
      }
    };

    const response = await makeRequest();

    // 转发响应头（过滤敏感头）
    const headers = proxyResponseHeaders(response.headers);
    if (probe) headers['cache-control'] = 'no-store';
    res.status(response.status);
    res.set(headers);

    // 管道传输响应流
    response.data.pipe(res);
  } catch (error) {
    console.error('代理请求错误:', error.message);
    if (error.response) {
      res.status(error.response.status || 500);
      res.set(proxyResponseHeaders(error.response.headers));
      error.response.data.pipe(res);
    } else {
      res.status(500).send(`请求失败: ${error.message}`);
    }
  }
});

// 第三方库与图片很少变，可以长缓存；本站的页面、脚本、样式和 Service Worker 每次都要确认，
// 否则发版后浏览器会把新页面和缓存里的旧脚本混在一起用。
app.use(express.static(path.join(__dirname), {
  maxAge: config.cacheMaxAge,
  setHeaders(res, filePath) {
    const relative = path.relative(__dirname, filePath).split(path.sep).join('/');
    if (!relative.startsWith('libs/') && !relative.startsWith('image/')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).send('服务器内部错误');
});

app.use((req, res) => {
  res.status(404).send('页面未找到');
});

// 启动服务器
app.listen(config.port, () => {
  console.log(`服务器运行在 http://localhost:${config.port}`);
  if (config.password !== '') {
    console.log('用户登录密码已设置');
  } else {
    console.log('警告: 未设置 PASSWORD 环境变量，用户将被要求设置密码');
  }
  if (config.debug) {
    console.log('调试模式已启用');
    console.log('配置:', { ...config, password: config.password ? '******' : '' });
  }
});
