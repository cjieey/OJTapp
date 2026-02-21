/**
 * OJT Time Tracker - Database Module
 * Uses IndexedDB for offline data persistence
 */

const DB_NAME = 'OJTTrackerDB';
const DB_VERSION = 1;

class Database {
    constructor() {
        this.db = null;
        this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Store for time entries
                if (!db.objectStoreNames.contains('entries')) {
                    const entryStore = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
                    entryStore.createIndex('date', 'date', { unique: false });
                    entryStore.createIndex('startTime', 'startTime', { unique: false });
                }

                // Store for settings
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                // Store for current session (active time in)
                if (!db.objectStoreNames.contains('session')) {
                    db.createObjectStore('session', { keyPath: 'id' });
                }
            };
        });
    }

    // Generic transaction helper
    async transaction(storeName, mode = 'readonly') {
        if (!this.db) await this.init();
        return this.db.transaction(storeName, mode).objectStore(storeName);
    }

    // Settings Operations
    async getSetting(key, defaultValue = null) {
        try {
            const store = await this.transaction('settings');
            const request = store.get(key);
            
            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    resolve(request.result ? request.result.value : defaultValue);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error getting setting:', error);
            return defaultValue;
        }
    }

    async setSetting(key, value) {
        try {
            const store = await this.transaction('settings', 'readwrite');
            await store.put({ key, value });
        } catch (error) {
            console.error('Error setting value:', error);
            throw error;
        }
    }

    // Entry Operations
    async addEntry(entry) {
        try {
            const store = await this.transaction('entries', 'readwrite');
            const entryWithTimestamp = {
                ...entry,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            return new Promise((resolve, reject) => {
                const request = store.add(entryWithTimestamp);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error adding entry:', error);
            throw error;
        }
    }

    async updateEntry(id, updates) {
        try {
            const store = await this.transaction('entries', 'readwrite');
            const entry = await this.getEntry(id);
            
            if (!entry) throw new Error('Entry not found');
            
            const updatedEntry = {
                ...entry,
                ...updates,
                updatedAt: new Date().toISOString()
            };
            
            return new Promise((resolve, reject) => {
                const request = store.put(updatedEntry);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error updating entry:', error);
            throw error;
        }
    }

    async deleteEntry(id) {
        try {
            const store = await this.transaction('entries', 'readwrite');
            return new Promise((resolve, reject) => {
                const request = store.delete(id);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error deleting entry:', error);
            throw error;
        }
    }

    async getEntry(id) {
        try {
            const store = await this.transaction('entries');
            return new Promise((resolve, reject) => {
                const request = store.get(id);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error getting entry:', error);
            return null;
        }
    }

    async getAllEntries() {
        try {
            const store = await this.transaction('entries');
            return new Promise((resolve, reject) => {
                const request = store.getAll();
                request.onsuccess = () => {
                    // Sort by date descending, then by start time
                    const entries = request.result.sort((a, b) => {
                        const dateCompare = new Date(b.date) - new Date(a.date);
                        if (dateCompare !== 0) return dateCompare;
                        return new Date(b.startTime) - new Date(a.startTime);
                    });
                    resolve(entries);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error getting all entries:', error);
            return [];
        }
    }

    async getEntriesByDate(date) {
        try {
            const store = await this.transaction('entries');
            const index = store.index('date');
            
            return new Promise((resolve, reject) => {
                const request = index.getAll(date);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error getting entries by date:', error);
            return [];
        }
    }

    async getEntriesByDateRange(startDate, endDate) {
        const entries = await this.getAllEntries();
        return entries.filter(entry => {
            const entryDate = new Date(entry.date);
            return entryDate >= new Date(startDate) && entryDate <= new Date(endDate);
        });
    }

    // Session Operations (Active Time In)
    async getSession() {
        try {
            const store = await this.transaction('session');
            return new Promise((resolve, reject) => {
                const request = store.get('current');
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error getting session:', error);
            return null;
        }
    }

    async setSession(sessionData) {
        try {
            const store = await this.transaction('session', 'readwrite');
            await store.put({ id: 'current', ...sessionData });
        } catch (error) {
            console.error('Error setting session:', error);
            throw error;
        }
    }

    async clearSession() {
        try {
            const store = await this.transaction('session', 'readwrite');
            await store.delete('current');
        } catch (error) {
            console.error('Error clearing session:', error);
            throw error;
        }
    }

    // Data Export/Import
    async exportAllData() {
        const entries = await this.getAllEntries();
        const settings = {
            requiredHours: await this.getSetting('requiredHours', 300),
            dailyHours: await this.getSetting('dailyHours', 8),
            darkMode: await this.getSetting('darkMode', false),
            reminderEnabled: await this.getSetting('reminderEnabled', false)
        };
        
        return {
            version: 1,
            exportedAt: new Date().toISOString(),
            settings,
            entries
        };
    }

    async importData(data) {
        if (!data.entries || !Array.isArray(data.entries)) {
            throw new Error('Invalid data format');
        }

        // Clear existing data
        await this.clearAllData();

        // Import settings
        if (data.settings) {
            for (const [key, value] of Object.entries(data.settings)) {
                await this.setSetting(key, value);
            }
        }

        // Import entries
        for (const entry of data.entries) {
            // Remove auto-generated ID to let DB assign new ones
            delete entry.id;
            await this.addEntry(entry);
        }
    }

    async clearAllData() {
        try {
            // Clear entries
            const entryStore = await this.transaction('entries', 'readwrite');
            await entryStore.clear();
            
            // Clear session
            await this.clearSession();
            
            // Keep settings except user-specific ones
            await this.setSetting('requiredHours', 300);
            await this.setSetting('dailyHours', 8);
        } catch (error) {
            console.error('Error clearing data:', error);
            throw error;
        }
    }

    // Statistics
    async getTotalHours() {
        const entries = await this.getAllEntries();
        return entries.reduce((total, entry) => total + (entry.duration || 0), 0);
    }

    async getHoursByDate(date) {
        const entries = await this.getEntriesByDate(date);
        return entries.reduce((total, entry) => total + (entry.duration || 0), 0);
    }
}

// Initialize global database instance
const db = new Database();
