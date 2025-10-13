const fs = require('fs');
const readline = require('readline');
const { ethers } = require('ethers');
const dotenv = require('dotenv');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

dotenv.config();

const colors = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    white: "\x1b[37m",
    bold: "\x1b[1m",
};

const logger = {
    info: (msg) => console.log(`${colors.white}[✓] ${msg}${colors.reset}`),
    warn: (msg) => console.log(`${colors.yellow}[⚠] ${msg}${colors.reset}`),
    error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
    success: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
    loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
    banner: () => {
        console.log(`${colors.cyan}${colors.bold}`);
        console.log(`----------------------------------------`);
        console.log(`  BlockStreet Bot - V1 `);
        console.log(`----------------------------------------${colors.reset}`);
        console.log();
    }
};

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
];

function randomUA() {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function parseProxy(proxyLine) {
    let proxy = proxyLine.trim();
    if (!proxy) return null;
    proxy = proxy.replace(/^https?:\/\//, '');
    const specialMatch = proxy.match(/^([^:]+):(\d+)@(.+):(.+)$/);
    if (specialMatch) {
        const [, host, port, user, pass] = specialMatch;
        return `http://${user}:${pass}@${host}:${port}`;
    }
    const parts = proxy.split(':');
    if (parts.length === 4 && !isNaN(parts[1])) {
        const [host, port, user, pass] = parts;
        return `http://${user}:${pass}@${host}:${port}`;
    }
    return `http://${proxy}`;
}

function readAndParseProxies(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    return lines.map(line => parseProxy(line)).filter(Boolean);
}

async function solveTurnstile(sitekey, pageurl) {
    logger.loading('Solving Cloudflare Turnstile captcha...');
    let apikey;
    try {
        apikey = fs.readFileSync('key.txt', 'utf8').trim();
        if (!apikey) throw new Error('CapMonster API key is missing or empty in key.txt.');
    } catch (error) {
        throw new Error('Failed to read CapMonster API key from key.txt: ' + error.message);
    }
    const submitUrl = 'https://api.capmonster.cloud/createTask';
    const submitData = {
        clientKey: apikey,
        task: {
            type: 'TurnstileTaskProxyless',
            websiteKey: sitekey,
            websiteUrl: pageurl
        }
    };
    try {
        const submitRes = await axios.post(submitUrl, submitData);
        if (submitRes.data.errorId !== 0) throw new Error(`CapMonster submit failed: ${submitRes.data.errorDescription}`);
        const taskId = submitRes.data.taskId;
        const resUrl = 'https://api.capmonster.cloud/getTaskResult';
        while (true) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const resData = {
                clientKey: apikey,
                taskId: taskId
            };
            const resRes = await axios.post(resUrl, resData);
            if (resRes.data.status === 'ready') {
                logger.success('Captcha solved successfully!');
                return resRes.data.solution.token;
            }
            if (resRes.data.status === 'processing') {
                logger.loading('Captcha not ready, waiting...');
                continue;
            }
            throw new Error(`CapMonster solve failed: ${resRes.data.errorDescription}`);
        }
    } catch (error) {
        throw new Error(`Captcha solving process error: ${error.message}`);
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (query) => new Promise(resolve => rl.question(query, resolve));
const closeRl = () => rl.close();

const getRandomAmount = (min, max) => Math.random() * (max - min) + min;
const randomDelay = async () => await sleep(getRandomAmount(5000, 10000));

const countdown = async (seconds) => {
    let remaining = seconds;
    while (remaining > 0) {
        const h = Math.floor(remaining / 3600).toString().padStart(2, '0');
        const m = Math.floor((remaining % 3600) / 60).toString().padStart(2, '0');
        const s = Math.floor(remaining % 60).toString().padStart(2, '0');
        process.stdout.write(`${colors.cyan}[⏳] Next run in: ${h}:${m}:${s} ...${colors.reset}\r`);
        remaining--;
        await sleep(1000);
    }
    console.log('\n');
};

class BlockStreetAPI {
    constructor(wallet, proxy = null) {
        this.wallet = wallet;
        this.sessionCookie = null;
        let agent = null;
        if (proxy) {
            try {
                agent = new HttpsProxyAgent(proxy);
            } catch (e) {
                logger.error(`Failed to create proxy agent for "${proxy}". Error: ${e.message}`);
            }
        }
        this.axios = axios.create({
            baseURL: 'https://api.blockstreet.money/api',
            httpsAgent: agent,
            headers: { "accept": "application/json, text/plain, */*", "accept-language": "en-US,en;q=0.9", "priority": "u=1, i", "sec-ch-ua": "\"Brave\";v=\"141\", \"Not?A_Brand\";v=\"8\", \"Chromium\";v=\"141\"", "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": "\"Windows\"", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-site", "sec-gpc": "1", "Referer": "https://blockstreet.money/" }
        });
    }

    async #sendRequest(config, requiresAuth = true) {
        config.headers = { ...config.headers, 'User-Agent': randomUA() };
        config.headers['Cookie'] = requiresAuth ? (this.sessionCookie || '') : 'gfsessionid=';
        try {
            const response = await this.axios(config);
            if (response.headers['set-cookie']) {
                const sessionCookie = response.headers['set-cookie'].find(c => c.startsWith('gfsessionid='));
                if (sessionCookie) this.sessionCookie = sessionCookie.split(';')[0];
            }
            if (response.data.code !== 0) throw new Error(response.data.message || response.data.msg || 'API error');
            return response.data.data;
        } catch (error) {
            throw new Error(error.response?.data?.message || error.response?.data?.msg || error.message);
        }
    }

    async login(captchaToken) {
        try {
            if (!captchaToken) throw new Error("Captcha token is required for login.");
            const { signnonce: nonce } = await this.#sendRequest({ url: '/account/signnonce', method: 'GET' }, false);
            const issuedAt = new Date();
            const expirationTime = new Date(issuedAt.getTime() + 2 * 60 * 1000);
            const message = `blockstreet.money wants you to sign in with your Ethereum account:\n${this.wallet.address}\n\nWelcome to Block Street\n\nURI: https://blockstreet.money\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${issuedAt.toISOString()}\nExpiration Time: ${expirationTime.toISOString()}`;
            const signature = await this.wallet.signMessage(message);
            const payload = { address: this.wallet.address, nonce, signature, chainId: 1, issuedAt: issuedAt.toISOString(), expirationTime: expirationTime.toISOString(), invite_code: '' };
            const config = { baseURL: this.axios.defaults.baseURL, url: '/account/signverify', method: 'POST', headers: { ...this.axios.defaults.headers, 'Content-Type': 'application/json', 'Cf-Turnstile-Response': captchaToken, 'Cookie': this.sessionCookie || '', 'User-Agent': randomUA() }, httpsAgent: this.axios.defaults.httpsAgent, data: payload };
            const response = await axios(config);
            if (response.headers['set-cookie']) {
                const sessionCookie = response.headers['set-cookie'].find(c => c.startsWith('gfsessionid='));
                if (sessionCookie) { this.sessionCookie = sessionCookie.split(';')[0]; }
            }
            if (response.data.code !== 0) throw new Error(response.data.message || 'Sign verify failed');
            return response.data.data;
        } catch (error) {
            throw new Error(`Login failed: ${error.message}`);
        }
    }
    
    getTokenList() { return this.#sendRequest({ url: '/swap/token_list', method: 'GET' }); }
    share() { return this.#sendRequest({ url: '/share', method: 'POST' }); }
    swap(f, t, fa, ta) { return this.#sendRequest({ url: '/swap', method: 'POST', data: { from_symbol: f, to_symbol: t, from_amount: String(fa), to_amount: String(ta) }, headers: { 'content-type': 'application/json' }}); }
    supply(s, a) { return this.#sendRequest({ url: '/supply', method: 'POST', data: { symbol: s, amount: String(a) }, headers: { 'content-type': 'application/json' }}); }
    withdraw(s, a) { return this.#sendRequest({ url: '/withdraw', method: 'POST', data: { symbol: s, amount: String(a) }, headers: { 'content-type': 'application/json' }}); }
    borrow(s, a) { return this.#sendRequest({ url: '/borrow', method: 'POST', data: { symbol: s, amount: String(a) }, headers: { 'content-type': 'application/json' }}); }
    repay(s, a) { return this.#sendRequest({ url: '/repay', method: 'POST', data: { symbol: s, amount: String(a) }, headers: { 'content-type': 'application/json' }}); }
    getEarnInfo() { return this.#sendRequest({ url: '/earn/info', method: 'GET' }); }
    getSupplies() { return this.#sendRequest({ url: '/my/supply', method: 'GET' }); }
}

const forEachWallet = async (wallets, proxies, numTransactions, taskFunction, captchaToken) => {
    let proxyIndex = 0;
    for (const wallet of wallets) {
        const proxy = proxies.length > 0 ? proxies[proxyIndex++ % proxies.length] : null;
        logger.info(`Processing wallet: ${wallet.address}`);
        const api = new BlockStreetAPI(wallet, proxy);
        try {
            await api.login(captchaToken);
            logger.success(`Wallet ${wallet.address} logged in successfully.`);
            for (let i = 0; i < numTransactions; i++) {
                logger.info(`--- Running transaction ${i + 1} of ${numTransactions} ---`);
                await taskFunction(api);
                await sleep(1000);
            }
        } catch (error) {
            logger.error(`Could not process task for wallet ${wallet.address}: ${error.message}`);
        }
        await sleep(3000);
    }
};

const processWalletsForDailyRun = async (wallets, proxies, tokenList, numTransactions) => {
    let proxyIndex = 0;
    for (const [index, wallet] of wallets.entries()) {
        const proxy = proxies.length > 0 ? proxies[proxyIndex++ % proxies.length] : null;
        logger.info(`${colors.yellow}--- Processing Wallet ${index + 1}/${wallets.length}: ${wallet.address} ---${colors.reset}`);
        const api = new BlockStreetAPI(wallet, proxy);
        
        // Solve captcha for each wallet in daily run
        let captchaToken;
        try {
            captchaToken = await solveTurnstile('0x4AAAAAABpfyUqunlqwRBYN', 'https://blockstreet.money/dashboard');
            if (!captchaToken) throw new Error("Failed to solve captcha for daily run");
        } catch (error) {
            logger.error(`Captcha solving failed for wallet ${wallet.address}: ${error.message}. Skipping.`);
            continue;
        }
        
        try {
            await api.login(captchaToken);
            logger.success(`Wallet ${wallet.address} logged in successfully.`);
            
            // Daily share at the beginning of each wallet cycle
            logger.loading("Executing daily share...");
            try {
                await api.share();
                logger.success("Daily share completed successfully.");
            } catch (e) {
                logger.error(`Daily share failed: ${e.message}`);
            }
            
        } catch (e) {
            logger.error(`Login failed for wallet ${wallet.address}: ${e.message}. Skipping.`);
            continue;
        }
        
        for (let i = 0; i < numTransactions; i++) {
            logger.info(`--- Starting Transaction Cycle ${i + 1} of ${numTransactions} ---`);
            let supplies = [];
            try { supplies = await api.getSupplies(); } 
            catch (e) { logger.error(`      Could not fetch supplies: ${e.message}`); }

            logger.loading("Executing 5 swaps...");
            const ownedTokens = supplies.filter(a => parseFloat(a.amount) > 0);
            if (ownedTokens.length === 0) {
                logger.warn("No supplied assets found to swap from. Skipping swaps.");
            } else {
                for (let j = 0; j < 5; j++) {
                    try {
                        const fromTokenAsset = ownedTokens[Math.floor(Math.random() * ownedTokens.length)];
                        const fromToken = tokenList.find(t => t.symbol === fromTokenAsset.symbol);
                        if (!fromToken) continue;
                        let toToken;
                        do { toToken = tokenList[Math.floor(Math.random() * tokenList.length)]; } while (toToken.symbol === fromToken.symbol);
                        const fromAmount = getRandomAmount(0.001, 0.0015);
                        const toAmount = (fromAmount * parseFloat(fromToken.price)) / parseFloat(toToken.price);
                        await api.swap(fromToken.symbol, toToken.symbol, fromAmount.toFixed(8), toAmount.toFixed(8));
                        logger.success(`Swap #${j+1}: ${fromAmount.toFixed(5)} ${fromToken.symbol} -> ${toAmount.toFixed(5)} ${toToken.symbol} successful.`);
                    } catch (e) {
                        logger.error(`Swap #${j+1} failed: ${e.message}`);
                    }
                    await randomDelay();
                }
            }
            const actions = [ { name: 'Supply', count: 2, func: api.supply.bind(api) }, { name: 'Withdraw', count: 2, func: api.withdraw.bind(api) }, { name: 'Borrow', count: 2, func: api.borrow.bind(api) }, { name: 'Repay', count: 1, func: api.repay.bind(api) } ];
            for (const action of actions) {
                logger.loading(` Executing ${action.count} ${action.name}(s)...`);
                for (let j = 0; j < action.count; j++) {
                    try {
                        const randomToken = tokenList[Math.floor(Math.random() * tokenList.length)];
                        const amount = getRandomAmount(0.001, 0.0015);
                        await action.func(randomToken.symbol, amount.toFixed(8));
                        logger.success(`${action.name} #${j+1}: ${amount.toFixed(5)} ${randomToken.symbol} successful.`);
                    } catch (e) {
                        logger.error(`${action.name} #${j+1} failed: ${e.message}`);
                    }
                    await randomDelay();
                }
            }
        }
        logger.success(`All cycles completed for wallet ${wallet.address}.`);
        await sleep(5000);
    }
};

const runAllDaily = async (wallets, proxies, tokenList) => {
    logger.info("You chose: Run All Features Daily");
    const numTransactionsStr = await question("How many transaction cycles to run per wallet? ");
    const numTransactions = parseInt(numTransactionsStr, 10);
    if (isNaN(numTransactions) || numTransactions < 1) {
        logger.error("Invalid number. Returning to menu.");
        return;
    }
    logger.info(`Will run ${numTransactions} cycle(s) per wallet.`);
    while (true) {
        await processWalletsForDailyRun(wallets, proxies, tokenList, numTransactions);
        logger.success("Daily run completed for all wallets.");
        await countdown(24 * 60 * 60);
    }
};

const displayAndSelectToken = async (tokenList, promptMessage) => {
    console.log(colors.cyan + promptMessage + colors.reset);
    tokenList.forEach((token, index) => console.log(`${index + 1}. ${token.symbol}`));
    const choiceIndex = parseInt(await question('> '), 10) - 1;
    return (choiceIndex >= 0 && choiceIndex < tokenList.length) ? tokenList[choiceIndex] : null;
};

const main = async () => {
    logger.banner();
    const proxies = readAndParseProxies('proxies.txt');
    if (proxies.length > 0) logger.info(`${proxies.length} valid proxies loaded.`);
    const wallets = Object.keys(process.env).filter(key => key.startsWith('PRIVATE_KEY_') && process.env[key]).map(key => { try { return new ethers.Wallet(process.env[key]); } catch { logger.warn(`Could not load wallet from ${key}.`); return null; } }).filter(Boolean);
    if (wallets.length === 0) {
        logger.error('No valid private keys found in .env file. Exiting.');
        closeRl(); return;
    }
    logger.success(`Loaded ${wallets.length} wallet(s) from .env file.\n`);
    
    // Get token list first without captcha
    let tokenList = [];
    try {
        const firstWallet = wallets[0];
        const firstProxy = proxies.length > 0 ? proxies[0] : null;
        const firstApi = new BlockStreetAPI(firstWallet, firstProxy);
        logger.loading("Fetching available token list...");
        tokenList = await firstApi.getTokenList();
        logger.success("Token list fetched successfully.");
    } catch (error) {
        logger.error(`Failed to fetch token list: ${error.message}`);
        closeRl(); return;
    }
    
    while (true) {
        console.log('\n' + colors.bold + colors.cyan + '--- CHOOSE A FEATURE TO RUN ---' + colors.reset);
        const choice = await question(`1. Swap Token\n2. Supply Token\n3. Withdraw Token\n4. Borrow Token\n5. Repay Token\n6. Run All Features Daily\n7. Exit\n> `);
        
        if (choice === '7') { 
            logger.info("Exiting bot. Goodbye!"); 
            closeRl(); 
            return; 
        }
        
        if (choice === '6') {
            await runAllDaily(wallets, proxies, tokenList);
            continue;
        }
        
        // For other features, solve captcha after menu selection
        let captchaToken;
        try {
            captchaToken = await solveTurnstile('0x4AAAAAABpfyUqunlqwRBYN', 'https://blockstreet.money/dashboard');
            if (!captchaToken) throw new Error("Failed to solve captcha");
        } catch (error) {
            logger.error(`Could not solve captcha: ${error.message}`);
            continue;
        }
        
        let action, taskFunction;
        if (choice === '1') {
            action = 'Swap';
            const fromToken = await displayAndSelectToken(tokenList, "Select token to swap FROM:");
            if (!fromToken) { logger.error("Invalid 'from' token selection."); continue; }
            const toToken = await displayAndSelectToken(tokenList, "Select token to swap TO:");
            if (!toToken) { logger.error("Invalid 'to' token selection."); continue; }
            if (fromToken.symbol === toToken.symbol) { logger.error("Cannot swap to the same token."); continue; }
            const fromAmount = parseFloat(await question(`Amount of ${fromToken.symbol} to swap: `));
            taskFunction = async (api) => {
                try {
                    const toAmount = (fromAmount * parseFloat(fromToken.price)) / parseFloat(toToken.price);
                    await api.swap(fromToken.symbol, toToken.symbol, fromAmount, toAmount.toFixed(8));
                    logger.success(`   Swap ${fromAmount} ${fromToken.symbol} -> ${toAmount.toFixed(5)} ${toToken.symbol} successful.`);
                } catch (e) { logger.error(`   Swap failed: ${e.message}`); }
            };
        } else {
            switch (choice) {
                case '2': action = 'Supply'; break;
                case '3': action = 'Withdraw'; break;
                case '4': action = 'Borrow'; break;
                case '5': action = 'Repay'; break;
                default: logger.error("Invalid choice."); continue;
            }
            const selectedToken = await displayAndSelectToken(tokenList, `Select a token to ${action}:`);
            if (!selectedToken) { logger.error("Invalid token selection."); continue; }
            const amount = await question(`Amount of ${selectedToken.symbol} to ${action}: `);
            taskFunction = async (api) => {
                try {
                    await api[action.toLowerCase()](selectedToken.symbol, amount);
                    logger.success(`   ${action} ${amount} ${selectedToken.symbol} successful.`);
                } catch (e) { logger.error(`   ${action} failed: ${e.message}`); }
            };
        }
        
        const numTransactionsStr = await question(`How many times to run per wallet? `);
        const numTransactions = parseInt(numTransactionsStr, 10);
        if (isNaN(numTransactions) || numTransactions < 1) { 
            logger.error("Invalid number."); 
            continue; 
        }
        
        await forEachWallet(wallets, proxies, numTransactions, taskFunction, captchaToken);
        logger.info(`${action} task has been run on all wallets. Returning to menu.`);
    }
};

main().catch(err => {
    logger.error('A critical error occurred: ' + err.message);
    closeRl();
});
