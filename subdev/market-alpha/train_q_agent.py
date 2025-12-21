import sys
import os
import random
import time

# Add current directory to path to find env
sys.path.append(os.path.join(os.getcwd(), 'subdev', 'market-alpha'))

from env.trading_env import TradingEnv
from agents.q_learning import QLearningAgent
from data.loader import load_data

def train():
    print("Loading Market Data (BTC-USD)...")
    try:
        prices = load_data("BTC-USD", period="2y", interval="1d")
        print(f"Loaded {len(prices)} data points.")
    except Exception as e:
        print(f"Failed to load data: {e}. Using synthetic.")
        prices = None

    print("Training Q-Learning Agent...")
    # If using real data, length is determined by data
    env = TradingEnv(initial_balance=10000.0, length=len(prices) if prices else 50, data=prices)
    agent = QLearningAgent()
    
    episodes = 500
    epsilon = 1.0
    epsilon_decay = 0.99
    min_epsilon = 0.01
    
    for e in range(episodes):
        obs = env.reset()
        agent.reset()
        done = False
        total_reward = 0
        
        while not done:
            agent.update_history(obs['price'])
            action = agent.act(obs, epsilon)
            next_obs, reward, done, info = env.step(action)
            
            agent.learn(obs, action, reward, next_obs)
            
            obs = next_obs
            total_reward += reward
            
        epsilon = max(min_epsilon, epsilon * epsilon_decay)
        
        if (e+1) % 100 == 0:
            print(f"Episode {e+1}/{episodes} | Reward: {total_reward:.2f} | Epsilon: {epsilon:.2f}")

    print("Training Complete.")
    
    # Evaluation
    print("\nRunning Evaluation (Greedy)...")
    obs = env.reset()
    agent.reset()
    done = False
    
    while not done:
        agent.update_history(obs['price'])
        action = agent.act(obs, epsilon=0)
        obs, reward, done, info = env.step(action)
        env.render()
        time.sleep(0.05)
    
    print(f"Final Value: ${obs['portfolio_value']:.2f}")
    print(f"Profit: ${obs['portfolio_value'] - 10000:.2f}")

if __name__ == "__main__":
    train()
