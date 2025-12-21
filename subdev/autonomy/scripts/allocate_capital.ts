import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const ROOT_DIR = path.resolve(__dirname, '../../../');
const SYSTEM_FILE = path.join(ROOT_DIR, '.bowman/system.json');
const WALLET_FILE = path.join(ROOT_DIR, 'subdev/market-alpha/wallet.json');

async function allocate() {
  console.log('[CapitalAllocator] Checking for surplus funds...');

  if (!fs.existsSync(SYSTEM_FILE) || !fs.existsSync(WALLET_FILE)) {
    console.error('System or Wallet file missing.');
    return;
  }

  const system = await fs.readJson(SYSTEM_FILE);
  const wallet = await fs.readJson(WALLET_FILE);

  const availableFunds = system.funds || 0;
  
  if (availableFunds <= 0) {
      console.log('[CapitalAllocator] No funds available to allocate.');
      return;
  }

  // Allocation Strategy: Invest 50% of available funds
  const allocationAmount = Math.floor(availableFunds * 0.5);

  if (allocationAmount > 0) {
      // Transfer
      system.funds -= allocationAmount;
      wallet.balance += allocationAmount;
      wallet.last_update = wallet.last_update; // Keep or update? maybe not needed by env logic but good for record

      // Persist
      await fs.writeJson(SYSTEM_FILE, system, { indent: 2 });
      await fs.writeJson(WALLET_FILE, wallet, { indent: 2 });

      console.log(`[CapitalAllocator] Transferred $${allocationAmount} to Market Alpha.`);
      console.log(`[CapitalAllocator] New System Funds: $${system.funds}`);
      console.log(`[CapitalAllocator] New Wallet Balance: $${wallet.balance}`);
  } else {
      console.log('[CapitalAllocator] Allocation amount too small (< 1). Skipping.');
  }
}

allocate().catch(console.error);
