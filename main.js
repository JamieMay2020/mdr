const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs');
require('dotenv').config(); // Load .env file

// Import Solana dependencies
const { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
  SystemProgram
} = require("@solana/web3.js");
const { PumpSdk, getBuyTokenAmountFromSolAmount } = require("@pump-fun/pump-sdk");
const BN = require("bn.js");
const bs58 = require("bs58");
const FormData = require("form-data");

// Load configuration from .env
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || "YOUR_PRIVATE_KEY_HERE";
const COIN_LOGOS_FOLDER = process.env.COIN_LOGOS_FOLDER || "C:/coin-logos";
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";
const RPC_COMMITMENT = process.env.RPC_COMMITMENT || "processed";
const GLOBAL_STATE_CACHE_MS = parseInt(process.env.GLOBAL_STATE_CACHE_MS) || 30000;

// Your Cloudflare Worker URL
const CLOUDFLARE_WORKER_URL = 'https://workers-playground-bold-tooth-cee5.jake-98f.workers.dev';

// Pre-initialized launcher components
let connection;
let sdk;
let wallet;
let globalState;
let globalStateTimestamp = 0;

// Pre-compute common instructions
const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
  units: 250_000,
});

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 850,
        height: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: '#0a0a0a',
        frame: false, // Remove default frame
        resizable: false,
        alwaysOnTop: true
    });

    mainWindow.loadFile('index.html');
    
    // Open DevTools for debugging
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    // Initialize launcher components
    initializeLauncher();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Initialize launcher components for speed
function initializeLauncher() {
    try {
        // Check if private key is set
        if (WALLET_PRIVATE_KEY === "YOUR_PRIVATE_KEY_HERE") {
            console.error("❌ Please set your private key in main.js!");
            console.error("Replace YOUR_PRIVATE_KEY_HERE with your actual wallet private key");
            return;
        }
        
        // Initialize wallet
        wallet = Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY));
        console.log(`✅ Wallet loaded: ${wallet.publicKey.toBase58()}`);
        
        // Initialize connection with optimized settings
        connection = new Connection(RPC_ENDPOINT, {
            commitment: RPC_COMMITMENT,
            confirmTransactionInitialTimeout: 30000
        });
        
        // Initialize SDK
        sdk = new PumpSdk(connection);
        
        // Pre-fetch global state after a delay to ensure SDK is ready
        setTimeout(() => {
            refreshGlobalState();
        }, 1000);
        
        // Keep connection alive
        setInterval(() => {
            if (connection) {
                connection.getSlot().catch(() => {});
            }
        }, 10000);
        
        // Refresh global state periodically
        setInterval(() => {
            if (sdk) {
                refreshGlobalState();
            }
        }, GLOBAL_STATE_CACHE_MS);
        
        console.log('🚀 Fast launcher initialized');
        console.log(`☁️ Using Cloudflare Worker: ${CLOUDFLARE_WORKER_URL}`);
    } catch (error) {
        console.error('Failed to initialize launcher:', error);
        console.error('Make sure you have set your private key correctly!');
    }
}

async function refreshGlobalState() {
    try {
        if (!sdk) {
            console.error("SDK not initialized");
            return;
        }
        globalState = await sdk.fetchGlobal();
        globalStateTimestamp = Date.now();
        console.log("📊 Global state refreshed");
    } catch (error) {
        console.error("Error refreshing global state:", error);
    }
}

async function getGlobalState() {
    if (globalState && (Date.now() - globalStateTimestamp < GLOBAL_STATE_CACHE_MS)) {
        return globalState;
    }
    await refreshGlobalState();
    return globalState;
}

// Handle coin logo loading
ipcMain.handle('load-coin-logo', async (event, symbol) => {
    try {
        const firstLetter = symbol.charAt(0).toUpperCase();
        const logoPath = path.join(COIN_LOGOS_FOLDER, `${firstLetter}.png`);
        
        // Check if file exists
        if (fs.existsSync(logoPath)) {
            // Read the file
            const imageBuffer = fs.readFileSync(logoPath);
            const dataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;
            
            return {
                success: true,
                dataUrl: dataUrl,
                buffer: imageBuffer
            };
        } else {
            return { success: false };
        }
    } catch (error) {
        console.error('Error loading coin logo:', error);
        return { success: false };
    }
});

// Handle metadata test
ipcMain.handle('test-metadata', async (event, testData) => {
    try {
        console.log('\n🧪 Testing metadata upload...');
        const startTime = Date.now();
        
        const metadataUri = await uploadMetadata({
            name: testData.name,
            symbol: testData.symbol,
            description: `${testData.name} - Test upload`,
            imageUrl: testData.imageUrl,
            twitter: testData.twitter || ""
        }, testData.imageBuffer);
        
        const uploadTime = Date.now() - startTime;
        const serverUsed = uploadTime < 200 ? 'Cloudflare Worker' : 'pump.fun';
        
        console.log(`✅ Test successful!`);
        console.log(`📦 Metadata URI: ${metadataUri}`);
        console.log(`⏱️ Upload time: ${uploadTime}ms`);
        console.log(`🖥️ Server used: ${serverUsed}`);
        
        return {
            success: true,
            metadataUri,
            uploadTime,
            serverUsed
        };
        
    } catch (error) {
        console.error('Test failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
});

// Handle window controls
ipcMain.on('minimize-window', () => {
    mainWindow.minimize();
});

ipcMain.on('close-window', () => {
    app.quit();
});

// Handle image download from Discord URLs
ipcMain.handle('download-image', async (event, url) => {
    try {
        console.log('Downloading image from:', url);
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const buffer = Buffer.from(response.data);
        const dataUrl = `data:${response.headers['content-type'] || 'image/jpeg'};base64,${buffer.toString('base64')}`;
        
        return {
            success: true,
            buffer: buffer,
            dataUrl: dataUrl
        };
    } catch (error) {
        console.error('Download error:', error);
        return { success: false, error: error.message };
    }
});

// Handle token creation
ipcMain.handle('create-token', async (event, tokenData) => {
    const startTime = Date.now();
    const timings = {};
    
    try {
        // Check if wallet is initialized
        if (!wallet || !sdk || !connection) {
            console.error("❌ Launcher not initialized. Please set your private key!");
            return { 
                success: false, 
                error: "Wallet not initialized. Please set your private key in main.js"
            };
        }
        
        console.log('\n🚀 Fast token creation...');
        console.log('Symbol:', tokenData.symbol);
        
        // Generate mint keypair immediately
        const mintStart = Date.now();
        const mintKeypair = Keypair.generate();
        const tokenAddress = mintKeypair.publicKey.toBase58();
        timings.mintGeneration = Date.now() - mintStart;
        console.log(`🪙 Token address: ${tokenAddress} (${timings.mintGeneration}ms)`);
        
        // Start metadata upload in parallel
        const metadataStart = Date.now();
        const metadataPromise = uploadMetadata({
            name: tokenData.name,
            symbol: tokenData.symbol,
            description: `${tokenData.name} - Launched on pump.fun`,
            imageUrl: tokenData.imageUrl,
            twitter: tokenData.twitter || ""
        }, tokenData.imageBuffer);
        
        // Get cached global state
        const globalStart = Date.now();
        const global = await getGlobalState();
        if (!global) {
            throw new Error("Failed to get global state");
        }
        timings.globalState = Date.now() - globalStart;
        console.log(`📊 Global state fetched (${timings.globalState}ms)`);
        
        // Calculate amounts
        const calcStart = Date.now();
        const solAmount = new BN(tokenData.initialBuy * LAMPORTS_PER_SOL);
        const tokenAmount = getBuyTokenAmountFromSolAmount(global, null, solAmount);
        timings.calculations = Date.now() - calcStart;
        
        // Wait for metadata
        const metadataUri = await metadataPromise;
        timings.metadataUpload = Date.now() - metadataStart;
        console.log(`📦 Metadata: ${metadataUri} (${timings.metadataUpload}ms)`);
        
        // Build priority fee
        const priorityFeeLamports = Math.floor(tokenData.priorityFee * LAMPORTS_PER_SOL);
        const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: Math.floor(priorityFeeLamports / 250_000 * 1_000_000),
        });
        
        // Get instructions
        const instructionsStart = Date.now();
        const instructions = await sdk.createAndBuyInstructions({
            global,
            mint: mintKeypair.publicKey,
            name: tokenData.name,
            symbol: tokenData.symbol,
            uri: metadataUri,
            creator: wallet.publicKey,
            user: wallet.publicKey,
            amount: tokenAmount,
            solAmount: solAmount,
        });
        timings.instructions = Date.now() - instructionsStart;
        console.log(`📝 Instructions built (${timings.instructions}ms)`);
        
        // Build transaction
        const txBuildStart = Date.now();
        const transaction = new Transaction()
            .add(computeBudgetIx)
            .add(priorityFeeIx)
            .add(...instructions);
        
        // Get fresh blockhash
        const blockhashStart = Date.now();
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed');
        timings.blockhash = Date.now() - blockhashStart;
        console.log(`🔗 Blockhash fetched (${timings.blockhash}ms)`);
        
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = wallet.publicKey;
        
        // Sign
        const signStart = Date.now();
        transaction.sign(wallet, mintKeypair);
        timings.signing = Date.now() - signStart;
        timings.txBuild = Date.now() - txBuildStart;
        
        // Send transaction via regular RPC only
        console.log('📤 Sending transaction...');
        console.log(`💰 Priority fee: ${(priorityFeeLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
        
        const sendStart = Date.now();
        const signature = await connection.sendRawTransaction(
            transaction.serialize(),
            {
                skipPreflight: true,
                preflightCommitment: 'processed'
            }
        );
        timings.send = Date.now() - sendStart;
        
        const elapsed = Date.now() - startTime;
        
        // Log timing breakdown
        console.log('\n⏱️ Timing breakdown:');
        console.log(`  Mint generation: ${timings.mintGeneration}ms`);
        console.log(`  Global state: ${timings.globalState}ms`);
        console.log(`  Calculations: ${timings.calculations}ms`);
        console.log(`  Metadata upload: ${timings.metadataUpload}ms`);
        console.log(`  Instructions: ${timings.instructions}ms`);
        console.log(`  Blockhash: ${timings.blockhash}ms`);
        console.log(`  TX build + sign: ${timings.txBuild}ms`);
        console.log(`  Send: ${timings.send}ms`);
        console.log(`  TOTAL: ${elapsed}ms`);
        
        console.log(`\n✅ Sent in ${elapsed}ms!`);
        console.log(`🔗 TX: https://solscan.io/tx/${signature}`);
        console.log(`📊 View: https://pump.fun/coin/${tokenAddress}`);
        
        // Confirm in background
        confirmInBackground(signature, lastValidBlockHeight);
        
        return { 
            success: true, 
            tokenAddress,
            signature,
            elapsed,
            timings
        };
        
    } catch (error) {
        console.error('Token creation error:', error);
        return { 
            success: false, 
            error: error.message,
            elapsed: Date.now() - startTime
        };
    }
});

async function uploadMetadata(metadata, imageBuffer) {
    try {
        // Image should already be uploaded via the frontend (letsbonk proxy)
        let imageUrl = metadata.imageUrl;
        
        // If no image URL but we have buffer, upload it via proxy
        if (!imageUrl && imageBuffer) {
            console.log('📤 Uploading image via proxy...');
            const formData = new FormData();
            formData.append('image', Buffer.from(imageBuffer), {
                filename: 'image.jpg',
                contentType: 'image/jpeg'
            });
            
            const imageResponse = await axios.post(
                'https://nft-storage.letsbonk22.workers.dev/upload/img',
                formData,
                {
                    headers: formData.getHeaders(),
                    timeout: 10000
                }
            );
            
            imageUrl = imageResponse.data;
            console.log(`✅ Image uploaded: ${imageUrl}`);
        }
        
        // Create the metadata object
        const fullMetadata = {
            name: metadata.name,
            symbol: metadata.symbol,
            description: metadata.description,
            image: imageUrl,
            showName: true,
            createdOn: "https://pump.fun",
            twitter: metadata.twitter || undefined
        };
        
        // Remove undefined fields
        Object.keys(fullMetadata).forEach(key => {
            if (fullMetadata[key] === undefined) delete fullMetadata[key];
        });
        
        // Upload to Cloudflare Worker for INSTANT speed
        console.log('☁️ Uploading metadata to Cloudflare Worker...');
        const metadataStart = Date.now();
        
        try {
            const response = await axios.post(
                `${CLOUDFLARE_WORKER_URL}/upload`,
                fullMetadata,
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 3000 // Fast timeout for edge network
                }
            );
            
            const metadataUrl = response.data.metadataUri;
            console.log(`✅ Metadata uploaded in ${Date.now() - metadataStart}ms`);
            console.log(`📦 Metadata URL: ${metadataUrl}`);
            
            return metadataUrl;
            
        } catch (workerError) {
            console.log('⚠️ Worker failed, falling back to pump.fun IPFS...');
            
            // Fallback to pump.fun's IPFS
            const formData = new FormData();
            
            if (imageBuffer) {
                formData.append("file", Buffer.from(imageBuffer), {
                    filename: "image.png",
                    contentType: "image/png"
                });
            }
            
            formData.append("name", metadata.name);
            formData.append("symbol", metadata.symbol);
            formData.append("description", metadata.description);
            formData.append("twitter", metadata.twitter || "");
            formData.append("telegram", "");
            formData.append("website", "");
            formData.append("showName", "true");
            
            const response = await axios.post('https://pump.fun/api/ipfs', formData, {
                headers: formData.getHeaders(),
                timeout: 15000
            });
            
            return response.data.metadataUri;
        }
        
    } catch (error) {
        console.error("Metadata upload error:", error);
        throw error;
    }
}

async function confirmInBackground(signature, lastValidBlockHeight) {
    try {
        const confirmation = await connection.confirmTransaction({
            signature,
            blockhash: connection._recentBlockhash,
            lastValidBlockHeight
        }, 'confirmed');
        
        if (confirmation.value.err) {
            console.log(`⚠️ Transaction failed: ${signature}`);
        } else {
            console.log(`✅ Confirmed: ${signature}`);
        }
    } catch (error) {
        console.error("Background confirmation error:", error);
    }
}