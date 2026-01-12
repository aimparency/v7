export const AIMPARENCY_DIR_NAME = (typeof process !== 'undefined' && process.env?.AIMPARENCY_DIR_NAME) 
  ? process.env.AIMPARENCY_DIR_NAME 
  : '.bowman';

export const AIM_STATES = ['open', 'done', 'cancelled', 'partially', 'failed', 'unclear', 'archived'] as const;

export const DEFAULT_STATUSES = [
  { key: 'open', color: '#ffcc80' },
  { key: 'done', color: '#81c784' },
  { key: 'cancelled', color: '#e57373' },
  { key: 'partially', color: '#fff176' },
  { key: 'failed', color: '#ba68c8' },
  { key: 'unclear', color: '#90a4ae' },
  { key: 'archived', color: '#444444' }
];