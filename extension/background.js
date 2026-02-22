// background.js — Service Worker (Manifest V3)
// Handles: periodic sync, offline queue flush, Chrome notifications on new opens

const SYNC_ALARM = 'syncEmails';
const SYNC_INTERVAL_MINUTES = 5;

// --- Setup on install / startup ---
chrome.runtime.onInstalled.addListener(() => {
    setupSyncAlarm();
    console.log('[BG] Email Tracker installed');
});

chrome.runtime.onStartup.addListener(() => {
    setupSyncAlarm();
});

function setupSyncAlarm() {
    chrome.alarms.get(SYNC_ALARM, alarm => {
        if (!alarm) {
            chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MINUTES });
        }
    });
}

// --- Periodic sync ---
chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === SYNC_ALARM) {
        syncEmails();
        flushQueue();
    }
});

// --- Message handlers from popup/dashboard ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SYNC_NOW') {
        syncEmails()
            .then(() => sendResponse({ ok: true }))
            .catch(e => sendResponse({ ok: false, error: e.message }));
        return true; // keep async channel open
    }
});

// --- Core sync: fetch emails from server, compare against cache, notify on new opens ---
async function syncEmails() {
    try {
        const settings = await getSettingsBG();
        if (!settings.serverUrl || !settings.apiKey) return;

        const url = `${settings.serverUrl.replace(/\/$/, '')}/api/emails`;
        const res = await fetch(url, {
            headers: { 'x-api-key': settings.apiKey, 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const { emails } = await res.json();

        // Get previous snapshot to detect new opens
        const prev = await chrome.storage.local.get('emails');
        const prevEmails = prev.emails || [];
        const prevMap = new Map(prevEmails.map(e => [e.id, e.open_count || 0]));

        // Find emails that have new opens since last sync
        for (const email of emails) {
            const prevCount = prevMap.get(email.id) ?? null;
            const newCount = email.open_count || 0;

            // Only notify if:
            // - We've seen this email before (not a brand new registration)
            // - The open count actually increased
            if (prevCount !== null && newCount > prevCount) {
                const newOpens = newCount - prevCount;
                fireNotification(email, newOpens, newCount);
            }
        }

        // Save latest snapshot
        await chrome.storage.local.set({ emails, lastSync: new Date().toISOString() });
        console.log(`[BG] Synced ${emails.length} emails`);

    } catch (err) {
        console.warn('[BG] Sync failed:', err.message);
    }
}

// --- Chrome desktop notification ---
function fireNotification(email, newOpens, totalOpens) {
    const title = newOpens === 1
        ? `📬 Email opened by ${email.recipient}`
        : `📬 ${newOpens} new opens from ${email.recipient}`;

    const message = `"${email.subject}" has been opened ${totalOpens} time${totalOpens !== 1 ? 's' : ''} total.`;

    chrome.notifications.create(`open-${email.id}-${Date.now()}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title,
        message,
        priority: 1,
    });
}

// --- Flush offline queue ---
async function flushQueue() {
    try {
        const data = await chrome.storage.local.get('emailQueue');
        const queue = data.emailQueue || [];
        if (!queue.length) return;

        const settings = await getSettingsBG();
        if (!settings.serverUrl || !settings.apiKey) return;

        const remaining = [];
        for (const emailData of queue) {
            try {
                const res = await fetch(`${settings.serverUrl}/api/emails`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': settings.apiKey },
                    body: JSON.stringify(emailData),
                });
                if (!res.ok) remaining.push(emailData);
                else console.log(`[BG] Flushed queued email: ${emailData.id}`);
            } catch {
                remaining.push(emailData);
            }
        }
        await chrome.storage.local.set({ emailQueue: remaining });
    } catch (err) {
        console.warn('[BG] Queue flush failed:', err.message);
    }
}

// --- Helpers ---
async function getSettingsBG() {
    return new Promise(resolve => {
        chrome.storage.sync.get({ serverUrl: '', apiKey: '', senderEmail: '' }, resolve);
    });
}
