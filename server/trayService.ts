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

// Clean 16x16 Teal/Cyan "S" Icon encoded as Base64 PNG for macOS / Linux System Tray (100% offline)
const TRAY_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAcklEQVR4nGNgoBAwInN4p3T8J0bT55wKuD4mUjWjq2UiVTO6ISy4FHzKLkfh803txKoOqwEwzbg0IQMmgirIMQBm86fscjgm2QV8UzvhGGYYSQYQC/AGIrqLiDaAmNCHAerEAnLaJhbA9DChC5CimSoAADzGKlDZK2OQAAAAAElFTkSuQmCC';

// Clean 16x16 Teal/Cyan "S" Icon encoded as Base64 Windows BMP-ICO (.ico) for Win32 Shell_NotifyIcon / LoadImage
const TRAY_ICON_ICO_BASE64 =
  'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAiJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/wAAAAAAAAAAAAAAAAAAAAAAAAAAiJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/AAAAAAAAAAAAAAAAiJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf8AAAAAAAAAAIiUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/AAAAAAAAAACIlA3/iJQN/4iUDf+IlA3///////////////////////////+IlA3/iJQN/4iUDf+IlA3/iJQN/wAAAAAAAAAAiJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf///////////4iUDf+IlA3/iJQN/4iUDf8AAAAAAAAAAIiUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3///////////+IlA3/iJQN/4iUDf+IlA3/AAAAAAAAAACIlA3/iJQN/4iUDf+IlA3/iJQN//////////////////////+IlA3/iJQN/4iUDf+IlA3/iJQN/wAAAAAAAAAAiJQN/4iUDf+IlA3/iJQN////////////iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf8AAAAAAAAAAIiUDf+IlA3/iJQN/4iUDf///////////4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/AAAAAAAAAACIlA3/iJQN/4iUDf+IlA3/iJQN//////////////////////+IlA3/iJQN/4iUDf+IlA3/iJQN/wAAAAAAAAAAiJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf8AAAAAAAAAAAAAAACIlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf8AAAAAAAAAAAAAAAAAAAAAAAAAAIiUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf+IlA3/iJQN/4iUDf8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAOAHAADAAwAAgAEAAIABAACAAQAAgAEAAIABAACAAQAAgAEAAIABAACAAQAAgAEAAMADAADgBwAA//8AAA==';

function getPlatformTrayIconBase64(): string {
  return process.platform === 'win32' ? TRAY_ICON_ICO_BASE64 : TRAY_ICON_PNG_BASE64;
}

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

// Prepares tray binaries across Windows, macOS, and Linux:
// 1. Pre-copies `tray_*` binaries from node_modules/systray2/traybin into ~/.cache/node-systray/<version>/
//    so `copyDir: true` works smoothly even across drives (e.g. D:\ project vs C:\Users\...) on Windows.
// 2. Strips Windows Zone.Identifier ADS stream if present (prevents SmartScreen blocking spawn).
// 3. Sets executable permissions (0o755) on macOS / Linux.
function ensureTrayBinariesReady(): void {
  const chmodOrUnblockFile = (filePath: string) => {
    if (process.platform === 'win32') {
      try {
        // Remove NTFS Zone.Identifier Alternate Data Stream if downloaded from web/zip
        const adsPath = `${filePath}:Zone.Identifier`;
        if (fs.existsSync(adsPath)) {
          fs.unlinkSync(adsPath);
        }
      } catch {
        // Ignore if not supported or not present
      }
    } else {
      try {
        fs.chmodSync(filePath, 0o755);
      } catch {
        // Ignore if read-only
      }
    }
  };

  const processDirRecursive = (dirPath: string) => {
    if (!fs.existsSync(dirPath)) return;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          processDirRecursive(full);
        } else if (entry.isFile() && entry.name.startsWith('tray_')) {
          chmodOrUnblockFile(full);
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
    processDirRecursive(dir);
  }

  // 2. Pre-populate ~/.cache/node-systray/<version>/tray_*
  const cacheDir = path.join(os.homedir(), '.cache', 'node-systray');
  processDirRecursive(cacheDir);

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
              chmodOrUnblockFile(s);
              chmodOrUnblockFile(d);
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

    // Skip on headless Linux where neither X11 DISPLAY nor Wayland is available
    if (
      process.platform === 'linux' &&
      !process.env.DISPLAY &&
      !process.env.WAYLAND_DISPLAY
    ) {
      console.log(
        '[SystemTray] 當前環境處於無桌面模式 (No DISPLAY)，已自動退回純本機服務模式'
      );
      this.isRunning = false;
      return false;
    }

    try {
      ensureTrayBinariesReady();

      const SysTrayModule = await import('systray2');
      const SysTray = (SysTrayModule as any).default || SysTrayModule;

      const separatorItem = SysTray.separator || {
        title: '<SEPARATOR>',
        tooltip: '',
        checked: false,
        enabled: true,
      };

      const presets = this.store.getDb().presets;
      const presetItems = presets.map((p) => ({
        title: `${p.active ? '✓ ' : '   '}場景：${p.name} (${p.skillIds.length})`,
        tooltip: p.description || p.name,
        checked: Boolean(p.active),
        enabled: true,
        click: () => {
          this.skillManager.applyPreset(p.id, !p.active);
        },
      }));

      const menuItems = [
        {
          title: '開啟 Skills Manager 網頁控制台 (127.0.0.1)',
          tooltip: '在預設瀏覽器開啟本機管理介面',
          checked: false,
          enabled: true,
          click: () => openUrlInLocalBrowser(this.getServerUrl()),
        },
        separatorItem,
        ...(presetItems.length > 0 ? [...presetItems, separatorItem] : []),
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
        separatorItem,
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
      ];

      const menu = {
        icon: getPlatformTrayIconBase64(),
        title: 'Skills',
        tooltip: 'Skills & Agents & MCP Manager — 本機離線管理中心',
        items: menuItems,
      };

      // Use copyDir: true on Windows so tray_windows_release.exe runs from ~/.cache/node-systray
      // instead of failing when the project lives on another drive (e.g. D:\) or locked folder.
      this.systrayInstance = new SysTray({
        menu,
        debug: false,
        copyDir: process.platform === 'win32',
      });

      if (typeof this.systrayInstance?.onError === 'function') {
        this.systrayInstance.onError((err: any) => {
          console.log(
            `[SystemTray] 系統常駐列非致命提示，本機服務維持正常運作 (${err?.message || 'tray warning'})`
          );
          this.isRunning = false;
        });
      }

      const internalProcess =
        this.systrayInstance?._process || this.systrayInstance?.process || null;
      if (internalProcess && typeof internalProcess.on === 'function') {
        internalProcess.on('error', (err: any) => {
          console.log(
            `[SystemTray] 系統匣執行檔略過，已自動維持純本機服務模式 (${err?.message || 'spawn error'})`
          );
          this.isRunning = false;
        });
      }

      // Defensive guard: only attach onClick and await ready() when internal process / readline is initialized,
      // preventing `TypeError: Cannot read properties of null (reading 'on')` on Windows.
      if (typeof this.systrayInstance?.ready === 'function') {
        await this.systrayInstance.ready();
      }

      if (this.systrayInstance?._rl && typeof this.systrayInstance?.onClick === 'function') {
        this.systrayInstance.onClick((action: any) => {
          const clickedItem = action?.item || menuItems[action?.seq_id];
          if (clickedItem && typeof clickedItem.click === 'function') {
            clickedItem.click();
          }
        });
      } else if (typeof this.systrayInstance?.onClick === 'function') {
        try {
          this.systrayInstance.onClick((action: any) => {
            const clickedItem = action?.item || menuItems[action?.seq_id];
            if (clickedItem && typeof clickedItem.click === 'function') {
              clickedItem.click();
            }
          });
        } catch {
          // Ignore if readline interface was not created
        }
      }

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
