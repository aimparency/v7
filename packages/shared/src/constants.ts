export const AIMPARENCY_DIR_NAME = (typeof process !== 'undefined' && process.env?.AIMPARENCY_DIR_NAME) 
  ? process.env.AIMPARENCY_DIR_NAME 
  : '.bowman';

export interface AimState {
  key: string;
  color: string;
  ongoing: boolean;
}

export const INITIAL_STATES: AimState[] = [
  { key: 'open', color: '#ffcc80', ongoing: true },
  { key: 'partially', color: '#fff176', ongoing: true },
  { key: 'done', color: '#81c784', ongoing: false },
  { key: 'cancelled', color: '#e57373', ongoing: false },
  { key: 'failed', color: '#ba68c8', ongoing: false },
  { key: 'unclear', color: '#90a4ae', ongoing: false }
];


// Cost of capital / discount rates
export const DISCOUNT_RATE = 0.05; // 5% discount per cost unit (legacy, for backward compat)
export const ANNUAL_DISCOUNT_RATE = 0.10; // 10% annual discount rate (cost of capital)
export const DAILY_DISCOUNT_RATE = Math.pow(1 + ANNUAL_DISCOUNT_RATE, 1/365) - 1; // ~0.026% per day