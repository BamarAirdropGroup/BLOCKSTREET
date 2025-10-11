const fs = require('fs');
const axios = require('axios');
const { ethers } = require('ethers');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
};

const logger = {
  info: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[⚠] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
  step: (msg) => console.log(`\n${colors.cyan}${colors.bold}[➤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`---------------------------------------------`);
    console.log(`          BlockStreet Auto Refer Bot`);
    console.log(`---------------------------------------------${colors.reset}`);
  },
};

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Edg/120.0.0.0',
];

function randomUA() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

let proxyList = [];
let usingProxy = false;

function initializeProxy() {
  try {
    const proxies = fs.readFileSync('proxies.txt', 'utf8').trim().split('\n').filter(Boolean);
    if (proxies.length > 0) {
      proxyList = proxies.map(p => parseProxy(p.trim()));
      usingProxy = true;
      logger.warn(`Loaded ${proxyList.length} proxy(ies) from proxies.txt`);
    } else {
      logger.warn('No proxies.txt found, using no proxy');
    }
  } catch (err) {
    logger.warn('No proxies.txt found, using no proxy');
  }
}

function getRandomProxy() {
  if (!usingProxy || proxyList.length === 0) return null;
  return proxyList[Math.floor(Math.random() * proxyList.length)];
}

function parseProxy(proxyLine) {
  let proxy = proxyLine.trim();
  
  proxy = proxy.replace(/^https?:\/\//, '');
  
  if (proxy.match(/^[^:]+:[^@]+@[^:]+:\d+$/)) {
    return `http://${proxy}`;
  }
  
  const parts = proxy.split(':');
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    if (!isNaN(port)) {
      return `http://${user}:${pass}@${host}:${port}`;
    }
  }
  
  const atMatch = proxy.match(/^([^:]+):(\d+)@(.+):(.+)$/);
  if (atMatch) {
    const [, host, port, user, pass] = atMatch;
    return `http://${user}:${pass}@${host}:${port}`;
  }
  
  const complexMatch = proxy.match(/^(.+?):(.+?)@([^:]+):(\d+)$/);
  if (complexMatch) {
    const [, user, pass, host, port] = complexMatch;
    return `http://${user}:${pass}@${host}:${port}`;
  }
  
  if (parts.length === 2 && !isNaN(parts[1])) {
    return `http://${proxy}`;
  }
  
  if (proxyLine.startsWith('socks5://')) {
    return proxyLine;
  }
  
  if (proxy.includes('@')) {
    return `http://${proxy}`;
  }
  
  return `http://${proxy}`;
}

function createAxios(proxy = null, ua) {
  const config = {
    headers: {
      'User-Agent': ua,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Priority': 'u=1, i',
      'Sec-Ch-Ua': '"Brave";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'Sec-Gpc': '1',
      'Referer': 'https://blockstreet.money/',
    },
  };
  if (proxy) {
    config.httpsAgent = new HttpsProxyAgent(proxy);
  }
  return axios.create(config);
}

function extractSessionId(response) {
  const setCookies = response.headers['set-cookie'];
  if (setCookies && setCookies.length > 0) {
    const cookieStr = setCookies[0].split(';')[0];
    const parts = cookieStr.split('=');
    if (parts[0].trim() === 'gfsessionid') {
      return parts[1];
    }
  }
  return null;
}

async function solveTurnstile(apikey, sitekey, pageurl) {
  const submitUrl = 'https://api.capmonster.cloud/createTask';
  const submitData = {
    clientKey: apikey,
    task: {
      type: 'TurnstileTaskProxyless',
      websiteKey: sitekey,
      websiteUrl: pageurl
    }
  };
  let submitRes = await axios.post(submitUrl, submitData);
  if (submitRes.data.errorId !== 0) {
    throw new Error(`Captcha submit failed: ${submitRes.data.errorDescription}`);
  }
  const taskId = submitRes.data.taskId;

  const resUrl = 'https://api.capmonster.cloud/getTaskResult';
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const resData = {
      clientKey: apikey,
      taskId: taskId
    };
    let resRes = await axios.post(resUrl, resData);
    if (resRes.data.status === 'ready') {
      return resRes.data.solution.token;
    } else if (resRes.data.status === 'processing') {
      continue;
    } else {
      throw new Error(`Captcha solve failed: ${resRes.data.errorDescription}`);
    }
  }
}

function getRandomAmount() {
  return (Math.random() * (0.015 - 0.01) + 0.01).toFixed(4);
}

async function runInteractions(walletData) {
  const { address, sessionId } = walletData;
  logger.step(`Starting interactions for Wallet ${address.substring(0,10)}...`);
  const ua = randomUA();
  const proxy = getRandomProxy();
  const api = createAxios(proxy, ua);
  const baseHeaders = {
    ...api.defaults.headers,
    'Cookie': `gfsessionid=${sessionId}`,
  };

  async function apiReq(method, url, data = null) {
    const config = { method, url, headers: baseHeaders };
    if (data) {
      config.data = data;
      config.headers['Content-Type'] = 'application/json';
    }
    const res = await axios(config);
    return res;
  }

  try {
    let res = await apiReq('GET', 'https://api.blockstreet.money/api/account/assets');
    const assets = res.data.data || [];

    logger.info('User Assets:');
    assets.forEach(asset => {
      logger.info(`${asset.symbol}: Total ${asset.total_amount}, Available ${asset.available_amount}, Frozen ${asset.frozen_amount}`);
    });

    res = await apiReq('GET', 'https://api.blockstreet.money/api/swap/token_list');
    const tokens = res.data.data || [];
    const bsdToken = tokens.find(t => t.symbol === 'BSD');
    const borrowTokens = tokens.filter(t => t.type === 'B');

    if (borrowTokens.length > 0 && bsdToken) {
      const toToken = borrowTokens[Math.floor(Math.random() * borrowTokens.length)];
      const from_amount = getRandomAmount();
      const bsdAvailable = assets.find(a => a.symbol === 'BSD') ? parseFloat(assets.find(a => a.symbol === 'BSD').available_amount) : 0;
      if (bsdAvailable >= parseFloat(from_amount)) {
        const to_amount = (parseFloat(from_amount) * parseFloat(bsdToken.price) / parseFloat(toToken.price)).toFixed(6);
        res = await apiReq('POST', 'https://api.blockstreet.money/api/swap', { 
          from_symbol: 'BSD', 
          to_symbol: toToken.symbol, 
          from_amount, 
          to_amount 
        });
        if (res.data && res.data.code === 0) {
          logger.success(`Swapped ${from_amount} ${bsdToken.symbol} to ${to_amount} ${toToken.symbol}`);
        } else {
          logger.error('Swap failed');
        }
      } else {
        logger.warn('Not enough BSD for swap');
      }
    }

    const bsdAsset = assets.find(a => a.symbol === 'BSD');
    const bsdAvailable = bsdAsset ? parseFloat(bsdAsset.available_amount) : 0;
    if (bsdAvailable >= 1) {
      res = await apiReq('POST', 'https://api.blockstreet.money/api/supply', { symbol: 'BSD', amount: '1' });
      if (res.data.code === 0) {
        logger.success('Supplied 1 BSD');
      } else {
        logger.error('Supply failed');
      }
    } else {
      logger.warn('Not enough BSD available for supply');
    }

    res = await apiReq('GET', 'https://api.blockstreet.money/api/market/borrow');
    const borrowables = (res.data.data || []).filter(b => b.type === 'B');
    if (borrowables.length > 0) {
      const toBorrow = borrowables[Math.floor(Math.random() * borrowables.length)];
      const amount = getRandomAmount();
      res = await apiReq('POST', 'https://api.blockstreet.money/api/borrow', { symbol: toBorrow.symbol, amount });
      if (res.data && res.data.code === 0) {
        logger.success(`Borrowed ${amount} ${toBorrow.symbol}`);
      } else {
        logger.error('Borrow failed');
      }
    }

    res = await apiReq('GET', 'https://api.blockstreet.money/api/my/borrow');
    const myBorrows = (res.data.data || []).filter(b => b.symbol && parseFloat(b.amount) > 0);
    if (myBorrows.length > 0) {
      const toRepay = myBorrows[Math.floor(Math.random() * myBorrows.length)];
      const repayAmount = getRandomAmount();
      if (parseFloat(toRepay.amount) >= parseFloat(repayAmount)) {
        res = await apiReq('POST', 'https://api.blockstreet.money/api/repay', { symbol: toRepay.symbol, amount: repayAmount });
        if (res.data && res.data.code === 0) {
          logger.success(`Repaid ${repayAmount} ${toRepay.symbol}`);
        } else {
          logger.error('Repay failed');
        }
      }
    }

    res = await apiReq('GET', 'https://api.blockstreet.money/api/my/supply');
    const supplies = res.data.data || [];
    let bsdSupplied = 0;
    supplies.forEach(s => {
      if (s.symbol === 'BSD') {
        bsdSupplied += parseFloat(s.amount || 0);
      }
    });
    if (bsdSupplied >= 1) {
      res = await apiReq('POST', 'https://api.blockstreet.money/api/withdraw', { symbol: 'BSD', amount: '1' });
      if (res.data && res.data.code === 0) {
        logger.success('Withdrew 1 BSD');
      } else {
        logger.error('Withdraw failed');
      }
    } else {
      logger.warn('Not enough BSD supplied for withdraw');
    }
  } catch (err) {
    logger.error(`Interaction error for ${address}: ${err.message}`);
  }
}

async function createAndProcessWallet(inviteCode, apikey, sitekey, pageurl, index, total) {
  const wallet = ethers.Wallet.createRandom();
  const address = wallet.address;
  const privateKey = wallet.privateKey;
  
  logger.loading(`Creating wallet ${index}/${total} (${address})`);
  
  const ua = randomUA();
  const proxy = getRandomProxy();
  const api = createAxios(proxy, ua);

  let sessionId = null;

  try {
    let res = await api.get('https://api.blockstreet.money/api/account/signnonce', {
      headers: { ...api.defaults.headers, 'Cookie': 'gfsessionid=' }
    });
    sessionId = extractSessionId(res);
    const nonce = res.data.data.signnonce;

    const now = new Date();
    const issuedAt = now.toISOString();
    const expirationTime = new Date(now.getTime() + 120000).toISOString();
    const message = `blockstreet.money wants you to sign in with your Ethereum account:\n${address}\n\nWelcome to Block Street\n\nURI: https://blockstreet.money\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expirationTime}`;
    const signature = await wallet.signMessage(message);

    logger.loading('Solving Turnstile captcha...');
    const token = await solveTurnstile(apikey, sitekey, pageurl);

    const body = {
      address,
      nonce,
      signature,
      chainId: 1,
      issuedAt,
      expirationTime,
      invite_code: inviteCode
    };
    const postHeaders = {
      ...api.defaults.headers,
      'Content-Type': 'application/json',
      'Cf-Turnstile-Response': token,
      'Cookie': sessionId ? `gfsessionid=${sessionId}` : 'gfsessionid='
    };
    res = await axios.post('https://api.blockstreet.money/api/account/signverify', body, { headers: postHeaders });
    if (res.data.code !== 0) {
      logger.error(`Registration failed: ${JSON.stringify(res.data)}`);
      return null;
    }

    const newSessionId = extractSessionId(res);
    if (newSessionId) sessionId = newSessionId;

    const infoHeaders = {
      ...api.defaults.headers,
      'Cookie': sessionId ? `gfsessionid=${sessionId}` : 'gfsessionid='
    };
    res = await axios.get('https://api.blockstreet.money/api/account/info', { headers: infoHeaders });
    if (res.data.code === 0) {
      logger.success(`Registered wallet: ${address}`);
      
      const walletData = { address, privateKey, sessionId };
      
      const existingWallets = fs.existsSync('wallets.json') ? JSON.parse(fs.readFileSync('wallets.json', 'utf8')) : [];
      existingWallets.push(walletData);
      fs.writeFileSync('wallets.json', JSON.stringify(existingWallets, null, 2));
      
      await runInteractions(walletData);
      
      return walletData;
    }
  } catch (err) {
    logger.error(`Error processing wallet ${index}: ${err.message}`);
  }
  
  return null;
}

logger.banner();
initializeProxy();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

try {
  const inviteCode = fs.readFileSync('code.txt', 'utf8').trim();
  const apikey = fs.readFileSync('key.txt', 'utf8').trim();
  const sitekey = '0x4AAAAAABpfyUqunlqwRBYN';
  const dashboardUrl = `https://blockstreet.money/dashboard?invite_code=${inviteCode}`;
  const pageurl = dashboardUrl;

  console.log('');
  rl.question(`${colors.white}[➤] Enter number of wallets to create: ${colors.reset}`, async (numStr) => {
    const N = parseInt(numStr);
    if (isNaN(N) || N <= 0) {
      logger.error('Invalid number');
      rl.close();
      return;
    }

    for (let i = 1; i <= N; i++) {
      await createAndProcessWallet(inviteCode, apikey, sitekey, pageurl, i, N);
      
      if (i < N) {
        logger.info('Waiting 3 seconds before next wallet...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    rl.close();
    logger.success('All wallets created and interactions completed');
  });
} catch (err) {
  logger.error(`Startup error: ${err.message}`);
  rl.close();
}
