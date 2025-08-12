import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram
} from "@solana/web3.js";
import { PumpSdk, getBuyTokenAmountFromSolAmount } from "@pump-fun/pump-sdk";
import BN from "bn.js";
import bs58 from "bs58";
import axios from "axios";
import FormData from "form-data";

// Pre-initialize everything
class FastTokenLauncher {
  constructor(privateKey) {
    // Initialize wallet
    this.wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
    console.log(`✅ Fast Launcher initialized for: ${this.wallet.publicKey.toBase58()}`);
    
    // Pre-initialize connection with better settings
    this.connection = new Connection("https://mainnet.helius-rpc.com/?api-key=361627b6-ee29-4f85-aa18-71015c2486f1", {
      commitment: "processed", // Faster than confirmed
      confirmTransactionInitialTimeout: 30000
    });
    
    // Pre-initialize SDK
    this.sdk = new PumpSdk(this.connection);
    
    // Cache for global state
    this.globalState = null;
    this.globalStateTimestamp = 0;
    this.GLOBAL_STATE_CACHE_MS = 30000; // Refresh every 30 seconds
    
    // Pre-compute common compute budget instructions
    this.computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 250_000,
    });
    
    // Start background tasks
    this.startBackgroundTasks();
  }

  async startBackgroundTasks() {
    // Pre-fetch global state
    await this.refreshGlobalState();
    
    // Keep connection alive
    setInterval(() => {
      this.connection.getSlot().catch(() => {});
    }, 10000);
    
    // Refresh global state periodically
    setInterval(() => {
      this.refreshGlobalState().catch(console.error);
    }, this.GLOBAL_STATE_CACHE_MS);
  }

  async refreshGlobalState() {
    try {
      this.globalState = await this.sdk.fetchGlobal();
      this.globalStateTimestamp = Date.now();
      console.log("📊 Global state refreshed");
    } catch (error) {
      console.error("Error refreshing global state:", error);
    }
  }

  async getGlobalState() {
    // Return cached state if fresh
    if (this.globalState && (Date.now() - this.globalStateTimestamp < this.GLOBAL_STATE_CACHE_MS)) {
      return this.globalState;
    }
    
    // Otherwise refresh
    await this.refreshGlobalState();
    return this.globalState;
  }

  // Fast metadata upload - returns immediately with promise
  async uploadMetadataAsync(tokenData) {
    const formData = new FormData();
    
    // If imageUrl is a blob/buffer, append directly
    if (tokenData.imageData) {
      formData.append("file", tokenData.imageData, {
        filename: "image.jpg",
        contentType: "image/jpeg"
      });
    }
    
    formData.append("name", tokenData.name);
    formData.append("symbol", tokenData.symbol);
    formData.append("description", tokenData.description || `${tokenData.name} - Launched on pump.fun`);
    formData.append("twitter", tokenData.twitter || "");
    formData.append("telegram", tokenData.telegram || "");
    formData.append("website", tokenData.website || "");
    formData.append("showName", "true");

    // Return promise immediately
    return axios.post("https://pump.fun/api/ipfs", formData, {
      headers: formData.getHeaders(),
      timeout: 15000 // 15 second timeout
    }).then(response => response.data.metadataUri);
  }

  async createToken(params) {
    const startTime = Date.now();
    
    try {
      console.log(`\n🚀 Fast launch: ${params.symbol}`);
      
      // Generate mint keypair immediately
      const mintKeypair = Keypair.generate();
      const tokenAddress = mintKeypair.publicKey.toBase58();
      console.log(`🪙 Token address: ${tokenAddress}`);
      
      // Start metadata upload in parallel
      const metadataPromise = this.uploadMetadataAsync(params);
      
      // Get global state (cached if possible)
      const global = await this.getGlobalState();
      
      // Calculate amounts
      const solAmount = new BN(params.initialBuy * LAMPORTS_PER_SOL);
      const tokenAmount = getBuyTokenAmountFromSolAmount(global, null, solAmount);
      
      // Wait for metadata upload
      const metadataUri = await metadataPromise;
      console.log(`📦 Metadata ready: ${metadataUri}`);
      
      // Build priority fee based on params
      const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: Math.floor(params.priorityFee * 1_000_000_000),
      });
      
      // Get instructions
      const instructions = await this.sdk.createAndBuyInstructions({
        global,
        mint: mintKeypair.publicKey,
        name: params.name,
        symbol: params.symbol,
        uri: metadataUri,
        creator: this.wallet.publicKey,
        user: this.wallet.publicKey,
        amount: tokenAmount,
        solAmount: solAmount,
      });
      
      // Build transaction
      const transaction = new Transaction()
        .add(this.computeBudgetIx)
        .add(priorityFeeIx)
        .add(...instructions);
      
      // Get fresh blockhash
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('processed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.wallet.publicKey;
      
      // Sign
      transaction.sign(this.wallet, mintKeypair);
      
      // Send with minimal confirmation
      console.log("📤 Sending...");
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: true, // Faster
          preflightCommitment: 'processed'
        }
      );
      
      const elapsed = Date.now() - startTime;
      console.log(`✅ Sent in ${elapsed}ms!`);
      console.log(`🔗 TX: https://solscan.io/tx/${signature}`);
      console.log(`📊 View: https://pump.fun/coin/${tokenAddress}`);
      
      // Don't wait for confirmation - return immediately
      this.confirmInBackground(signature, lastValidBlockHeight);
      
      return {
        success: true,
        signature,
        tokenAddress,
        elapsed
      };
      
    } catch (error) {
      console.error("❌ Error:", error.message);
      return {
        success: false,
        error: error.message,
        elapsed: Date.now() - startTime
      };
    }
  }

  // Confirm transaction in background
  async confirmInBackground(signature, lastValidBlockHeight) {
    try {
      const confirmation = await this.connection.confirmTransaction({
        signature,
        blockhash: this.connection._recentBlockhash,
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

  // Batch create multiple tokens
  async batchCreate(tokenList) {
    console.log(`\n🚀 Batch creating ${tokenList.length} tokens...`);
    
    const results = [];
    for (const token of tokenList) {
      const result = await this.createToken(token);
      results.push(result);
      
      // Small delay between tokens to avoid rate limits
      if (tokenList.indexOf(token) < tokenList.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }
}

// Export for use in Electron
export default FastTokenLauncher;

// CLI usage example
if (import.meta.url === `file://${process.argv[1]}`) {
  const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY || "e";
  
  const launcher = new FastTokenLauncher(PRIVATE_KEY);
  
  // Wait for initialization
  setTimeout(async () => {
    // Example: Quick launch
    await launcher.createToken({
      name: "Fast Token",
      symbol: "FAST",
      description: "Launched with fast launcher",
      initialBuy: 0.1, // SOL
      priorityFee: 0.005, // SOL
      imageData: null, // You'd pass actual image data here
      twitter: "",
      telegram: "",
      website: ""
    });
  }, 2000);
}