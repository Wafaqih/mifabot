# Struktur File MIFABOT

**Status:** Struktur yang ada pada kode saat ini  
**Terakhir diperbarui:** 31 Agustus 2026

```text
MIFABOT/
├── database/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_receiver_based_payment_confirmation.sql
│   │   ├── 003_monthly_reminder_deduplication.sql
│   │   ├── 003_payment_submission_model.sql
│   │   ├── 004_fix_admin_assignment_trigger_schema.sql
│   │   ├── 005_dynamic_billing_definitions.sql
│   │   ├── 006_harden_dynamic_billing_responsible_trigger.sql
│   │   └── 007_dynamic_billing_reminders.sql
│   └── seeds/
│       └── 001_development_seed.sql
├── docs/
│   ├── architecture/
│   │   ├── 001-whatsapp-baileys.md
│   │   ├── 002-kebijakan-tagihan-pembayaran.md
│   │   └── 003-tagihan-dinamis.md
│   └── commands.md
├── src/
│   ├── config/
│   │   └── env.ts
│   ├── core/
│   │   ├── database/               # Pool, transaksi, dan runner migration
│   │   └── logger/
│   ├── integrations/
│   │   ├── storage/                # Google Drive dan validasi bukti foto
│   │   └── whatsapp/               # Baileys, parser command, dan adapter pesan
│   ├── jobs/
│   │   └── billing-reminder.job.ts
│   ├── modules/
│   │   ├── access/                 # Lookup user, root auth, profil, help, penugasan
│   │   ├── billing/                # Definisi tagihan, rate, override, PJ, periode, dan tunggakan
│   │   ├── notifications/          # Rule, delivery, retry, dan audit reminder dinamis
│   │   ├── payments/               # Channel, pengajuan, keputusan, alokasi
│   │   └── users/                  # Parser dan import Excel identitas santri
│   ├── scripts/                    # CLI migrate, seed, dan db-check
│   └── index.ts                    # Bootstrap WhatsApp dan scheduler bill/reminder
├── tests/
│   └── unit/
├── storage/
│   ├── baileys-auth/               # Runtime, diabaikan Git
│   └── google-service-account.json # Runtime, diabaikan Git
├── .env.example
├── package.json
├── ERD MIFABOT v1.md
├── SKEMA DATABASE MIFABOT v1.md
├── SISTEM TAGIHAN DAN TUNGGAKAN.md
└── BLUEPRINT MIFABOT v1.md
```

`dist/` adalah hasil build TypeScript dan tidak menjadi sumber dokumentasi. Runner migration mengurutkan nama file secara leksikografis dan mencatat file yang telah diterapkan di `public.schema_migrations`.

## Batas tanggung jawab

| Lokasi | Tanggung jawab aktual |
| --- | --- |
| `integrations/whatsapp` | Koneksi Baileys, normalisasi command, state percakapan sementara, unduh media, dan pengiriman pesan. |
| `modules/access` | Lookup user aktif, normalisasi nomor WhatsApp, otorisasi root konfigurasi, profil, help, daftar santri, dan penugasan admin. |
| `modules/billing` | Definisi tagihan, nominal global/override, PJ, penerbitan bill idempoten, scheduler interval, serta query bill/tunggakan. |
| `modules/payments` | Validasi nominal/bukti, channel, pengajuan, keputusan, dan alokasi pembayaran dalam transaksi database. |
| `modules/users` | Validasi workbook Excel dan upsert identitas santri. Import tidak mengatur nominal tagihan. |
| `modules/notifications` | Rule reminder per tagihan, klaim/retry delivery otomatis, pengiriman manual, dan audit batch. |
| `integrations/storage` | Implementasi `StorageProvider` Google Drive serta validasi MIME/ukuran foto bukti. |
| `jobs` | Menerbitkan bill `WEEKLY`/`MONTHLY`/`YEARLY` sesuai periode dan mengevaluasi reminder dinamis harian. |
| `src/scripts` | Menjalankan migration, seed development, dan pemeriksaan koneksi database. |

Direktori placeholder `routing`, `reports`, dan `audit` dapat ada, tetapi belum memiliki implementasi runtime. Tabel `audit_logs` memang tersedia pada skema database, tetapi belum ada modul yang menulisnya.

## Dokumen desain dinamis

Model tagihan dan reminder dicatat di [ADR-003](docs/architecture/003-tagihan-dinamis.md). Migration 005–007 menambah struktur database secara aditif; menjalankan `npm run db:migrate` diperlukan sebelum adapter/service memakai tabel dinamis.

## Konfigurasi runtime

Semua nilai berikut wajib diisi kecuali `NODE_ENV` dan `APP_TIMEZONE`.

```text
DATABASE_URL
BAILEYS_AUTH_DIR
STORAGE_DRIVER=GOOGLE_DRIVE
GOOGLE_DRIVE_FOLDER_ID
GOOGLE_SERVICE_ACCOUNT_KEY_PATH
SUPER_ADMIN_WHATSAPP
APP_TIMEZONE=Asia/Jakarta
NODE_ENV=development
```

`STORAGE_DRIVER` saat ini hanya menerima `GOOGLE_DRIVE`; tidak ada driver local aktif. Folder Google Drive harus dibagikan ke service account yang ditunjuk oleh `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`.

## Perintah pengembangan

```text
npm run dev          # Jalankan bot TypeScript dengan watch
npm run build        # Kompilasi ke dist/
npm run typecheck    # Pemeriksaan TypeScript tanpa output build
npm run db:check     # Periksa koneksi PostgreSQL
npm run db:migrate   # Jalankan migration yang belum diterapkan
npm run db:seed      # Jalankan seed development
npm run test:unit    # Jalankan test unit
```
