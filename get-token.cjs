const crypto = require('crypto');
const https = require('https');

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("FIREBASE_SERVICE_ACCOUNT env var not set");
  process.exit(1);
}

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

const iat = Math.floor(Date.now() / 1000);
const exp = iat + 3600;

const header = { alg: 'RS256', typ: 'JWT' };
const claim = {
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/cloud-platform',
  aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
  exp: exp,
  iat: iat
};

const base64UrlEncode = (str) => {
  return Buffer.from(str).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

const jwtHeader = base64UrlEncode(JSON.stringify(header));
const jwtClaim = base64UrlEncode(JSON.stringify(claim));

const signatureInput = `${jwtHeader}.${jwtClaim}`;
const signer = crypto.createSign('RSA-SHA256');
signer.update(signatureInput);
const signature = signer.sign(sa.private_key, 'base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

const jwt = `${signatureInput}.${signature}`;

const postData = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;
const url = new URL(sa.token_uri || 'https://oauth2.googleapis.com/token');

const req = https.request({
  hostname: url.hostname,
  port: 443,
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(postData)
  }
}, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      if (data.access_token) {
        console.log(data.access_token);
        process.exit(0);
      } else {
        console.error("Token response error:", data);
        process.exit(1);
      }
    } catch (e) {
      console.error("Failed to parse response:", body);
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error("HTTP Request Error:", e);
  process.exit(1);
});

req.write(postData);
req.end();
