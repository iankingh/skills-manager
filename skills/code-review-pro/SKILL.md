---
name: code-review-pro
description: 離線專業程式碼審查與重構建議規範，檢查型別安全、邊界條件、效能瓶頸與安全性漏洞。
tags:
  - review
  - quality
  - security
---
# Code Review Pro (本機離線規範)

當執行程式碼審查 (Code Review) 時，請依序檢查以下核心面向：

1. **邊界條件與錯誤處理**：確認空值 (null/undefined)、空陣列、非預期輸入皆有防禦性處理。
2. **安全性檢查**：禁止路徑穿越 (Path Traversal)、SQL/指令注入與硬編碼密鑰。
3. **可讀性與模組化**：函式職責單一，命名清晰，並維持一致的型別定義。
