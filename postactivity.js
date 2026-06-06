const fetch = require('node-fetch');

const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';
const ACTIVITY_SECRET = process.env.ACTIVITY_SECRET;

async function postActivity(event) {
    if (!ACTIVITY_SECRET) return;
    try {
        await fetch(`${SITE_URL}/api/public/activity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...event, secret: ACTIVITY_SECRET }),
        });
    } catch {}
}

module.exports = { postActivity };