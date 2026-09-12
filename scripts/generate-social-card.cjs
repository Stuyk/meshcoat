const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const iconPath = path.join(rootDir, 'build/icon.png');
const screenshot1Path = path.join(rootDir, 'docs/screenshots/base-screenshot.png');

const iconBase64 = fs.existsSync(iconPath) ? fs.readFileSync(iconPath).toString('base64') : '';
const screenshot1Base64 = fs.existsSync(screenshot1Path) ? fs.readFileSync(screenshot1Path).toString('base64') : '';

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MeshCoat - Social Card</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      width: 1280px;
      height: 640px;
      overflow: hidden;
      background: #0a0a0c;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      position: relative;
    }

    .screenshot {
      position: absolute;
      inset: 0;
      width: 1280px;
      height: 640px;
      object-fit: cover;
      object-position: center 30%;
      filter: saturate(1.05) brightness(0.96);
    }

    .scrim {
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, rgba(6,6,8,0.05) 0%, rgba(6,6,8,0.05) 40%, rgba(6,6,8,0.55) 68%, rgba(6,6,8,0.92) 100%);
    }

    .frame-border {
      position: absolute;
      inset: 0;
      border: 1px solid rgba(255,255,255,0.08);
      pointer-events: none;
    }

    .footer {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 30px 48px 34px;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .app-icon {
      width: 56px;
      height: 56px;
      border-radius: 13px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.14);
      display: block;
      flex-shrink: 0;
    }

    .brand-text h1 {
      font-size: 34px;
      font-weight: 800;
      letter-spacing: -0.8px;
      color: #ffffff;
      line-height: 1.1;
    }

    .brand-text p {
      margin-top: 4px;
      font-size: 15.5px;
      font-weight: 500;
      color: #c4c4c9;
      letter-spacing: -0.1px;
    }

    .meta {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }

    .repo {
      font-size: 13.5px;
      font-weight: 600;
      color: #d4d4d8;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .platforms {
      display: flex;
      gap: 6px;
    }

    .platform-pill {
      font-size: 11px;
      font-weight: 700;
      color: #a1a1aa;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.14);
      padding: 3px 9px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <img src="data:image/png;base64,${screenshot1Base64}" class="screenshot" alt="MeshCoat screenshot" />
  <div class="scrim"></div>
  <div class="frame-border"></div>

  <div class="footer">
    <div class="brand">
      <img src="data:image/png;base64,${iconBase64}" class="app-icon" alt="MeshCoat icon" />
      <div class="brand-text">
        <h1>MeshCoat</h1>
        <p>Fast, focused 3D texture painting for game devs & 3D artists</p>
      </div>
    </div>
    <div class="meta">
      <span class="repo">github.com/stuyk/meshcoat</span>
      <div class="platforms">
        <span class="platform-pill">Windows</span>
        <span class="platform-pill">Linux</span>
        <span class="platform-pill">macOS</span>
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

  app.quit();
});
