// utils.js — shared helpers available in both content script and popup/dashboard

// --- UUID generator (no crypto module needed in extension context) ---
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// --- Settings helpers (stored via chrome.storage.sync) ---
async function getSettings() {
    return new Promise(resolve => {
        chrome.storage.sync.get({
            serverUrl: '',
            apiKey: '',
            senderEmail: '',
        }, resolve);
    });
}

async function saveSettings(settings) {
    return new Promise(resolve => {
        chrome.storage.sync.set(settings, resolve);
    });
}

// --- IndexedDB for local email cache ---
const DB_NAME = 'emailTracker';
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('emails')) {
                const store = db.createObjectStore('emails', { keyPath: 'id' });
                store.createIndex('sent_at', 'sent_at');
            }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

async function cacheEmails(emails) {
    const db = await openDB();
    const tx = db.transaction('emails', 'readwrite');
    const store = tx.objectStore('emails');
    for (const email of emails) {
        store.put(email);
    }
    return new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = rej;
    });
}

async function getCachedEmails() {
    const db = await openDB();
    const tx = db.transaction('emails', 'readonly');
    const store = tx.objectStore('emails');
    const idx = store.index('sent_at');
    return new Promise((resolve, reject) => {
        const req = idx.getAll();
        req.onsuccess = e => resolve(e.target.result.reverse()); // newest first
        req.onerror = e => reject(e.target.error);
    });
}

// --- API wrapper ---
async function apiRequest(path, options = {}) {
    const { serverUrl, apiKey } = await getSettings();
    if (!serverUrl || !apiKey) throw new Error('Server not configured. Please open extension settings.');

    const url = `${serverUrl.replace(/\/$/, '')}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            ...(options.headers || {}),
        },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error ${res.status}: ${text}`);
    }
    return res.json();
}

// --- Offline queue (localStorage) ---
function getQueue() {
    try { return JSON.parse(localStorage.getItem('emailQueue') || '[]'); } catch { return []; }
}
function setQueue(q) { localStorage.setItem('emailQueue', JSON.stringify(q)); }
function addToQueue(email) { const q = getQueue(); q.push(email); setQueue(q); }
function clearQueue() { localStorage.removeItem('emailQueue'); }
