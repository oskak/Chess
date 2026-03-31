/**
 * IndexedDB Storage Layer for Chess Opening Repertoire
 *
 * Handles persistent storage of repertoires (MoveTree objects).
 * Uses IndexedDB for efficient storage of large datasets.
 */

class RepertoireDB {
    static DB_NAME = 'ChessRepertoireDB';
    static DB_VERSION = 1;
    static STORE_NAME = 'repertoires';

    constructor() {
        this.db = null;
    }

    async open() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(RepertoireDB.DB_NAME, RepertoireDB.DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(RepertoireDB.STORE_NAME)) {
                    const store = db.createObjectStore(RepertoireDB.STORE_NAME, { keyPath: 'id' });
                    store.createIndex('name', 'name', { unique: false });
                    store.createIndex('color', 'color', { unique: false });
                    store.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                reject(new Error('Failed to open database: ' + event.target.error));
            };
        });
    }

    async saveRepertoire(moveTree) {
        await this.open();
        const data = moveTree.serialize();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(RepertoireDB.STORE_NAME, 'readwrite');
            const store = tx.objectStore(RepertoireDB.STORE_NAME);
            const request = store.put(data);

            request.onsuccess = () => resolve(data.id);
            request.onerror = (event) => reject(new Error('Save failed: ' + event.target.error));
        });
    }

    async loadRepertoire(id) {
        await this.open();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(RepertoireDB.STORE_NAME, 'readonly');
            const store = tx.objectStore(RepertoireDB.STORE_NAME);
            const request = store.get(id);

            request.onsuccess = (event) => {
                const data = event.target.result;
                if (!data) {
                    resolve(null);
                    return;
                }
                resolve(MoveTree.deserialize(data));
            };
            request.onerror = (event) => reject(new Error('Load failed: ' + event.target.error));
        });
    }

    async listRepertoires() {
        await this.open();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(RepertoireDB.STORE_NAME, 'readonly');
            const store = tx.objectStore(RepertoireDB.STORE_NAME);
            const request = store.getAll();

            request.onsuccess = (event) => {
                const items = event.target.result.map(data => ({
                    id: data.id,
                    name: data.name,
                    color: data.color,
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt
                }));
                items.sort((a, b) => b.updatedAt - a.updatedAt);
                resolve(items);
            };
            request.onerror = (event) => reject(new Error('List failed: ' + event.target.error));
        });
    }

    async deleteRepertoire(id) {
        await this.open();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(RepertoireDB.STORE_NAME, 'readwrite');
            const store = tx.objectStore(RepertoireDB.STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(new Error('Delete failed: ' + event.target.error));
        });
    }

    async exportRepertoire(id) {
        const tree = await this.loadRepertoire(id);
        if (!tree) throw new Error('Repertoire not found');
        return PGNParser.export(tree);
    }

    async getStorageEstimate() {
        if (navigator.storage && navigator.storage.estimate) {
            const est = await navigator.storage.estimate();
            return {
                usage: est.usage,
                quota: est.quota,
                usageMB: Math.round(est.usage / 1024 / 1024 * 100) / 100,
                quotaMB: Math.round(est.quota / 1024 / 1024 * 100) / 100
            };
        }
        return null;
    }
}

window.RepertoireDB = RepertoireDB;
