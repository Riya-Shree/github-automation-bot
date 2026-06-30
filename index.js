require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// We need raw bodies for the webhook signature verification later
app.use('/webhook', bodyParser.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 1. GITHUB OAUTH FLOW
// ==========================================

// Step A: Redirect user to GitHub to authorize the app
app.get('/auth/github', (req, res) => {
    const redirectUri = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&scope=repo`;
    res.redirect(redirectUri);
});

// Step B: GitHub redirects back here with a temporary code
app.get('/auth/github/callback', async (req, res) => {
    const code = req.query.code;
    
    if (!code) {
        return res.status(400).send('No code provided by GitHub');
    }

    try {
        // 1. Exchange the code for an Access Token
        const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code: code
        }, { 
            headers: { Accept: 'application/json' } 
        });

        const accessToken = tokenResponse.data.access_token;

        // 2. Use the token to get the user's GitHub profile info
        const userResponse = await axios.get('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const githubId = userResponse.data.id.toString();

        // 3. Save or update the user securely in Supabase
        const { error } = await supabase.from('users').upsert({
            github_id: githubId,
            access_token: accessToken
        }, { onConflict: 'github_id' });

        if (error) throw error;

        res.send(`
            <h1>Login Successful! 🎉</h1>
            <p>Your GitHub account is connected. You can now configure a webhook on your GitHub repository to point to your server.</p>
        `);
    } catch (error) {
        console.error('Authentication error:', error.response?.data || error.message);
        res.status(500).send('Authentication failed. Check your terminal logs.');
    }
});

// Start the server
const PORT = process.env.PORT || 3000;

// ==========================================
// 2. SECURITY: WEBHOOK SIGNATURE VERIFICATION
// ==========================================
function verifyGitHubSignature(req, res, next) {
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) {
        return res.status(401).send('No signature found');
    }

    // Hash our payload with our secret
    const hmac = crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET);
    const digest = 'sha256=' + hmac.update(req.body).digest('hex');

    // Compare the hashes securely
    if (signature !== digest) {
        return res.status(401).send('Unauthorized: Signature mismatch');
    }
    next();
}

// ==========================================
// 3. WEBHOOK RECEIVER & IDEMPOTENCY
// ==========================================
app.post('/webhook', verifyGitHubSignature, async (req, res) => {
    const deliveryId = req.headers['x-github-delivery'];
    const eventType = req.headers['x-github-event'];
    
    // Convert raw buffer back to JSON object
    const payload = JSON.parse(req.body.toString());

    // 1. Acknowledge receipt immediately (Prevents GitHub timeouts)
    res.status(202).send('Accepted');

    try {
        // 2. Idempotency Check: Have we seen this event before?
        const { data: existingEvent } = await supabase
            .from('webhook_events')
            .select('*')
            .eq('delivery_id', deliveryId)
            .single();

        if (existingEvent) {
            console.log(`Event ${deliveryId} already processed. Skipping.`);
            return;
        }

        // 3. Log the event in the database as 'pending'
        const { error: insertError } = await supabase.from('webhook_events').insert({
            delivery_id: deliveryId,
            event_type: eventType,
            payload: payload,
            status: 'pending'
        });

        if (insertError) throw insertError;
        
        console.log(`✅ Received new ${eventType} event! Delivery ID: ${deliveryId}`);

        // TODO: In the next step, we will add the bot logic here!

    } catch (error) {
        console.error('Error handling webhook:', error);
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`👉 Test the login flow by visiting: http://localhost:${PORT}/auth/github`);
});