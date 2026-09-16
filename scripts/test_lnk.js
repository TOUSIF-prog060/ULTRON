const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const startDir = path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
function findLnk(dir) {
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) {
        const res = findLnk(full);
        if (res) return res;
      } else if (f.name.endsWith('.lnk')) return full;
    }
  } catch (e) {}
}
const lnk = findLnk(startDir);
console.log('Found lnk:', lnk);

console.log('--- Test Start-Process ---');
try {
  execSync(`powershell -NoProfile -Command "Start-Process '${lnk.replace(/'/g, "''")}'"`);
  console.log('Start-Process SUCCESS');
} catch (e) {
  console.log('Start-Process FAILED:', e.stderr?.toString() || e.message);
}

console.log('--- Test Invoke-Item ---');
try {
  execSync(`powershell -NoProfile -Command "Invoke-Item '${lnk.replace(/'/g, "''")}'"`);
  console.log('Invoke-Item SUCCESS');
} catch (e) {
  console.log('Invoke-Item FAILED:', e.stderr?.toString() || e.message);
}

console.log('--- Test cmd start ---');
try {
  execSync(`cmd.exe /c start "" "${lnk}"`);
  console.log('cmd start SUCCESS');
} catch (e) {
  console.log('cmd start FAILED:', e.stderr?.toString() || e.message);
}
