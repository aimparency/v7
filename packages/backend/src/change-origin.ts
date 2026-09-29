import { AsyncLocalStorage } from 'node:async_hooks';

// Which client caused the current request. Set per tRPC call from the WS
// connection params; read by the change subscription (listeners run
// synchronously inside `ee.emit`, i.e. inside the emitting request's context),
// so clients can tell their own changes apart from other clients' changes.
const originStorage = new AsyncLocalStorage<{ clientId?: string }>();

export function runWithOrigin<T>(clientId: string | undefined, fn: () => T): T {
  return originStorage.run({ clientId }, fn);
}

export function currentOrigin(): string | undefined {
  return originStorage.getStore()?.clientId;
}
