const express = require('express');
const router = express.Router();
const { insertEmail, getEmails, getEmail, getOpensForEmail } = require('../db');

// POST /api/emails — register a new tracked email
router.post('/', (req, res) => {
    const { id, recipient, subject, sender_email } = req.body;

    if (!id || !recipient || !subject || !sender_email) {
        return res.status(400).json({ error: 'Missing required fields: id, recipient, subject, sender_email' });
    }

    const sent_at = new Date().toISOString();

    try {
        insertEmail.run({ id, recipient, subject, sent_at, sender_email });
        res.json({ success: true, id, sent_at });
    } catch (err) {
        console.error('[emails] Insert failed:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/emails — list all tracked emails with open stats
router.get('/', (req, res) => {
    try {
        const emails = getEmails.all();
        res.json({ emails });
    } catch (err) {
        console.error('[emails] Query failed:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/emails/:id/opens — get open history for one email
router.get('/:id/opens', (req, res) => {
    const email = getEmail.get(req.params.id);
    if (!email) return res.status(404).json({ error: 'Email not found' });

    const opens = getOpensForEmail.all(req.params.id);
    res.json({ email, opens });
});

module.exports = router;
