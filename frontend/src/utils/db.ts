import Dexie, { type Table } from 'dexie';

export interface CacheRecord {
    key: string;
    data: any;
    timestamp: number;
}

export class AppDB extends Dexie {
    apiCache!: Table<CacheRecord, string>;

    constructor() {
        super('JewelryAiErpDB');
        this.version(1).stores({
            apiCache: 'key, timestamp'
        });
    }
}

export const db = new AppDB();
export default db;
