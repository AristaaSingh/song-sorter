const fs = require('fs');
const path = require('path');
const os = require('os');

const configPath = path.join(os.homedir(), 'Library', 'Application Support', 'song-sorter', 'config.json');

try {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  delete cfg.accessToken;
  delete cfg.refreshToken;
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  console.log('Tokens cleared. Restart the app to re-authenticate.');
} catch (e) {
  console.error('Failed:', e.message);
}
