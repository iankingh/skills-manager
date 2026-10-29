import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { LocalStore } from './store.js';
import { SkillManager } from './skillManager.js';
import { ZipAndFolderService } from './zipService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Clean 16x16 Teal/Cyan "S" Icon encoded as Base64 PNG for System Tray (100% offline, zero external assets)
const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABMSURBVDhPYxgFo2AUjALSwI8fP/7jwwzUADZ0NQMDAwMjIyMDLgNQNcA0gA9A14BNA1wDNg24NMA0gN2A/0B8H4hJBaNgFIwC0gAA85c5Ed0c7fAAAAAASUVORK5CYII=';

export function openUrlInLocalBrowser(url: string): void {
  try {
    if (process.platform === 'darwin') {
      execFile('open', [url]);
    } else if (process.platform === 'win32') {
      execFile('cmd.exe', ['/c', 'start', '', url]);
    } else {
      execFile('xdg-open', [url]);
    }
  } catch {
    // Ignore on headless machines
  }
}

export function openFolderInOSFileManager(folderPath: string): void {
  try {
    if (process.platform === 'darwin') {
      execFile('open', [folderPath]);
    } else if (process.platform === 'win32') {
      execFile('explorer.exe', [folderPath]);
    } else {
      execFile('xdg-open', [folderPath]);
    }
  } catch {
    // Ignore on headless machines
  }
}

// Fixes macOS / Linux `spawn .../tray_darwin_release EACCES` permission error.
// Ensures both node_modules/systray2/traybin and ~/.cache/node-systray have executable permissions (0o755).
function ensureTrayBinariesExecutable(): void {
  if (process.platform === 'win32') return;

  const chmodRecursive = (dirPath: string) => {
    if (!fs.existsSync(dirPath)) return;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          chmodRecursive(full);
        } else if (entry.isFile() && entry.name.startsWith('tray_')) {
          try {
            fs.chmodSync(full, 0o755);
          } catch {
            // Ignore if read-only
          }
        }
      }
    } catch {
      // Ignore directory read error
    }
  };

  // 1. Check node_modules/systray2/traybin
  const candidateModuleDirs = [
    path.resolve(__dirname, '../node_modules/systray2/traybin'),
    path.resolve(__dirname, '../../node_modules/systray2/traybin'),
    path.resolve(process.cwd(), 'node_modules/systray2/traybin'),
  ];
  for (const dir of candidateModuleDirs) {
    chmodRecursive(dir);
  }

  // 2. Pre-populate and chmod ~/.cache/node-systray/<version>/tray_darwin_release
  const cacheDir = path.join(os.homedir(), '.cache', 'node-systray');
  chmodRecursive(cacheDir);

  // Also pre-copy from node_modules/systray2/traybin into ~/.cache/node-systray/<version> with 0o755
  try {
    const pkgPaths = [
      path.resolve(__dirname, '../node_modules/systray2/package.json'),
      path.resolve(__dirname, '../../node_modules/systray2/package.json'),
      path.resolve(process.cwd(), 'node_modules/systray2/package.json'),
    ];
    for (const pkgPath of pkgPaths) {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const ver = pkg.version || '2.1.4';
        const srcTrayBin = path.join(path.dirname(pkgPath), 'traybin');
        const dstTrayBin = path.join(cacheDir, ver);
        if (fs.existsSync(srcTrayBin)) {
          fs.mkdirSync(dstTrayBin, { recursive: true });
          for (const f of fs.readdirSync(srcTrayBin)) {
            if (f.startsWith('tray_')) {
              const s = path.join(srcTrayBin, f);
              const d = path.join(dstTrayBin, f);
              if (!fs.existsSync(d)) {
                fs.copyFileSync(s, d);
              }
              fs.chmodSync(s, 0o755);
              fs.chmodSync(d, 0o755);
            }
          }
        }
        break;
      }
    }
  } catch {
    // Ignore pre-copy errors
  }
}

export class SystemTrayService {
  private systrayInstance: any = null;
  private isRunning = false;

  constructor(
    private store: LocalStore,
    private skillManager: SkillManager,
    private zipService: ZipAndFolderService,
    private getServerUrl: () => string
  ) {}

  public async startTray(): Promise<boolean> {
    if (!this.store.getSettings().trayEnabled) {
      return false;
    }
    if (this.isRunning) return true;

    try {
      ensureTrayBinariesExecutable();

      const SysTrayModule = await import('systray2');
      const SysTray = (SysTrayModule as any).default || SysTrayModule;

      const presets = this.store.getDb().presets;
      const presetItems = presets.map((p) => ({
        title: `${p.active ? '✓ ' : '   '}場景：${p.name} (${p.skillIds.length})`,
        tooltip: p.description,
        checked: p.active,
        enabled: true,
        click: () => {
          this.skillManager.applyPreset(p.id, !p.active);
        },
      }));

      const menu = {
        icon: TRAY_ICON_BASE64,
        title: 'Skills',
        tooltip: 'Skills & Agents & MCP Manager — 本機離線管理中心',
        items: [
          {
            title: '開啟 Skills Manager 網頁控制台 (127.0.0.1)',
            tooltip: '在預設瀏覽器開啟本機管理介面',
            checked: false,
            enabled: true,
            click: () => openUrlInLocalBrowser(this.getServerUrl()),
          },
          SysTray.separator,
          ...presetItems,
          SysTray.separator,
          {
            title: '重新掃描所有 AI 工具個人資料夾',
            tooltip: '立即掃描 ~/.copilot、~/.claude、~/.agents 等目錄',
            checked: false,
            enabled: true,
            click: () => {
              this.skillManager.listCentralSkills();
              this.skillManager.scanAgentWorkspace();
            },
          },
          {
            title: '一鍵建立本機離線 ZIP 備份快照',
            tooltip: '將目前所有技能打包備份至 ~/.skills-manager/backups/',
            checked: false,
            enabled: true,
            click: () => {
              this.zipService.createLocalSnapshot('由 System Tray 建立的快速備份');
            },
          },
          {
            title: '開啟中央 Skills 資料夾 (~/.skills-manager/skills)',
            tooltip: '在檔案總管 / Finder 開啟本機技能資料夾',
            checked: false,
            enabled: true,
            click: () => {
              openFolderInOSFileManager(this.store.getSkillsDir());
            },
          },
          SysTray.separator,
          {
            title: '結束 Skills Manager 本機服務 (Quit)',
            tooltip: '停止 Node.js 本機服務並退出常駐列',
            checked: false,
            enabled: true,
            click: () => {
              this.stopTray();
              process.exit(0);
            },
          },
        ],
      };

      this.systrayInstance = new SysTray({
        menu,
        debug: false,
        copyDir: false,
      });

      if (typeof this.systrayInstance.onError === 'function') {
        this.systrayInstance.onError((err: any) => {
          console.log(
            `[SystemTray] 系統常駐列非致命提示，本機服務維持正常運作 (${err?.message || 'tray warning'})`
          );
          this.isRunning = false;
        });
      }
      if (this.systrayInstance._process && typeof this.systrayInstance._process.on === 'function') {
        this.systrayInstance._process.on('error', (err: any) => {
          console.log(
            `[SystemTray] 系統匣執行檔略過，已自動維持純本機服務模式 (${err?.message || 'EACCES'})`
          );
          this.isRunning = false;
        });
      }

      this.systrayInstance.onClick((action: any) => {
        if (action.item && typeof action.item.click === 'function') {
          action.item.click();
        }
      });

      await this.systrayInstance.ready();
      this.isRunning = true;
      console.log('[SystemTray] 常駐系統列 (System Tray) 已啟動');
      return true;
    } catch (err: any) {
      console.log(
        `[SystemTray] 當前環境不支援原生系統匣或處於無桌面模式，已自動退回純本機服務模式 (${err?.message || 'headless'})`
      );
      this.isRunning = false;
      return false;
    }
  }

  public stopTray(): void {
    if (this.systrayInstance) {
      try {
        this.systrayInstance.kill(false);
      } catch {
        // Ignore
      }
      this.systrayInstance = null;
      this.isRunning = false;
    }
  }

  public getStatus(): { active: boolean; enabledInSettings: boolean } {
    return {
      active: this.isRunning,
      enabledInSettings: this.store.getSettings().trayEnabled,
    };
  }
}
