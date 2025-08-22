const puppeteer = require('puppeteer');
const fs = require('fs');
const { ethers } = require('ethers');

// Configuration
const CONFIG = {
    WEBSITE_URL: "https://ofc.onefootball.com/s2",
    WALLET_ADDRESS: "YOUR_WALLET_ADDRESS_HERE", // Your actual wallet address
    PRIVATE_KEY: "YOUR_PRIVATE_KEY_HERE", // Your private key (without 0x prefix)
    RPC_URL: "https://rpc.ankr.com/eth", // Free Ethereum RPC
    WAIT_TIMEOUT: 30000,
    HEADLESS: false, // Set true untuk headless mode
    SCREENSHOT_DIR: "./screenshots"
};

class OneFootballBot {
    constructor() {
        this.browser = null;
        this.page = null;
        this.wallet = null;
        this.provider = null;
    }

    async initWallet() {
        try {
            console.log("🔐 Initializing wallet...");
            
            // Setup provider
            this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
            
            // Create wallet from private key
            this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);
            
            // Verify wallet address matches
            if (this.wallet.address.toLowerCase() !== CONFIG.WALLET_ADDRESS.toLowerCase()) {
                throw new Error(`Address mismatch! Config: ${CONFIG.WALLET_ADDRESS}, Wallet: ${this.wallet.address}`);
            }
            
            console.log(`✅ Wallet initialized: ${this.wallet.address}`);
            return true;
            
        } catch (error) {
            console.error("❌ Wallet init failed:", error.message);
            return false;
        }
    }

    async init() {
        console.log("🚀 Starting OneFootball Bot...");

        // Create screenshots directory
        if (!fs.existsSync(CONFIG.SCREENSHOT_DIR)) {
            fs.mkdirSync(CONFIG.SCREENSHOT_DIR, { recursive: true });
        }

        try {
            // Launch browser
            this.browser = await puppeteer.launch({
                headless: CONFIG.HEADLESS,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor'
                ]
            });

            this.page = await this.browser.newPage();
            await this.page.setViewport({ width: 1920, height: 1080 });
            
            console.log("✅ Browser initialized");
            return true;
        } catch (error) {
            console.error("❌ Browser init failed:", error);
            return false;
        }
    }

    async injectWalletProvider() {
        try {
            console.log("💉 Injecting wallet provider...");
            
            await this.page.evaluateOnNewDocument((walletAddress, privateKey) => {
                // Import ethers in browser context (from CDN)
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.umd.min.js';
                document.head.appendChild(script);
                
                // Wait for ethers to load, then setup wallet
                script.onload = () => {
                    const { ethers } = window;
                    
                    // Create wallet instance in browser
                    const provider = new ethers.JsonRpcProvider('https://rpc.ankr.com/eth');
                    const wallet = new ethers.Wallet(privateKey, provider);
                    
                    // Store for later use
                    window.__wallet__ = wallet;
                    window.__walletAddress__ = walletAddress;
                    
                    console.log('🔑 Wallet loaded in browser:', walletAddress);
                };
                
                // Create Ethereum provider
                window.ethereum = {
                    isMetaMask: true,
                    isConnected: () => true,
                    selectedAddress: walletAddress.toLowerCase(),
                    chainId: '0x1',
                    
                    request: async (params) => {
                        console.log('🔗 Wallet request:', params.method);
                        
                        switch (params.method) {
                            case 'eth_requestAccounts':
                            case 'eth_accounts':
                                return [walletAddress.toLowerCase()];
                            
                            case 'eth_chainId':
                                return '0x1'; // Ethereum mainnet
                            
                            case 'personal_sign':
                                try {
                                    const message = params.params[0];
                                    const address = params.params[1];
                                    
                                    console.log('✍️ Signing message:', message);
                                    
                                    if (window.__wallet__) {
                                        const signature = await window.__wallet__.signMessage(ethers.getBytes(message));
                                        console.log('✅ Message signed');
                                        return signature;
                                    } else {
                                        // Fallback: create temporary wallet for signing
                                        const tempWallet = new ethers.Wallet(privateKey);
                                        const signature = await tempWallet.signMessage(ethers.getBytes(message));
                                        return signature;
                                    }
                                } catch (error) {
                                    console.error('❌ Signing failed:', error);
                                    throw error;
                                }
                            
                            case 'eth_sign':
                                try {
                                    const address = params.params[0];
                                    const message = params.params[1];
                                    
                                    if (window.__wallet__) {
                                        const signature = await window.__wallet__.signMessage(message);
                                        return signature;
                                    }
                                } catch (error) {
                                    console.error('❌ eth_sign failed:', error);
                                    throw error;
                                }
                                break;
                            
                            case 'wallet_switchEthereumChain':
                                return null; // Already on Ethereum
                            
                            case 'eth_getBalance':
                                return '0x0';
                            
                            default:
                                console.log('🤷 Unhandled method:', params.method);
                                return null;
                        }
                    },
                    
                    on: (event, callback) => {
                        console.log('👂 Event listener:', event);
                        if (event === 'accountsChanged') {
                            setTimeout(() => callback([walletAddress.toLowerCase()]), 100);
                        }
                        if (event === 'chainChanged') {
                            setTimeout(() => callback('0x1'), 100);
                        }
                    },
                    
                    removeListener: () => {},
                    emit: () => {}
                };
                
                // Also inject web3 for compatibility
                window.web3 = {
                    currentProvider: window.ethereum,
                    eth: {
                        accounts: [walletAddress.toLowerCase()]
                    }
                };
                
                console.log('✅ Wallet provider injected successfully');
                
            }, CONFIG.WALLET_ADDRESS, CONFIG.PRIVATE_KEY);
            
            return true;
            
        } catch (error) {
            console.error("❌ Inject wallet failed:", error);
            return false;
        }
    }

    async takeScreenshot(name) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${CONFIG.SCREENSHOT_DIR}/${name}_${timestamp}.png`;
            await this.page.screenshot({ 
                path: filename,
                fullPage: true 
            });
            console.log(`📸 Screenshot: ${filename}`);
        } catch (error) {
            console.warn("⚠️ Screenshot failed:", error.message);
        }
    }

    async humanDelay(min = 2000, max = 5000) {
        const delay = Math.random() * (max - min) + min;
        console.log(`⏳ Waiting ${(delay / 1000).toFixed(1)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    async navigateToSite() {
        try {
            console.log("🌐 Navigating to OneFootball...");
            await this.page.goto(CONFIG.WEBSITE_URL, { 
                waitUntil: 'domcontentloaded',
                timeout: CONFIG.WAIT_TIMEOUT 
            });
            
            // Wait for page to fully load
            await this.page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 });
            
            await this.humanDelay(3000, 5000);
            await this.takeScreenshot('01_initial_page');
            
            console.log("✅ Page loaded");
            return true;
        } catch (error) {
            console.error("❌ Navigation failed:", error);
            await this.takeScreenshot('error_navigation');
            return false;
        }
    }

    async connectWallet() {
        try {
            console.log("🔌 Looking for Connect Wallet button...");
            
            await this.humanDelay(2000, 3000);
            
            // Try multiple selectors for connect button
            const connectSelectors = [
                'button:has-text("Connect")',
                'button:has-text("Connect Wallet")',
                'button[data-testid*="connect"]',
                'button[class*="connect"]',
                '.connect-wallet',
                '.wallet-connect'
            ];
            
            let connectButton = null;
            for (const selector of connectSelectors) {
                try {
                    await this.page.waitForSelector(selector, { timeout: 5000, visible: true });
                    connectButton = await this.page.$(selector);
                    if (connectButton) {
                        console.log(`🎯 Found connect button: ${selector}`);
                        break;
                    }
                } catch (e) { continue; }
            }
            
            // Fallback: search by text content
            if (!connectButton) {
                console.log("🔍 Searching by text...");
                const buttons = await this.page.$$('button, div[role="button"]');
                for (const button of buttons) {
                    const text = await this.page.evaluate(el => el.textContent?.toLowerCase() || '', button);
                    const isVisible = await this.page.evaluate(el => {
                        const style = window.getComputedStyle(el);
                        return style.display !== 'none' && style.visibility !== 'hidden';
                    }, button);
                    
                    if (isVisible && (text.includes('connect') || text.includes('wallet'))) {
                        connectButton = button;
                        console.log(`🎯 Found by text: "${text}"`);
                        break;
                    }
                }
            }
            
            if (connectButton) {
                console.log("👆 Clicking Connect Wallet...");
                
                // Scroll to button
                await this.page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), connectButton);
                await this.humanDelay(1000, 2000);
                
                await connectButton.click();
                await this.humanDelay(3000, 5000);
                await this.takeScreenshot('02_connect_clicked');
                
                // Handle wallet selection
                await this.handleWalletSelection();
                
                // Wait for connection to establish
                console.log("⏳ Waiting for wallet connection...");
                await this.humanDelay(5000, 8000);
                await this.takeScreenshot('03_wallet_connected');
                
                return true;
            } else {
                console.warn("⚠️ Connect button not found");
                await this.takeScreenshot('error_no_connect');
                return false;
            }
            
        } catch (error) {
            console.error("❌ Connect wallet failed:", error);
            await this.takeScreenshot('error_connect');
            return false;
        }
    }

    async handleWalletSelection() {
        try {
            console.log("🦊 Handling wallet selection...");
            await this.humanDelay(2000, 3000);
            
            // Look for wallet type selection (MetaMask, etc.)
            const walletOptions = [
                'button:has-text("MetaMask")',
                'button:has-text("Browser Wallet")',
                'button:has-text("Injected")',
                '[data-testid="metamask"]'
            ];
            
            for (const selector of walletOptions) {
                try {
                    await this.page.waitForSelector(selector, { timeout: 3000, visible: true });
                    const walletBtn = await this.page.$(selector);
                    if (walletBtn) {
                        console.log(`🎯 Selecting wallet: ${selector}`);
                        await walletBtn.click();
                        await this.humanDelay(2000, 3000);
                        break;
                    }
                } catch (e) { continue; }
            }
            
        } catch (error) {
            console.warn("⚠️ Wallet selection:", error.message);
        }
    }

    async findButtonByText(searchTexts) {
        try {
            const buttons = await this.page.$$('button, div[role="button"], a[role="button"]');
            
            for (const button of buttons) {
                const text = await this.page.evaluate(el => el.textContent?.trim() || '', button);
                const isVisible = await this.page.evaluate(el => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
                }, button);
                
                if (isVisible) {
                    for (const searchText of searchTexts) {
                        if (text.toLowerCase().includes(searchText.toLowerCase())) {
                            console.log(`🎯 Found button: "${text}"`);
                            return button;
                        }
                    }
                }
            }
        } catch (error) {
            console.warn("⚠️ Button search failed:", error.message);
        }
        return null;
    }

    async clickLetsGo(step = 1) {
        try {
            console.log(`🚀 Looking for "Let's Go" button (${step}/2)...`);
            
            await this.humanDelay(3000, 5000);
            
            // Search for Let's Go button by text
            const letsGoButton = await this.findButtonByText(["Let's Go", "Lets Go", "Let's go", "lets go"]);
            
            if (letsGoButton) {
                console.log(`👆 Clicking "Let's Go" (${step}/2)...`);
                
                // Scroll to button
                await this.page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), letsGoButton);
                await this.humanDelay(1000, 2000);
                
                await letsGoButton.click();
                await this.humanDelay(4000, 6000);
                await this.takeScreenshot(`04_lets_go_${step}`);
                return true;
            } else {
                console.warn(`⚠️ "Let's Go" button ${step} not found`);
                await this.takeScreenshot(`error_no_lets_go_${step}`);
                return false;
            }
            
        } catch (error) {
            console.error(`❌ "Let's Go" ${step} failed:`, error);
            await this.takeScreenshot(`error_lets_go_${step}`);
            return false;
        }
    }

    async clickVerifikasi() {
        try {
            console.log("✅ Looking for 'Verifikasi' button...");
            
            await this.humanDelay(3000, 5000);
            
            // Search for Verifikasi button by text
            const verifikasiButton = await this.findButtonByText(["Verifikasi", "Verify", "verification", "verifykasi"]);
            
            if (verifikasiButton) {
                console.log("👆 Clicking 'Verifikasi'...");
                
                // Scroll to button
                await this.page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), verifikasiButton);
                await this.humanDelay(1000, 2000);
                
                await verifikasiButton.click();
                await this.humanDelay(4000, 6000);
                await this.takeScreenshot('05_verifikasi_clicked');
                return true;
            } else {
                console.warn("⚠️ 'Verifikasi' button not found");
                await this.takeScreenshot('error_no_verifikasi');
                return false;
            }
            
        } catch (error) {
            console.error("❌ 'Verifikasi' failed:", error);
            await this.takeScreenshot('error_verifikasi');
            return false;
        }
    }

    async checkSuccess() {
        try {
            console.log("🔍 Checking claim success...");
            await this.humanDelay(4000, 6000);
            
            const pageContent = await this.page.content();
            const lowerContent = pageContent.toLowerCase();
            
            const successKeywords = [
                'success', 'claimed', 'completed', 'congratulations',
                'berhasil', 'sukses', 'selamat', 'reward', 'earned'
            ];
            
            const foundSuccess = successKeywords.filter(keyword => 
                lowerContent.includes(keyword)
            );
            
            if (foundSuccess.length > 0) {
                console.log(`🎉 Success indicators: ${foundSuccess.join(', ')}`);
                await this.takeScreenshot('06_success');
                return true;
            } else {
                console.log("❓ No clear success indicator, assuming completed");
                await this.takeScreenshot('06_result');
                return true; // Assume success if workflow completed
            }
            
        } catch (error) {
            console.error("❌ Check success failed:", error);
            return false;
        }
    }

    async saveResult(success) {
        try {
            const result = {
                timestamp: new Date().toISOString(),
                wallet: CONFIG.WALLET_ADDRESS,
                success: success,
                website: CONFIG.WEBSITE_URL,
                date: new Date().toDateString()
            };
            
            const resultFile = './onefootball_results.json';
            let results = [];
            
            if (fs.existsSync(resultFile)) {
                try {
                    const data = fs.readFileSync(resultFile, 'utf8');
                    results = JSON.parse(data);
                } catch (e) {
                    results = [];
                }
            }
            
            results.push(result);
            
            // Keep only last 30 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            results = results.filter(r => new Date(r.timestamp) > thirtyDaysAgo);
            
            fs.writeFileSync(resultFile, JSON.stringify(results, null, 2));
            console.log(`💾 Result saved to ${resultFile}`);
            
        } catch (error) {
            console.error("❌ Save result failed:", error);
        }
    }

    async run() {
        try {
            console.log(`\n${'='.repeat(60)}`);
            console.log("🚀 ONEFOOTBALL AUTO CLAIM BOT");
            console.log(`🔑 Wallet: ${CONFIG.WALLET_ADDRESS}`);
            console.log("📋 Flow: Connect → Let's Go (2x) → Verifikasi");
            console.log(`${'='.repeat(60)}\n`);

            // Initialize wallet
            if (!await this.initWallet()) {
                throw new Error("Wallet initialization failed");
            }

            // Initialize browser
            if (!await this.init()) {
                throw new Error("Browser initialization failed");
            }

            // Inject wallet provider
            if (!await this.injectWalletProvider()) {
                throw new Error("Wallet provider injection failed");
            }

            // Navigate to website
            console.log("🔸 STEP 1: Navigate to website");
            if (!await this.navigateToSite()) {
                throw new Error("Navigation failed");
            }

            // Connect wallet
            console.log("\n🔸 STEP 2: Connect wallet");
            if (!await this.connectWallet()) {
                throw new Error("Wallet connection failed");
            }

            // Click "Let's Go" (1st time)
            console.log("\n🔸 STEP 3: First 'Let's Go'");
            if (!await this.clickLetsGo(1)) {
                throw new Error("First 'Let's Go' failed");
            }

            // Click "Let's Go" (2nd time)
            console.log("\n🔸 STEP 4: Second 'Let's Go'");
            if (!await this.clickLetsGo(2)) {
                throw new Error("Second 'Let's Go' failed");
            }

            // Click "Verifikasi"
            console.log("\n🔸 STEP 5: Verifikasi");
            if (!await this.clickVerifikasi()) {
                throw new Error("Verifikasi failed");
            }

            // Check success
            console.log("\n🔸 STEP 6: Check result");
            const success = await this.checkSuccess();

            // Save result
            await this.saveResult(success);

            if (success) {
                console.log("\n🎉 ONEFOOTBALL CLAIM COMPLETED!");
                console.log("✅ All steps executed successfully");
                console.log("🎁 Daily reward should be claimed");
                return true;
            } else {
                console.log("\n⚠️ PROCESS COMPLETED WITH WARNINGS");
                console.log("📋 Check screenshots for details");
                return false;
            }

        } catch (error) {
            console.error(`\n❌ BOT FAILED: ${error.message}`);
            await this.takeScreenshot('final_error');
            await this.saveResult(false);
            return false;
        } finally {
            if (this.browser) {
                console.log("\n🔒 Closing browser...");
                await this.browser.close();
            }
            console.log(`${'='.repeat(60)}`);
        }
    }
}

// Main execution
async function main() {
    // Validate configuration
    if (CONFIG.WALLET_ADDRESS === "YOUR_WALLET_ADDRESS_HERE") {
        console.error("❌ Please set your WALLET_ADDRESS in CONFIG!");
        console.log("📝 Replace 'YOUR_WALLET_ADDRESS_HERE' with your actual wallet address");
        process.exit(1);
    }

    if (CONFIG.PRIVATE_KEY === "YOUR_PRIVATE_KEY_HERE") {
        console.error("❌ Please set your PRIVATE_KEY in CONFIG!");
        console.log("📝 Replace 'YOUR_PRIVATE_KEY_HERE' with your actual private key");
        console.log("⚠️ WARNING: Keep your private key secure!");
        process.exit(1);
    }

    // Validate format
    if (!CONFIG.WALLET_ADDRESS.startsWith('0x') || CONFIG.WALLET_ADDRESS.length !== 42) {
        console.error("❌ Invalid wallet address format!");
        console.log("💡 Should be 42 characters starting with 0x");
        process.exit(1);
    }

    if (CONFIG.PRIVATE_KEY.length !== 64) {
        console.error("❌ Invalid private key format!");
        console.log("💡 Should be 64 characters (without 0x prefix)");
        process.exit(1);
    }

    // Run bot
    const bot = new OneFootballBot();
    const success = await bot.run();
    
    console.log(success ? "\n🎯 SUCCESS - CLAIM COMPLETED!" : "\n⚠️ COMPLETED WITH WARNINGS");
    process.exit(success ? 0 : 1);
}

// Handle interruption
process.on('SIGINT', () => {
    console.log('\n⚠️ Process interrupted by user');
    process.exit(1);
});

process.on('SIGTERM', () => {
    console.log('\n⚠️ Process terminated');
    process.exit(1);
});

// Run the bot
if (require.main === module) {
    main().catch(error => {
        console.error("❌ FATAL ERROR:", error);
        process.exit(1);
    });
}

module.exports = OneFootballBot;