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

    /**
     * Request persistent storage so browser won't evict data under pressure.
     * Returns true if granted. Call once at app startup.
     */
    async requestPersistentStorage() {
        if (navigator.storage && navigator.storage.persist) {
            try {
                const isPersistent = await navigator.storage.persisted();
                if (isPersistent) return true;
                return await navigator.storage.persist();
            } catch (e) {
                console.warn('Persistent storage request failed:', e);
                return false;
            }
        }
        return false;
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
                const now = Date.now();
                const items = event.target.result.map(data => ({
                    id: data.id,
                    name: data.name,
                    color: data.color,
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt,
                    summary: RepertoireDB.summarize(data.tree, now, data.color)
                }));
                items.sort((a, b) => b.updatedAt - a.updatedAt);
                resolve(items);
            };
            request.onerror = (event) => reject(new Error('List failed: ' + event.target.error));
        });
    }

    /**
     * Training summary computed straight from the serialized tree (no
     * MoveTree construction), cheap enough to run for every repertoire when
     * the sidebar refreshes. Mirrors MoveTree.getStatsOverview().
     * @returns {{lines, due, newLines, learned, nextDue, accuracy}}
     */
    static summarize(treeData, now = Date.now(), color = 'white') {
        const out = { lines: 0, due: 0, newLines: 0, learned: 0, nextDue: null, accuracy: null };
        if (!treeData || typeof treeData !== 'object') return out;
        // Lines in which the player never moves are not trained (see Trainer).
        const minDepth = color === 'black' ? 2 : 1;
        let moveAttempts = 0, moveCorrect = 0;
        const stack = [[treeData, true, true, 0]];
        while (stack.length) {
            const [node, active, isRoot, depth] = stack.pop();
            if (!node || typeof node !== 'object') continue;
            const nodeActive = active && (isRoot || node.e !== 0);
            if (Array.isArray(node.ms)) {
                moveAttempts += Number(node.ms[0]) || 0;
                moveCorrect += Number(node.ms[1]) || 0;
            }
            const children = node.c && typeof node.c === 'object' ? Object.values(node.c) : [];
            if (children.length === 0) {
                if (!isRoot && nodeActive && depth >= minDepth) {
                    out.lines++;
                    const s = Array.isArray(node.s) ? node.s : null;
                    const lastReviewed = s ? s[2] : null;
                    const nextReview = s ? s[3] : null;
                    if (!lastReviewed) {
                        out.newLines++;
                    } else {
                        out.learned++;
                        if (nextReview && nextReview <= now) out.due++;
                        else if (nextReview && (out.nextDue === null || nextReview < out.nextDue)) out.nextDue = nextReview;
                    }
                }
                continue;
            }
            for (const child of children) stack.push([child, nodeActive, false, depth + 1]);
        }
        out.accuracy = moveAttempts > 0 ? Math.round(moveCorrect / moveAttempts * 100) : null;
        return out;
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

    /**
     * Export ALL repertoires as a single JSON backup.
     * Includes all training stats, metadata, and tree structure.
     */
    async exportAll() {
        await this.open();

        const allData = await new Promise((resolve, reject) => {
            const tx = this.db.transaction(RepertoireDB.STORE_NAME, 'readonly');
            const store = tx.objectStore(RepertoireDB.STORE_NAME);
            const request = store.getAll();
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(new Error('Export all failed: ' + event.target.error));
        });

        return {
            version: 1,
            appName: 'Chess Opening Repertoire Trainer',
            exportedAt: new Date().toISOString(),
            repertoireCount: allData.length,
            repertoires: allData
        };
    }

    /**
     * Import repertoires from a JSON backup.
     * @param {Object} backupData - The backup object from exportAll()
     * @param {string} mode - 'merge' (skip existing IDs) or 'replace' (overwrite all)
     * @returns {Object} { imported, skipped, errors }
     */
    async importAll(backupData, mode = 'merge') {
        if (!backupData || !backupData.repertoires || !Array.isArray(backupData.repertoires)) {
            throw new Error('Invalid backup file format');
        }
        if (backupData.version !== 1) {
            throw new Error('Unsupported backup version: ' + backupData.version);
        }

        await this.open();

        let imported = 0;
        let skipped = 0;
        let errors = [];

        if (mode === 'replace') {
            // Clear all existing data first
            await new Promise((resolve, reject) => {
                const tx = this.db.transaction(RepertoireDB.STORE_NAME, 'readwrite');
                const store = tx.objectStore(RepertoireDB.STORE_NAME);
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = (event) => reject(new Error('Clear failed: ' + event.target.error));
            });
        }

        for (const repData of backupData.repertoires) {
            try {
                if (!repData.id || !repData.tree) {
                    errors.push(`Skipped invalid repertoire (no id/tree)`);
                    continue;
                }

                if (mode === 'merge') {
                    // Check if already exists
                    const existing = await new Promise((resolve, reject) => {
                        const tx = this.db.transaction(RepertoireDB.STORE_NAME, 'readonly');
                        const store = tx.objectStore(RepertoireDB.STORE_NAME);
                        const request = store.get(repData.id);
                        request.onsuccess = (event) => resolve(event.target.result);
                        request.onerror = () => resolve(null);
                    });

                    if (existing) {
                        skipped++;
                        continue;
                    }
                }

                await new Promise((resolve, reject) => {
                    const tx = this.db.transaction(RepertoireDB.STORE_NAME, 'readwrite');
                    const store = tx.objectStore(RepertoireDB.STORE_NAME);
                    const request = store.put(repData);
                    request.onsuccess = () => resolve();
                    request.onerror = (event) => reject(new Error('Put failed: ' + event.target.error));
                });
                imported++;

            } catch (e) {
                errors.push(`Error importing "${repData.name || repData.id}": ${e.message}`);
            }
        }

        return { imported, skipped, errors };
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
