---
name: offline-architecture-guide
description: 100% 離線優先 (Offline-First) 系統架構設計指南，確保零外網依賴、本機資料持久化與隱私安全。
tags:
  - architecture
  - offline
---
# Offline-First Architecture Guide

本技能提供離線優先應用程式的設計準則：

- **零外部網路請求**：所有靜態資源、圖示、字型與樣式均打包於本機。
- **本機資料主權**：設定檔與技能庫儲存於使用者個人目錄 (`~/.skills-manager`)，支援隨時匯出與匯入標準 ZIP 壓縮檔。
- **跨工具無縫同步**：透過 Symlink / Junction 或實體複製將技能部署至 GitHub Copilot、Claude Code、OpenAI Codex 等工具的個人資料夾。
