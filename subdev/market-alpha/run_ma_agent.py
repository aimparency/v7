import time
from env.trading_env import TradingEnv
from agents.moving_average import MovingAverageAgent

def run():
    env = TradingEnv(initial_balance=10000.0, length=100)
    agent = MovingAverageAgent(short_window=5, long_window=15)
    
    obs = env.reset()
    done = False
    
    while not done:
        action = agent.act(obs)
        obs, reward, done, info = env.step(action)
        env.render()
        time.sleep(0.1)

    profit = obs['portfolio_value'] - 10000
    print(f"MA Agent Profit: ${profit:.2f}")

if __name__ == "__main__":
    run()
