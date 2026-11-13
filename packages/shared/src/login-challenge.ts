// What the browser signs to log in with its key (backend auth/browser-key.ts,
// frontend utils/browser-key.ts). The prefix keeps the signature from meaning
// anything elsewhere.
export const loginChallengeMessage = (nonce: string) => `aimparency-login:${nonce}`;
