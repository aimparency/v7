import random
import os
import json
from env.trading_env import TradingEnv

def run_step():
    base_dir = os.path.dirname(__filename__ if "__filename__" in locals() else ".")
    wallet_path = os.path.join(base_dir, "wallet.json")
    config_path = os.path.join(base_dir, "config.json")
    
    # Load Config
    config = {"risk_level": 1.0, "leverage": 1.0, "strategy": "random"}
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            config.update(json.load(f))
    
    env = TradingEnv(initial_balance=10000.0, length=1000, wallet_path=wallet_path)
    
    # Determine Action
    action = random.choice([0, 1, 2])
    
    # Determine Amount based on risk and leverage
    # Base amount is 1. Scaled by risk_level * leverage.
    amount = max(1, int(1 * config["risk_level"] * config["leverage"]))
    
    obs, reward, done, info = env.step(action, amount=amount)
    
    print(f"Step: {env.current_step} | Action: {info['action']} | Amount: {info.get('amount', 1)} | Price: {obs['price']:.2f} | Value: {obs['portfolio_value']:.2f}")
    
    if done:
        print("Market cycle complete.")

if __name__ == "__main__":
    run_step()
