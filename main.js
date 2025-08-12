const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs');

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

// Store your private key here
const WALLET_PRIVATE_KEY = "e"; // Replace with your actual private key

// Coin logos folder path
const COIN_LOGOS_FOLDER = "C:/Users/grubb/pfnew/token/green-coins"; // Change this to your folder path

// Jito configuration
const JITO_BLOCK_ENGINE_URL = "https://mainnet.block-engine.jito.wtf/api/v1/transactions";
const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
];

// Pre-initialized launcher components
let connection;
let sdk;
let wallet;
let globalState;
let globalStateTimestamp = 0;
const GLOBAL_STATE_CACHE_MS = 30000;

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
        connection = new Connection("https://api.mainnet-beta.solana.com", {
            commitment: "processed",
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
        const mintKeypair = Keypair.generate();
        const tokenAddress = mintKeypair.publicKey.toBase58();
        console.log('🪙 Token address:', tokenAddress);
        
        // Start metadata upload in parallel
        const metadataPromise = uploadMetadata({
            name: tokenData.name,
            symbol: tokenData.symbol,
            description: `${tokenData.name} - Launched on pump.fun`,
            imageUrl: tokenData.imageUrl,
            twitter: tokenData.twitter || ""
        }, tokenData.imageBuffer);
        
        // Get cached global state
        const global = await getGlobalState();
        if (!global) {
            throw new Error("Failed to get global state");
        }
        
        // Calculate amounts
        const solAmount = new BN(tokenData.initialBuy * LAMPORTS_PER_SOL);
        const tokenAmount = getBuyTokenAmountFromSolAmount(global, null, solAmount);
        
        // Wait for metadata
        const metadataUri = await metadataPromise;
        console.log('📦 Metadata:', metadataUri);
        
        // Build priority fee (70% of total fee)
        const totalFeeSOL = tokenData.priorityFee;
        const priorityFeeLamports = Math.floor(totalFeeSOL * 0.7 * LAMPORTS_PER_SOL);
        const jitoTipLamports = Math.floor(totalFeeSOL * 0.3 * LAMPORTS_PER_SOL);
        
        const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: Math.floor(priorityFeeLamports / 250_000 * 1_000_000), // Convert to microLamports per CU
        });
        
        // Get instructions
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
        
        // Build transaction
        const transaction = new Transaction()
            .add(computeBudgetIx)
            .add(priorityFeeIx)
            .add(...instructions);
        
        // Add Jito tip as the LAST instruction (30% of total fee)
        const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
        const tipInstruction = SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: new PublicKey(tipAccount),
            lamports: jitoTipLamports,
        });
        transaction.add(tipInstruction);
        
        // Get fresh blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = wallet.publicKey;
        
        // Sign
        transaction.sign(wallet, mintKeypair);
        
        // Send to Jito
        console.log('📤 Sending via Jito...');
        console.log(`💰 Priority fee: ${(priorityFeeLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL (70%)`);
        console.log(`💰 Jito tip: ${(jitoTipLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL (30%)`);
        
        let signature;
        try {
            // Try Jito first
            const serialized = transaction.serialize();
            const base64Tx = serialized.toString('base64');
            
            const jitoResponse = await axios.post(
                JITO_BLOCK_ENGINE_URL,
                {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "sendTransaction",
                    params: [base64Tx]
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    timeout: 5000
                }
            );
            
            signature = jitoResponse.data.result;
            console.log('✅ Sent via Jito block engine');
        } catch (jitoError) {
            console.log('⚠️ Jito failed, using regular RPC');
            // Fallback to regular RPC
            signature = await connection.sendRawTransaction(
                transaction.serialize(),
                {
                    skipPreflight: true,
                    preflightCommitment: 'processed'
                }
            );
        }
        
        const elapsed = Date.now() - startTime;
        console.log(`✅ Sent in ${elapsed}ms!`);
        console.log(`🔗 TX: https://solscan.io/tx/${signature}`);
        console.log(`📊 View: https://pump.fun/coin/${tokenAddress}`);
        
        // Confirm in background
        confirmInBackground(signature, lastValidBlockHeight);
        
        return { 
            success: true, 
            tokenAddress,
            signature,
            elapsed
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
        const formData = new FormData();
        
        // Use the image buffer passed from UI
        if (imageBuffer) {
            const buffer = Buffer.from(imageBuffer);
            formData.append("file", buffer, {
                filename: "image.png",
                contentType: "image/png"
            });
        } else {
            throw new Error("No image buffer provided");
        }
        
        // Append metadata fields
        formData.append("name", metadata.name);
        formData.append("symbol", metadata.symbol);
        formData.append("description", metadata.description);
        formData.append("twitter", metadata.twitter || "");
        formData.append("telegram", "");
        formData.append("website", "");
        formData.append("showName", "true");
        
        const response = await axios.post('https://pump.fun/api/ipfs', formData, {
            headers: {
                ...formData.getHeaders(),
                'Content-Type': 'multipart/form-data'
            },
            timeout: 15000
        });
        
        return response.data.metadataUri;
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