import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const ROOT_DIR = path.resolve(__dirname, '../../../');
const SYSTEM_FILE = path.join(ROOT_DIR, '.bowman/system.json');
const WALLET_FILE = path.join(ROOT_DIR, 'subdev/market-alpha/wallet.json');
const REPORT_FILE = path.join(ROOT_DIR, 'subdev/autonomy/reports/metrics.csv');

interface SystemState {
  computeCredits: number;
  funds: number;
  lastWorkTime?: number;
}

interface WalletState {
  balance: number;
  shares: number;
  last_update: number;
}

async function collect() {
  console.log('[AutonomyCollector] Gathering metrics...');

  // 1. Read System State
  let system: SystemState = { computeCredits: 0, funds: 0 };
  if (fs.existsSync(SYSTEM_FILE)) {
    system = await fs.readJson(SYSTEM_FILE);
  } else {
    console.warn('System file not found, using defaults.');
  }

  // 2. Read Market Alpha Wallet
  let wallet: WalletState = { balance: 0, shares: 0, last_update: 0 };
  if (fs.existsSync(WALLET_FILE)) {
    wallet = await fs.readJson(WALLET_FILE);
  } else {
    console.warn('Wallet file not found, using defaults.');
  }

  // 3. Get Current Price (Placeholder for now)
  const currentPrice = 100.0; 
  const portfolioValue = wallet.balance + (wallet.shares * currentPrice);

  // 4. Calculate Total Value
  const totalValue = system.funds + portfolioValue;

  // 5. Calculate Metrics (Simple delta for now)
  const timestamp = Date.now();
  const isoDate = new Date(timestamp).toISOString();

  // 6. Report Generation (CSV)
  const header = 'timestamp,iso_date,funds,credits,portfolio_value,total_value\n';
  const row = `${timestamp},${isoDate},${system.funds},${system.computeCredits},${portfolioValue},${totalValue}\n`;

  if (!fs.existsSync(REPORT_FILE)) {
    await fs.writeFile(REPORT_FILE, header + row);
  } else {
    await fs.appendFile(REPORT_FILE, row);
  }

  console.log(`[AutonomyCollector] Done. Total Value: ${totalValue.toFixed(2)}`);
  console.log(`[AutonomyCollector] Report updated: ${REPORT_FILE}`);
}

collect().catch(console.error);
