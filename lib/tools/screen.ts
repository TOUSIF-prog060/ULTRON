import fs from "fs";
import os from "os";
import path from "path";
import { exec } from "child_process";

// Captures the primary screen (all monitors bounding box) to a JPEG and
// returns it as a base64 data URL. Windows-only, via a small inline
// .NET/PowerShell snippet — no native dependency. The temp file is
// deleted immediately after reading.
export function captureScreenBase64(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      return reject(new Error("Screen capture is currently implemented for Windows only."));
    }

    const outFile = path.join(os.tmpdir(), `ultron-screen-${Date.now()}.jpg`);
    const escaped = outFile.replace(/\\/g, "\\\\");

    const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]70)
$bmp.Save("${escaped}", $enc, $params)
$g.Dispose(); $bmp.Dispose()
`.trim();

    const cmd = `powershell -NoProfile -STA -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, "; ")}"`;

    exec(cmd, { timeout: 15000, maxBuffer: 1024 * 1024 }, (err) => {
      if (err || !fs.existsSync(outFile)) {
        return reject(new Error(`Screen capture failed: ${err?.message || "no image produced"}`));
      }
      try {
        const buf = fs.readFileSync(outFile);
        fs.unlink(outFile, () => {});
        resolve(`data:image/jpeg;base64,${buf.toString("base64")}`);
      } catch (readErr: any) {
        reject(new Error(`Screen capture read failed: ${readErr.message}`));
      }
    });
  });
}

const READONLY_PS_ALLOW = /^(Get-|Test-|Measure-|Select-|Where-|Sort-|Format-|Out-|Resolve-|Convert|Compare-|Find-|Show-|Read-Host|\$|Write-Output|echo)/i;
const PS_DENY = /(Remove-|Stop-|Start-Process|Set-|New-Item|Clear-|Rename-|Move-|Copy-Item|Invoke-Expression|iex|Invoke-WebRequest|curl|wget|rm |del |rd |format |Restart-|Disable-|Enable-|Uninstall-|Install-|reg |schtasks|shutdown)/i;

export function runReadonlyPowershell(command: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      return resolve({ success: false, output: "PowerShell inspection is Windows-only." });
    }
    const cmd = command.trim();
    if (PS_DENY.test(cmd) || !READONLY_PS_ALLOW.test(cmd)) {
      return resolve({
        success: false,
        output: `Refused: "${cmd}" is not a recognised read-only command. Only inspection commands (Get-*, Test-*, Measure-*, Select-*) are allowed here.`,
      });
    }
    exec(
      `powershell -NoProfile -Command "${cmd.replace(/"/g, '\\"')}"`,
      { timeout: 12000, maxBuffer: 512 * 1024 },
      (err, stdout, stderr) => {
        if (err) return resolve({ success: false, output: stderr || err.message });
        resolve({ success: true, output: (stdout || "").trim() || "(no output)" });
      }
    );
  });
}
