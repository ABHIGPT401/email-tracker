const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'changeme';

// --- Middleware ---
app.use(cors({
    origin: '*', // Chrome extension doesn't have an origin like a website
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
}));
app.use(express.json());

// --- API key auth (applied only to /api/* routes) ---
function requireApiKey(req, res, next) {
    const key = req.headers['x-api-key'];
    if (!key || key !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized — invalid API key' });
    }
    next();
}

// --- Routes ---
// Pixel route — no auth needed (recipient's email client loads this)
app.use('/pixel', require('./routes/pixel'));

// API routes — require API key
app.use('/api/emails', requireApiKey, require('./routes/emails'));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// --- Start ---
app.listen(PORT, () => {
    console.log(`[server] Email tracker running on port ${PORT}`);
    console.log(`[server] Pixel URL format: http://localhost:${PORT}/pixel/<emailId>.gif`);
    if (process.env.API_KEY === 'changeme' || !process.env.API_KEY) {
        console.warn('[server] WARNING: Using default API key. Set API_KEY env variable for production!');
    }
});
