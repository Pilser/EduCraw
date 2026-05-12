// Stub — EduCrawl manages sessions server-side, no client storage needed.
// This file exists only so copied pi-web-ui dialogs can compile.
// All methods are no-ops that return null/empty.

class NoopStore {
  async get<T>(_key: string): Promise<T | null> {
    return null;
  }
  async set(_key: string, _value: any): Promise<void> {}
  async delete(_key: string): Promise<void> {}
  async getAll(): Promise<any[]> {
    return [];
  }
  async getAllMetadata(): Promise<any[]> {
    return [];
  }
  async deleteSession(_id: string): Promise<void> {}
}

class AppStorage {
  settings = new NoopStore();
  providerKeys = new NoopStore();
  sessions = new NoopStore();
  customProviders = new NoopStore();
}

let _storage: AppStorage | null = null;

export function getAppStorage(): AppStorage {
  if (!_storage) _storage = new AppStorage();
  return _storage;
}

export function setAppStorage(_s: AppStorage): void {}
