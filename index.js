require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const cookieParser = require('cookie-parser');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cookieParser());

// ==========================================
// 1. AUTH & DASHBOARD ROUTER
// ==========================================
const authRouter = express.Router();
authRouter.use(express.json());
authRouter.use(express.urlencoded({ extended: true }));

authRouter.get('/github', (req, res) => {
    const redirectUri = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&scope=repo`;
    res.redirect(redirectUri);
});

authRouter.get('/github/callback', async (req, res) => {
    try {
        const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code: req.query.code
        }, { headers: { Accept: 'application/json' } });

        const accessToken = tokenResponse.data.access_token;
        const userResponse = await axios.get('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const githubId = userResponse.data.id.toString();

        await supabase.from('users').upsert({
            github_id: githubId,
            access_token: accessToken
        }, { onConflict: 'github_id' });

        // Set a secure cookie to keep the user logged in, then redirect to the dashboard
        res.cookie('github_id', githubId, { httpOnly: true });
        res.redirect('/dashboard');
    } catch (error) {
        res.status(500).send('Authentication failed.');
    }
});

app.use('/auth', authRouter);

// ==========================================
// 2. THE UI DASHBOARD (Core Req 6)
// ==========================================
app.get('/dashboard', async (req, res) => {
    // Security check: Make sure they are logged in via the cookie
    const userId = req.cookies.github_id;
    if (!userId) {
        return res.status(401).send(`
            <div style="font-family: sans-serif; padding: 2rem;">
                <h2>Unauthorized</h2>
                <p>You must log in to view the dashboard.</p>
                <a href="/auth/github">Login with GitHub</a>
            </div>
        `);
    }

    // Fetch the logs from Supabase
    const { data: events, error } = await supabase.from('webhook_events').select('*').limit(50);
    if (error) return res.status(500).send('Error loading dashboard data');

    // Generate HTML rows for the table
    const tableRows = events.map(event => `
        <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">${event.event_type}</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${event.payload.action || 'N/A'}</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${event.delivery_id}</td>
        </tr>
    `).join('');

    // Serve the HTML page directly from Express
    res.send(`
        <html>
        <head>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
            <title>Bot Dashboard</title>
            <style>
                body { font-family: sans-serif; padding: 2rem; background-color: #f4f4f9; }
                table { width: 100%; border-collapse: collapse; background: white; margin-top: 20px; }
                th { background-color: #000; color: white; padding: 10px; text-align: left; }
            </style>
        </head>
        <body>
            <h1>🤖 Bot Activity Log</h1>
            <p>Welcome! Here is a live log of everything your bot has processed.</p>
            <table>
                <tr>
                    <th>Event Type</th>
                    <th>Action</th>
                    <th>Delivery ID</th>
                </tr>
                ${tableRows}
            </table>
        </body>
        </html>
    `);
});

// ==========================================
// 3. THE BULLETPROOF WEBHOOK RECEIVER (Core Reqs 2, 3, 4)
// ==========================================
app.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
    res.status(202).send('Accepted');

    if (!req.body) return;
    const rawBuffer = req.body;

    const signature = req.headers['x-hub-signature-256'];
    if (!signature) return;

    const hmac = crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET);
    if (signature !== 'sha256=' + hmac.update(rawBuffer).digest('hex')) return;

    let rawString = rawBuffer.toString();
    if (rawString.startsWith('payload=')) rawString = decodeURIComponent(rawString.substring(8));

    try {
        const payload = JSON.parse(rawString);
        const eventType = req.headers['x-github-event'];
        const deliveryId = req.headers['x-github-delivery'];

        // Idempotency Check
        const { data: existing } = await supabase.from('webhook_events').select('*').eq('delivery_id', deliveryId).single();
        if (existing) return;

        // Log to database (This populates the dashboard!)
        await supabase.from('webhook_events').insert({ delivery_id: deliveryId, event_type: eventType, payload: payload });

        // --- BOT LOGIC (Handles multiple event types) ---
        
        // Scenario 1: Issues
        if (eventType === 'issues' && payload.action === 'opened' && payload.issue.title.toLowerCase().includes('bug')) {
            const ownerId = payload.repository.owner.id.toString();
            const { data: user } = await supabase.from('users').select('access_token').eq('github_id', ownerId).single();
            
            if (user) {
                await axios.post(`https://api.github.com/repos/${payload.repository.full_name}/issues/${payload.issue.number}/labels`, 
                    { labels: ['bug'] }, { headers: { Authorization: `Bearer ${user.access_token}` } });
                
                if (process.env.SLACK_WEBHOOK_URL) {
                    await axios.post(process.env.SLACK_WEBHOOK_URL, { text: `🚨 Bug found: ${payload.issue.title}` });
                }
            }
        } 
        // Scenario 2: Pull Requests (With AI Summary!)
        else if (eventType === 'pull_request' && payload.action === 'opened') {
            
            // 1. Ask the AI to summarize the PR
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const aiPrompt = `Summarize this GitHub Pull Request in one very short sentence. Title: ${payload.pull_request.title}. Body: ${payload.pull_request.body || 'No description provided.'}`;
            
            let aiSummary = "No summary available.";
            try {
                const result = await model.generateContent(aiPrompt);
                aiSummary = result.response.text();
            } catch (aiError) {
                console.error("AI Error:", aiError);
            }

            // 2. Send the AI summary to Slack
            if (process.env.SLACK_WEBHOOK_URL) {
                await axios.post(process.env.SLACK_WEBHOOK_URL, { 
                    text: `🚀 *New Pull Request:* ${payload.pull_request.title}\n🤖 *AI Summary:* ${aiSummary}` 
                });
            }
        }

    } catch (error) {
        console.error('❌ Processing Error:', error.message);
    }
});

app.listen(3000, () => console.log(`🚀 Server running on http://localhost:3000`));