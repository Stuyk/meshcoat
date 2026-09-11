const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const iconPath = path.join(rootDir, 'build/icon.png');
const screenshot1Path = path.join(rootDir, 'screenshots/02-waveform-slicing.png');

const iconBase64 = fs.existsSync(iconPath) ? fs.readFileSync(iconPath).toString('base64') : '';
const screenshot1Base64 = fs.existsSync(screenshot1Path) ? fs.readFileSync(screenshot1Path).toString('base64') : '';

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Slip Sound - Real Screenshot Social Card</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      width: 1280px;
      height: 640px;
      overflow: hidden;
      background: #08090d;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', Helvetica, Arial, sans-serif;
      position: relative;
      user-select: none;
    }

    /* Ambient background glows */
    .bg-grid {
      position: absolute;
      inset: 0;
      background-image: radial-gradient(circle, rgba(255, 255, 255, 0.055) 1px, transparent 1px);
      background-size: 28px 28px;
      opacity: 0.65;
    }

    .glow-blue {
      position: absolute;
      top: -100px;
      right: 40px;
      width: 760px;
      height: 600px;
      background: radial-gradient(ellipse at center, rgba(59, 130, 246, 0.3) 0%, rgba(37, 99, 235, 0.12) 45%, transparent 70%);
      pointer-events: none;
    }

    .glow-amber {
      position: absolute;
      bottom: -110px;
      left: 120px;
      width: 580px;
      height: 440px;
      background: radial-gradient(ellipse at center, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.05) 50%, transparent 70%);
      pointer-events: none;
    }

    /* Card Frame Outer Border */
    .card-border {
      position: absolute;
      inset: 0;
      border: 1.5px solid rgba(255, 255, 255, 0.12);
      pointer-events: none;
    }

    /* Main Flex Layout */
    .container {
      position: relative;
      z-index: 10;
      display: flex;
      width: 100%;
      height: 100%;
      padding: 44px 50px;
      gap: 40px;
      align-items: center;
      justify-content: space-between;
    }

    /* Left Branding & High-Readability Info Column */
    .left-col {
      flex: 0 0 520px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 100%;
      padding-top: 2px;
      padding-bottom: 2px;
    }

    .brand-header {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .brand-row {
      display: flex;
      align-items: center;
      gap: 18px;
    }

    .app-icon {
      width: 68px;
      height: 68px;
      border-radius: 16px;
      box-shadow: 0 10px 28px -4px rgba(59, 130, 246, 0.6), 0 0 0 1.5px rgba(255, 255, 255, 0.2);
      background: #18181b;
      display: block;
      flex-shrink: 0;
    }

    .brand-title-wrap {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .brand-title {
      font-size: 46px;
      font-weight: 900;
      letter-spacing: -1.2px;
      line-height: 1;
      color: #ffffff;
      text-shadow: 0 2px 14px rgba(0, 0, 0, 0.6);
    }

    .brand-pill-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .pill-free {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(34, 197, 94, 0.16);
      border: 1px solid rgba(34, 197, 94, 0.45);
      color: #4ade80;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      padding: 3px 9px;
      border-radius: 9999px;
    }

    .pill-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 8px #22c55e;
    }

    .pill-local {
      display: inline-flex;
      align-items: center;
      background: rgba(59, 130, 246, 0.16);
      border: 1px solid rgba(59, 130, 246, 0.45);
      color: #60a5fa;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      padding: 3px 9px;
      border-radius: 9999px;
    }

    .tagline {
      font-size: 18.5px;
      line-height: 1.4;
      color: #e4e4e7;
      font-weight: 500;
      letter-spacing: -0.2px;
      margin-top: 2px;
    }

    .tagline-accent {
      color: #38bdf8;
      font-weight: 700;
    }

    /* Value Proposition Cards */
    .highlights-box {
      display: flex;
      flex-direction: column;
      gap: 11px;
      margin: 6px 0;
    }

    .highlight-card {
      display: flex;
      align-items: center;
      gap: 14px;
      background: rgba(24, 24, 27, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 10px 16px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }

    .highlight-icon-box {
      font-size: 19px;
      width: 34px;
      height: 34px;
      border-radius: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .hi-blue { background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); }
    .hi-amber { background: rgba(245, 158, 11, 0.2); border: 1px solid rgba(245, 158, 11, 0.4); }
    .hi-green { background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.4); }

    .highlight-text {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .highlight-title {
      font-size: 15px;
      font-weight: 750;
      color: #ffffff;
      letter-spacing: -0.2px;
    }

    .highlight-desc {
      font-size: 13px;
      color: #a1a1aa;
      font-weight: 500;
    }

    /* Footer Meta Row */
    .meta-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }

    .repo-tag {
      display: flex;
      align-items: center;
      gap: 9px;
      font-size: 14px;
      color: #d4d4d8;
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .github-icon-svg {
      width: 18px;
      height: 18px;
      fill: #ffffff;
    }

    .platform-pills {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .os-pill {
      font-size: 12px;
      font-weight: 700;
      color: #a1a1aa;
      background: #18181b;
      padding: 3px 10px;
      border-radius: 6px;
      border: 1px solid #3f3f46;
    }

    /* Right Showcase Column (Real Screenshot in Desktop Frame) */
    .right-col {
      flex: 1;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 6px;
      perspective: 1200px;
    }

    .window-card-wrapper {
      position: relative;
      transform: rotateY(-5deg) rotateX(2.5deg) rotateZ(-0.8deg);
    }

    .window-card {
      width: 610px;
      height: 485px;
      background: #121215;
      border-radius: 12px;
      border: 1.5px solid rgba(255, 255, 255, 0.18);
      box-shadow:
        0 25px 70px -15px rgba(0, 0, 0, 0.95),
        0 8px 24px -8px rgba(0, 0, 0, 0.75),
        0 0 50px rgba(59, 130, 246, 0.28);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .window-titlebar {
      height: 34px;
      background: #181920;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      padding: 0 14px;
      gap: 12px;
      flex-shrink: 0;
    }

    .window-dots {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .dot-red { background: #ef4444; }
    .dot-yellow { background: #f59e0b; }
    .dot-green { background: #22c55e; }

    .window-title {
      font-size: 11.5px;
      font-weight: 600;
      color: #94a3b8;
      flex: 1;
      text-align: center;
      margin-right: 38px;
      letter-spacing: 0.2px;
    }

    .window-screen {
      flex: 1;
      width: 100%;
      height: calc(100% - 34px);
      overflow: hidden;
      position: relative;
      background: #09090b;
    }

    .screen-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: left bottom;
      display: block;
    }

    /* Floating Real Feature Callout Badge */
    .floating-badge-bottom {
      position: absolute;
      bottom: -16px;
      left: 20px;
      background: rgba(18, 18, 22, 0.96);
      backdrop-filter: blur(16px);
      border: 1.5px solid rgba(245, 158, 11, 0.55);
      border-radius: 10px;
      padding: 9px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.85), 0 0 24px rgba(245, 158, 11, 0.3);
      z-index: 30;
    }

    .fb-icon {
      font-size: 16px;
      width: 28px;
      height: 28px;
      border-radius: 7px;
      background: rgba(245, 158, 11, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .fb-text {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .fb-title {
      font-size: 11px;
      font-weight: 800;
      color: #f59e0b;
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }

    .fb-desc {
      font-size: 13.5px;
      font-weight: 700;
      color: #f4f4f5;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .floating-badge-top {
      position: absolute;
      top: -16px;
      right: 20px;
      background: rgba(18, 18, 22, 0.96);
      backdrop-filter: blur(16px);
      border: 1.5px solid rgba(59, 130, 246, 0.55);
      border-radius: 10px;
      padding: 8px 15px;
      display: flex;
      align-items: center;
      gap: 9px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.85), 0 0 24px rgba(59, 130, 246, 0.3);
      z-index: 30;
    }

    .fbt-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #3b82f6;
      box-shadow: 0 0 10px #3b82f6;
    }

    .fbt-text {
      font-size: 12.5px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.2px;
    }

    .fbt-sub {
      color: #60a5fa;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="bg-grid"></div>
  <div class="glow-blue"></div>
  <div class="glow-amber"></div>
  <div class="card-border"></div>

  <div class="container">
    <!-- Left Column: Bold Typography & Core Value Props -->
    <div class="left-col">
      <div class="brand-header">
        <div class="brand-row">
          <img src="data:image/png;base64,${iconBase64}" class="app-icon" alt="Icon" />
          <div class="brand-title-wrap">
            <h1 class="brand-title">Slip Sound</h1>
            <div class="brand-pill-row">
              <span class="pill-free"><span class="pill-dot"></span>100% Free</span>
              <span class="pill-local">Local-First</span>
            </div>
          </div>
        </div>

        <p class="tagline">
          The instant audio sample manager & slicer for <span class="tagline-accent">game devs & sound designers</span>.
        </p>
      </div>

      <!-- High-Impact Value Cards (Clear at small thumbnail sizes) -->
      <div class="highlights-box">
        <div class="highlight-card">
          <div class="highlight-icon-box hi-blue">⚡</div>
          <div class="highlight-text">
            <span class="highlight-title">Instant Full-Text Search</span>
            <span class="highlight-desc">178,000+ sounds indexed with &lt; 1ms SQLite FTS</span>
          </div>
        </div>

        <div class="highlight-card">
          <div class="highlight-icon-box hi-amber">✂️</div>
          <div class="highlight-text">
            <span class="highlight-title">In-Place Waveform Slicing</span>
            <span class="highlight-desc">Audition slice regions & drag directly to your DAW</span>
          </div>
        </div>

        <div class="highlight-card">
          <div class="highlight-icon-box hi-green">📦</div>
          <div class="highlight-text">
            <span class="highlight-title">Batch Audio Exporter</span>
            <span class="highlight-desc">Convert & resample to WAV / OGG with zero limits</span>
          </div>
        </div>
      </div>

      <!-- Footer Meta -->
      <div class="meta-row">
        <div class="repo-tag">
          <svg class="github-icon-svg" viewBox="0 0 24 24">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          <span>github.com/stuyk/slip-sound</span>
        </div>
        <div class="platform-pills">
          <span class="os-pill">Windows</span>
          <span class="os-pill">Linux</span>
        </div>
      </div>
    </div>

    <!-- Right Column: REAL SCREENSHOT in Elevated Frame -->
    <div class="right-col">
      <div class="window-card-wrapper">
        <div class="floating-badge-top">
          <div class="fbt-dot"></div>
          <div class="fbt-text">178,420 <span class="fbt-sub">Sounds Loaded</span></div>
        </div>

        <div class="window-card">
          <div class="window-titlebar">
            <div class="window-dots">
              <div class="dot dot-red"></div>
              <div class="dot dot-yellow"></div>
              <div class="dot dot-green"></div>
            </div>
            <div class="window-title">Slip Sound - Library & Waveform Preview</div>
          </div>
          <div class="window-screen">
            <img src="data:image/png;base64,${screenshot1Base64}" class="screen-img" alt="Slip Sound Live Screenshot" />
          </div>
        </div>

        <div class="floating-badge-bottom">
          <div class="fb-icon">✂️</div>
          <div class="fb-text">
            <span class="fb-title">Waveform Region Slicing</span>
            <span class="fb-desc">0.28s - 0.65s (0.37s)</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

const htmlFilePath = path.join(rootDir, 'screenshots/github-social-card.html');
fs.writeFileSync(htmlFilePath, htmlContent, 'utf8');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 640,
    show: false,
    useContentSize: true,
    webPreferences: {
      offscreen: true
    }
  });

  await win.loadURL('file://' + htmlFilePath);
  await new Promise(r => setTimeout(r, 600));

  console.log('Capturing real screenshot social card at 1280x640...');
  const image = await win.webContents.capturePage();
  const pngBuffer = image.toPNG();

  const cardPath = path.join(rootDir, 'screenshots/github-social-card.png');
  fs.writeFileSync(cardPath, pngBuffer);
  console.log('Saved Social Card to:', cardPath);

  const docsPath = path.join(rootDir, 'docs/social-preview.png');
  fs.writeFileSync(docsPath, pngBuffer);
  console.log('Saved Docs Social Preview to:', docsPath);

  const artifactPath = '/home/stuyk/.gemini/antigravity/brain/fce324d8-0493-4b2d-bb83-b07abca70f77/github-social-card.png';
  fs.writeFileSync(artifactPath, pngBuffer);
  console.log('Saved Artifact to:', artifactPath);

  app.quit();
});
