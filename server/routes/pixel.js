const express = require('express');
const router = express.Router();
const { getEmail, insertOpen, getOpensForEmail } = require('../db');

// 1x1 transparent GIF (hard-coded bytes — no file dependency)
const TRANSPARENT_GIF = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAEALAAAAAABAAEAAAICRAEAOw==',
    'base64'
);

// GET /pixel/:emailId.gif — serve tracking pixel + log open event
router.get('/:emailId.gif', async (req, res) => {
    // Always serve the pixel immediately — don't make recipient wait
    res.set({
        'Content-Type': 'image/gif',
        'Content-Length': TRANSPARENT_GIF.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
    });
    res.end(TRANSPARENT_GIF);

    // Process tracking asynchronously (after pixel is sent)
    const { emailId } = req.params;
    const userAgent = req.headers['user-agent'] || '';
    const openedAt = new Date().toISOString();

    try {
        const email = getEmail.get(emailId);
        if (!email) {
            console.warn(`[pixel] Unknown emailId: ${emailId}`);
            return;
        }

        // Skip known bot/pre-fetcher user agents
        const botPatterns = /Googlebot|bingbot|facebookexternalhit|Slackbot|Twitterbot|preview|prefetch|validator/i;
        if (botPatterns.test(userAgent)) {
            console.log(`[pixel] Skipped bot/prefetch for ${emailId}: ${userAgent}`);
            return;
        }

        insertOpen.run({ email_id: emailId, opened_at: openedAt, user_agent: userAgent });
        const openCount = getOpensForEmail.all(emailId).length;
        console.log(`[pixel] Open #${openCount} for email ${emailId} (to: ${email.recipient})`);

    } catch (err) {
        console.error('[pixel] Tracking error:', err.message);
    }
});

module.exports = router;
