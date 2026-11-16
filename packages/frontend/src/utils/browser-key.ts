import { loginChallengeMessage } from 'shared'

// The key of an automatic account: made here, kept in this browser's IndexedDB
// with a private half that scripts cannot read out, only use. The server knows
// the public half; logging in is signing its challenge. Clearing the browser's
// data loses the key, and with it an account that has no password yet.
const DB_NAME = 'aimparency-login'
const STORE_NAME = 'keys'
const KEY_ID = 'account'
const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' }

function request<T>(run: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, 1)
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE_NAME)
    opening.onerror = () => reject(opening.error)
    opening.onsuccess = () => {
      const database = opening.result
      const pending = run(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME))
      pending.onerror = () => reject(pending.error)
      pending.onsuccess = () => {
        database.close()
        resolve(pending.result)
      }
    }
  })
}

async function browserKey(): Promise<CryptoKeyPair> {
  const stored = await request<CryptoKeyPair | undefined>(store => store.get(KEY_ID), 'readonly')
  if (stored) return stored
  const pair = await crypto.subtle.generateKey(ALGORITHM, false, ['sign', 'verify'])
  await request(store => store.put(pair, KEY_ID), 'readwrite')
  return pair
}

const base64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)))

/** The public key and this browser's signature over the server's challenge. */
export async function signLoginChallenge(nonce: string): Promise<{ publicKey: string, signature: string }> {
  const pair = await browserKey()
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(loginChallengeMessage(nonce)))
  return { publicKey: base64(await crypto.subtle.exportKey('spki', pair.publicKey)), signature: base64(signature) }
}

/** Forgets this browser's key: the next automatic account gets a new one. */
export async function forgetBrowserKey(): Promise<void> {
  await request(store => store.delete(KEY_ID), 'readwrite')
}
