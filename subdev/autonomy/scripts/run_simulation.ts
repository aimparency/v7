import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { stripe } from '../../revenue/payment-gateway/stripe-mock';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../../');

const MARKET_ALPHA_DIR = path.join(ROOT_DIR, 'subdev/market-alpha');
const VENV_PYTHON = path.join(MARKET_ALPHA_DIR, 'venv/bin/python3');
const STEP_SCRIPT = path.join(MARKET_ALPHA_DIR, 'step_agent.py');

const SYSTEM_FILE = path.join(ROOT_DIR, '.bowman/system.json');
const WALLET_FILE = path.join(MARKET_ALPHA_DIR, 'wallet.json');
const METRICS_FILE = path.join(ROOT_DIR, 'subdev/autonomy/reports/metrics.csv');

async function reset() {
    console.log('[Simulation] Resetting state...');
    if (fs.existsSync(WALLET_FILE)) fs.unlinkSync(WALLET_FILE);
    if (fs.existsSync(METRICS_FILE)) fs.unlinkSync(METRICS_FILE);
    
    // Reset System Funds
    if (fs.existsSync(SYSTEM_FILE)) {
        const system = await fs.readJson(SYSTEM_FILE);
        system.funds = 0;
        await fs.writeJson(SYSTEM_FILE, system, { indent: 2 });
    }
}

async function runDay(day: number) {
    console.log(`\n=== Day ${day} ===`);

    // 1. Labor (Echo)
    // Random revenue: $0 - $200
    const revenue = Math.floor(Math.random() * 5) * 50; 
    if (revenue > 0) {
        await stripe.processPayment(revenue, `Echo Revenue Day ${day}`);
    } else {
        console.log(`[Echo] No revenue today.`);
    }

    // 2. Allocation
    // Run allocate script
    try {
        execSync(`npx tsx ${path.join(__dirname, 'allocate_capital.ts')}`, { stdio: 'inherit', cwd: ROOT_DIR });
    } catch (e) {
        console.error('[Simulation] Allocation failed');
    }

    // 3. Capital (Market Alpha)
    try {
        execSync(`${VENV_PYTHON} ${STEP_SCRIPT}`, { stdio: 'inherit', cwd: MARKET_ALPHA_DIR });
    } catch (e) {
        console.error('[Simulation] Market Step failed');
    }

    // 4. Metrics
    try {
        execSync(`npx tsx ${path.join(__dirname, 'collect_metrics.ts')}`, { stdio: 'inherit', cwd: ROOT_DIR });
    } catch (e) {
        console.error('[Simulation] Metrics collection failed');
    }
}

async function simulate() {
    await reset();
    
    const DAYS = 10; // Simulate 10 days/steps
    for (let i = 1; i <= DAYS; i++) {
        await runDay(i);
        // await new Promise(resolve => setTimeout(resolve, 500)); // Delay for readability
    }
    
    console.log('\n[Simulation] Complete.');
}

simulate().catch(console.error);
