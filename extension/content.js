// content.js — injected into https://mail.google.com/*
// Watches for Gmail compose windows and intercepts the Send button

(function () {
    'use strict';

    // Avoid double-initialization
    if (window.__emailTrackerInit) return;
    window.__emailTrackerInit = true;

    // --- Track compose forms already processed ---
    const processedForms = new WeakSet();

    // --- Main observer: watch for compose windows ---
    const bodyObserver = new MutationObserver(debounce(scanForComposeWindows, 300));
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    scanForComposeWindows(); // run once on load

    function scanForComposeWindows() {
        // Gmail's compose boxes have data-message-id or role=dialog
        const composeWindows = document.querySelectorAll('[role="dialog"]');
        composeWindows.forEach(setupComposeWindow);
    }

    function setupComposeWindow(composeEl) {
        if (processedForms.has(composeEl)) return;
        processedForms.add(composeEl);

        // Watch for the Send button inside this compose window
        const observer = new MutationObserver(debounce(() => {
            const sendBtn = getSendButton(composeEl);
            if (sendBtn && !sendBtn.__trackerAttached) {
                sendBtn.__trackerAttached = true;
                sendBtn.addEventListener('click', () => handleSend(composeEl), { capture: true });
                console.log('[EmailTracker] Send button hooked');
            }
        }, 150));

        observer.observe(composeEl, { childList: true, subtree: true });

        // Also try immediately
        const sendBtn = getSendButton(composeEl);
        if (sendBtn && !sendBtn.__trackerAttached) {
            sendBtn.__trackerAttached = true;
            sendBtn.addEventListener('click', () => handleSend(composeEl), { capture: true });
            console.log('[EmailTracker] Send button hooked (immediate)');
        }
    }

    function getSendButton(composeEl) {
        // Gmail's send button: data-tooltip="Send" or aria-label containing "Send"
        return (
            composeEl.querySelector('[data-tooltip="Send ‪(Ctrl+Enter)‬"]') ||
            composeEl.querySelector('[data-tooltip="Send"]') ||
            composeEl.querySelector('[aria-label*="Send"]') ||
            [...composeEl.querySelectorAll('[role="button"]')].find(
                el => el.textContent.trim() === 'Send'
            )
        );
    }

    async function handleSend(composeEl) {
        try {
            const recipient = extractRecipient(composeEl);
            const subject = extractSubject(composeEl);

            if (!recipient) {
                console.warn('[EmailTracker] Could not extract recipient — skipping tracking');
                return;
            }

            const emailId = generateUUID();
            const settings = await getSettings();

            if (!settings.serverUrl || !settings.apiKey || !settings.senderEmail) {
                console.warn('[EmailTracker] Not configured — skipping tracking. Open options page.');
                return;
            }

            // Inject tracking pixel into the compose body
            const bodyEl = composeEl.querySelector('[contenteditable="true"][role="textbox"]') ||
                composeEl.querySelector('[g_editable="true"]');

            if (bodyEl) {
                const pixelUrl = `${settings.serverUrl.replace(/\/$/, '')}/pixel/${emailId}.gif`;
                const pixel = document.createElement('img');
                pixel.src = pixelUrl;
                pixel.width = 1;
                pixel.height = 1;
                pixel.style.cssText = 'display:block;width:1px;height:1px;opacity:0;position:absolute;border:0;';
                pixel.alt = '';
                bodyEl.appendChild(pixel);
                console.log(`[EmailTracker] Pixel injected: ${pixelUrl}`);
            }

            // Register email with server (in background)
            const emailData = {
                id: emailId,
                recipient,
                subject: subject || '(no subject)',
                sender_email: settings.senderEmail,
            };

            // Try to send immediately; if offline, queue it
            try {
                await apiRequest('/api/emails', {
                    method: 'POST',
                    body: JSON.stringify(emailData),
                });
                console.log(`[EmailTracker] Email registered: ${emailId}`);
            } catch (err) {
                console.warn('[EmailTracker] Server unreachable — queuing:', err.message);
                addToQueue(emailData);
            }

        } catch (err) {
            console.error('[EmailTracker] handleSend error:', err);
        }
    }

    // --- Gmail DOM helpers ---
    function extractRecipient(composeEl) {
        // Gmail renders recipient chips with email addresses
        const chips = composeEl.querySelectorAll('[data-hovercard-id]');
        if (chips.length > 0) {
            return [...chips].map(c => c.getAttribute('data-hovercard-id')).filter(Boolean).join(', ');
        }
        // Fallback: look for email addresses in recipient fields
        const toField = composeEl.querySelector('[data-tooltip="To"]') ||
            composeEl.querySelector('[aria-label="To"]');
        if (toField) return toField.innerText.trim();
        return null;
    }

    function extractSubject(composeEl) {
        const subjectInput = composeEl.querySelector('input[name="subjectbox"]') ||
            composeEl.querySelector('[aria-label="Subject"]');
        return subjectInput ? (subjectInput.value || subjectInput.innerText || '').trim() : '(no subject)';
    }

    function debounce(fn, delay) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }
})();
