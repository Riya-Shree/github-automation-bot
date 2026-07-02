# GitHub Automation Bot

An event-driven backend service that reacts to GitHub repository activity. Built with Node.js, Express, and Supabase.

## Live Deployment

**Dashboard URL:** https://my-github-automation-bot.onrender.com/dashboard
_(Note: You must log in via GitHub to view the dashboard)_

## Local Development Setup

To run this bot on your local machine:

1. **Clone the repository:**
   \`\`\`bash
   git clone https://github.com/Riya-Shree/github-automation-bot.git
   cd github-automation-bot
   npm install
   \`\`\`

2. **Environment Variables:**
   Create a `.env` file in the root directory. You can use the provided `.env.example` as a template. You will need:
   - GitHub OAuth App credentials (Client ID & Secret)
   - A Supabase project URL and Anon Key
   - A Slack Webhook URL
   - A Google Gemini API Key
   - A custom Webhook Secret string

3. **Start the server:**
   \`\`\`bash
   npm start
   \`\`\`
   The server will run on `http://localhost:3000`. (Note: To receive live webhooks locally, you will need to expose your localhost using a tool like ngrok).

## Features Completed (Core & Stretch)

- **OAuth Authentication:** Secure GitHub login flow.
- **Webhook Processing:** Securely verifies `x-hub-signature-256` cryptographic signatures to prevent forged requests.
- **Idempotency:** Utilizes Supabase to log `delivery_id`s, ensuring the same event is never processed twice.
- **Multi-Event Handling:** Listens for both `issues` and `pull_request` events.
- **Automated Actions:** Automatically adds a `bug` label to qualifying issues via the GitHub API and sends notifications via the Slack Webhook API.
- **Live UI Dashboard:** A protected route that queries the database to display a real-time log of all processed events.
- **Stretch Goal (AI Integration):** Utilizes the Google Gemini API (`gemini-1.5-flash`) to read the title and body of new Pull Requests, generate a one-sentence summary, and include it in the Slack notification.

## How to Test

1. Visit the Live Dashboard URL above and log in with your GitHub account.
2. In the connected repository, open a new Issue with the word "bug" in the title, or open a new Pull Request.
3. Observe the automated label added to the issue, or the AI-generated summary sent to Slack for the PR.
4. Refresh the Dashboard URL to see the newly logged webhook event.
