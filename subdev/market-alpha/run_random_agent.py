import random
import time
import os
from env.trading_env import TradingEnv

def run():
    print("Initializing Market Alpha Environment...")
    wallet_path = os.path.join(os.path.dirname(__filename__ if "__filename__" in locals() else "."), "wallet.json")
    env = TradingEnv(initial_balance=10000.0, length=50, wallet_path="wallet.json")
    
    obs = env.reset()
    print(f"Start Value: ${obs['portfolio_value']:.2f}")
    
    total_reward = 0
    done = False
    
    while not done:
        # Random Agent: 0, 1, 2
        action = random.choice([0, 1, 2])
        
        obs, reward, done, info = env.step(action)
        total_reward += reward
        
        env.render()
        # print(f"Action: {info['action']} | Reward: {reward:.2f}")
        
        time.sleep(0.05) # Fast simulation

    print("-" * 30)
    print(f"Simulation Complete.")
    print(f"Final Portfolio Value: ${obs['portfolio_value']:.2f}")
    print(f"Total Reward: ${total_reward:.2f}")
    
    profit = obs['portfolio_value'] - 10000
    print(f"Profit/Loss: ${profit:.2f}")

if __name__ == "__main__":
    run()
