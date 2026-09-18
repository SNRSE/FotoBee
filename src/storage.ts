export type MemoryKind = 'photo' | 'video';
export interface Memory { id: string; kind: MemoryKind; blob: Blob; createdAt: number; }
let database: Promise<IDBDatabase> | undefined;
function db() {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('fotobee-memories', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('memories', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = undefined; reject(request.error); };
      request.onblocked = () => { database = undefined; reject(new Error('Close other FotoBee tabs and try again.')); };
    });
  }
  return database;
}
// Keep this boundary small: a future Node API can replace these three methods.
export const memoryStore = {
  async save(items: { kind: MemoryKind; blob: Blob }[]) {
    const connection = await db();
    return new Promise<void>((resolve, reject) => {
      const transaction = connection.transaction('memories', 'readwrite');
      const store = transaction.objectStore('memories');
      items.forEach(item => store.add({ ...item, id: crypto.randomUUID(), createdAt: Date.now() }));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Saving was interrupted.'));
    });
  },
  async list(): Promise<Memory[]> {
    const connection = await db();
    return new Promise((resolve, reject) => {
      const request = connection.transaction('memories').objectStore('memories').getAll();
      request.onsuccess = () => resolve((request.result as Memory[]).sort((a, b) => b.createdAt - a.createdAt));
      request.onerror = () => reject(request.error);
    });
  },
  async count(): Promise<number> {
    const connection = await db();
    return new Promise((resolve, reject) => {
      const request = connection.transaction('memories').objectStore('memories').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
};

