const DB_NAME = 'aimparency-graph';
const DB_VERSION = 1;
const STORE_NAME = 'aim-positions';

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });

  return dbPromise;
}

export interface Position {
  id: string;
  x: number;
  y: number;
}

export async function savePositions(positions: Position[]) {
  const db = await getDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    for (const pos of positions) {
      store.put(pos);
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function saveCamera(offset: {x: number, y: number}, scale: number) {
  const db = await getDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // Store camera with special ID
    store.put({ id: '__CAMERA__', x: offset.x, y: offset.y, scale });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function loadCamera(): Promise<{x: number, y: number, scale: number} | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get('__CAMERA__');

    request.onsuccess = () => {
      const result = request.result;
      if (result) {
        resolve({ x: result.x, y: result.y, scale: result.scale });
      } else {
        resolve(null);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

export async function loadAllPositions(): Promise<Map<string, { x: number; y: number }>> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const positions = request.result as any[];
      const map = new Map<string, { x: number, y: number }>();
      positions.forEach(p => {
        if (p.id !== '__CAMERA__') {
            map.set(p.id, { x: p.x, y: p.y });
        }
      });
      resolve(map);
    };

    request.onerror = () => reject(request.error);
  });
}
