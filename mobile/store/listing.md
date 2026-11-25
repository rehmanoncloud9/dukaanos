# DukaanOS — Google Play Store Listing (EN + اردو)

**Package ID:** `pk.dukaanos.app`  
**Category:** Business / Finance  
**Target Audience:** 18+ (Not directed to children under 13)  
**Privacy Policy URL:** `https://<PROD_WEB_HOST>/privacy`  
**Account Deletion URL:** `https://<PROD_WEB_HOST>/delete-account`

---

## English Listing

### App Title (<= 30 chars)
`DukaanOS`

### Short Description (<= 80 chars)
`Urdu voice & parchi kiryana ledger. Cash, udhaar & stock — offline-first.`

### Full Description (<= 4000 chars)
DukaanOS is a voice-first digital munshi built for Pakistani kiryana and general stores. Speak naturally in Urdu, Punjabi, Roman Urdu, or English — or snap a photo of a handwritten wholesale parchi — to record cash sales, split udhaar entries, customer wasooli, and supplier restocks in seconds.

**Designed for real shop counters:**
- **Speak Naturally:** Handle fractional local units (`dedh pao`, `sawa kilo`, `dhai darjan`) and value-first orders (`250 ka khula oil`) accurately with deterministic integer-paisa calculations.
- **Khata & Fast Recovery:** Track customer balances, identify overdue accounts, record wasooli payments, and send polite bilingual receipts or payment reminders via WhatsApp or 2G SMS (`wa.me` / `sms:`).
- **Wholesale Parchi Scan:** Snap crinkled supplier slips, check handwritten vs computed line math (`Use computed` / `Keep slip`), add new SKUs on the fly, and commit restocks safely.
- **Offline Queue:** Record voice or typed entries without internet connectivity; entries queue safely on-device in SQLite and sync idempotently on reconnect with zero duplicates.
- **Tamper-Evident Ledger:** Double-entry balanced accounting (`DR = CR`) chained with SHA-256 hashes.
- **SMEConnect Trade Passport:** Generate an owner-consented 30-day trade summary with an Ed25519-signed QR code and PDF export. Informational summary only — never a credit score or tax filing.
- **Sirf Aap Ka Record:** Zero FBR linkage, zero CNIC collection, and full JSON data export or instant in-app account deletion.

---

## Urdu Listing (اردو تفصیل)

### عنوان
`دکان او ایس (DukaanOS)`

### مختصر تفصیل
`اردو آواز اور پرچی سے دکان کا کھاتہ، نقد، ادھار اور اسٹاک — آف لائن سہولت کے ساتھ`

### مکمل تفصیل
دکان او ایس پاکستانی کریانہ اور جنرل اسٹورز کے لیے بنایا گیا ایک تیز اور آسان ڈیجیٹل منشی ہے۔ اردو، پنجابی یا رومن اردو میں بولیں یا ہول سیل پرچی کی تصویر کھینچیں — اور سیکنڈوں میں کیش سیل، ادھار، وصولی اور مال کا اسٹاک محفوظ کریں۔

- **مقامی پیمانے:** پاؤ، کلو، درجن اور کھلے مال کا درست حساب۔
- **کھاتہ اور وصولی:** گاہکوں کا بقایا دیکھیں اور واٹس ایپ یا عام ایس ایم ایس (2G) کے ذریعے باوقار رسید اور یاددہانی بھیجیں۔
- **پرچی اسکین:** سپلائر کی ہاتھ سے لکھی پرچی اسکین کر کے حساب کی تصدیق اور نیا مال شامل کریں۔
- **آف لائن موڈ:** انٹرنیٹ نہ ہونے پر بھی اندراج محفوظ رہتا ہے اور کنکشن بحال ہونے پر خودکار سنک ہو جاتا ہے۔
- **صرف آپ کا ریکارڈ:** ایف بی آر سے کوئی تعلق نہیں، کوئی شناختی کارڈ نمبر درکار نہیں۔ آپ جب چاہیں اپنا تمام ڈیٹا JSON میں ڈاؤن لوڈ کر سکتے ہیں یا اکاؤنٹ حذف کر سکتے ہیں۔

---

## Runtime Permissions Declaration (Play Console)

| Permission | Feature | Rationale shown to user |
| :--- | :--- | :--- |
| `android.permission.RECORD_AUDIO` | Hold-to-Talk Voice Entry | Used strictly while pressing Hold-to-Talk on the Munshi counter to record short shop clips for ledger extraction. Denied permission falls back to typed input. |
| `android.permission.CAMERA` | Wholesale Parchi OCR Scan | Used only inside Parchi Scan to photograph supplier invoices. Gallery selection remains available if denied. |
| Blocked Permissions | Explicitly stripped in `app.config.ts` | `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `READ_MEDIA_*`, `SYSTEM_ALERT_WINDOW`. |

---

## Store Graphic & Screenshot Checklist

All raster source exports from `public/icon.svg` live in `mobile/store/`:
- `icon-1024.png` (1024x1024)
- `adaptive-foreground-1024.png` (1024x1024)
- `adaptive-background-1024.png` (1024x1024)
- `adaptive-monochrome-1024.png` (1024x1024)
- `splash-icon-512.png` (512x512)
- `feature-graphic-1024x500.png` (1024x500 Play Store banner)

### 8 Required Device Screenshots (`1080x1920`, capture from real Android phone once EAS build is installed)
1. **Munshi Home Counter:** Today Cash / Today Udhaar pulse + chronological feed + Hold-to-Talk dock.
2. **Tier-2 Chaotic Voice Review:** 3-Ali disambiguation chips + `QuickAdd` SKU + split Cash/Khata preview.
3. **`</> X-Ray Inspector`:** 4 numbered engineering proof rows + `Replay Test -> 200 OK · 0 Dupes`.
4. **Khata Receivable & Overdue Filter:** Hero total + Overdue rows with `Wasooli` / `WhatsApp` / `SMS (2G)`.
5. **Maal Inventory & Negative Stock Banner:** `4dp` stock bars + `Scan Parchi` CTA.
6. **Parchi OCR Review:** Crinkled slip thumbnail + `MATH_MISMATCH` `Use computed` vs `Keep slip` + `Restock Commit`.
7. **SMEConnect Trade Passport:** Dark Apple Wallet card + `SIG VALID ✓` + scannable Ed25519 QR.
8. **Settings & Data Rights:** EN/اردو toggle, Offline Queue / Simulate Offline, JSON Export, Delete Account.
