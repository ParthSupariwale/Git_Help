const vscode = require('vscode');
const { Octokit } = require('@octokit/rest');
const fetch = require('node-fetch').default;

// ========== Configuration ==========
let GEMINI_API_KEY;
let githubToken;
let octokit;

// ========== Global Variables ==========
let isTracking = false;
let activityLog = [];
let idleTimeout;
let statusBar;
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const COMMIT_INTERVAL = 60 * 60 * 1000; // 60 minutes

// ========== Activation ==========
async function activate(context) {
  try {
    // 1. Get GitHub Token
    githubToken = await vscode.window.showInputBox({
      prompt: '🔑 Enter GitHub Personal Access Token (repo scope)',
      password: true
    });

    if (!githubToken) {
      vscode.window.showErrorMessage('GitHub token is required!');
      return;
    }

    // Wait 5 seconds before asking for Gemini key
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 2. Get Gemini Key
    GEMINI_API_KEY = await vscode.window.showInputBox({
      prompt: '🔑 Enter Google Gemini API Key',
      password: true
    });

    if (!GEMINI_API_KEY) {
      vscode.window.showErrorMessage('Gemini API key is required!');
      return;
    }

    // 3. Initialize Services
    octokit = new Octokit({ auth: githubToken });
    await createCodeTrackingRepo();

    // 4. Setup Activity Listeners
    setupActivityListeners(context);

    // 5. Initialize Status Bar
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    updateStatusBar(true);
    statusBar.show();

    // 6. Start Tracking
    startTracking();

  } catch (error) {
    vscode.window.showErrorMessage(`Activation failed: ${error.message}`);
  }
}

// ========== Activity Tracking ==========
function setupActivityListeners(context) {
  const subscriptions = [
    vscode.workspace.onDidChangeTextDocument((e) => {
      activityLog.push(`Edited ${e.document.fileName}`);
      handleUserActivity();
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      activityLog.push(`Saved ${doc.fileName}`);
      handleUserActivity();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => handleUserActivity()),
    vscode.window.onDidChangeWindowState(() => handleUserActivity())
  ];

  subscriptions.forEach(listener => context.subscriptions.push(listener));
}

function handleUserActivity() {
  if (!isTracking) {
    isTracking = true;
    updateStatusBar(true);
    vscode.window.showInformationMessage('Resuming activity tracking!');
  }
  resetIdleTimer();
}

function resetIdleTimer() {
  clearTimeout(idleTimeout);
  idleTimeout = setTimeout(() => {
    isTracking = false;
    updateStatusBar(false);
    vscode.window.showWarningMessage('Tracking paused due to 30 minutes of inactivity');
  }, IDLE_TIMEOUT);
}

// ========== Tracking Control ==========
function startTracking() {
  if (!isTracking) {
    isTracking = true;
    resetIdleTimer();
    setInterval(() => {
      if (isTracking) commitActivity();
    }, COMMIT_INTERVAL);
  }
}

function updateStatusBar(active) {
  statusBar.text = active ? '$(pulse) Tracking' : '$(circle-slash) Tracking Paused';
  statusBar.tooltip = active ? 
    'Active tracking - Will commit hourly' : 
    'Paused due to inactivity - Start typing to resume';
}

// ========== GitHub Integration ==========
async function createCodeTrackingRepo() {
  try {
    await octokit.repos.createForAuthenticatedUser({
      name: 'code-tracking',
      private: true
    });
    vscode.window.showInformationMessage('✅ Created code-tracking repo!');
  } catch (error) {
    if (error.status === 422) {
      vscode.window.showInformationMessage('ℹ️ code-tracking repo already exists!');
    }
  }
}

// ========== Commit Logic ==========
async function commitActivity() {
  if (!isTracking || activityLog.length === 0) {
    vscode.window.showInformationMessage('No activity to commit');
    return;
  }

  try {
    const summary = await generateAISummary(activityLog.join('\n'));
    const date = new Date().toLocaleString('en-US', { 
      timeZone: 'Asia/Kolkata', // Replace with user's timezone
      hour12: false 
    });
    
    await octokit.repos.createOrUpdateFileContents({
      owner: (await octokit.users.getAuthenticated()).data.login,
      repo: 'code-tracking',
      path: `log-${date}.txt`,
      message: `Activity at ${date}`,
      content: Buffer.from(summary).toString('base64')
    });
    
    vscode.window.showInformationMessage('✅ Hourly progress saved to GitHub!');
    activityLog = [];
  } catch (error) {
    vscode.window.showErrorMessage(`❌ Commit failed: ${error.message}`);
  }
}

// ========== AI Integration ==========
async function generateAISummary(text) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Summarize coding activity in 1 line: ${text || "No activity logged"}`
            }]
          }]
        })
      }
    );

    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  } catch (error) {
    return text || "No activity logged";
  }
}

module.exports = { activate };
