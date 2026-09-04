# ADR-001 — Integrasi WhatsApp memakai Baileys

**Status:** Disetujui dan diimplementasikan  
**Terakhir diverifikasi terhadap kode:** 31 Agustus 2026

## Keputusan

MIFABOT menggunakan `@whiskeysockets/baileys` sebagai satu-satunya integrasi WhatsApp. Aplikasi membutuhkan Node.js 20 atau lebih baru dan menyimpan sesi Baileys dalam direktori yang ditentukan oleh `BAILEYS_AUTH_DIR`.

`BAILEYS_AUTH_DIR` adalah konfigurasi wajib; runtime tidak menyediakan nilai default. Direktori sesi, `.env`, dan file service account Google Drive tidak boleh disimpan di Git.

## Perilaku yang berjalan

- Saat sesi belum terhubung, QR pairing dicetak ke terminal. Kredensial terbaru disimpan setiap event `creds.update`.
- Ketika koneksi putus selain karena logout, bot mencoba menyambung kembali setelah 3 detik. Jika logout, operator harus mengosongkan isi `BAILEYS_AUTH_DIR` lalu melakukan pairing ulang.
- Bot menerima pesan percakapan pribadi dan grup, tetapi sebagian besar command bisnis hanya boleh digunakan melalui chat pribadi. `Idgrup` khusus grup; `Ping` dapat dipakai untuk memeriksa bot aktif.
- Pesan dapat diawali `!`, `/`, `\\`, `mifabot`, atau `bot` (misalnya `!Cek profil` atau `MIFABOT: Bayar SPP 30000`). Pembayaran memakai bentuk generik `Bayar <nama tagihan> <nominal>`; `Bayar bulanan` hanya bekerja bila terdapat definisi bernama `Bulanan`.
- Untuk chat pribadi berbasis LID, adapter memakai `remoteJidAlt` bila tersedia agar nomor WhatsApp dapat dicocokkan dengan data pengguna.
- Pendaftaran mandiri (`Daftar`) dan perubahan profil sendiri (`Edit profile`)
  hanya berjalan di chat pribadi. Adapter menyimpan sesi bertahap per nomor
  pengirim selama paling lama 10 menit; `Batal` menghapus sesi tanpa menulis
  data. Pesan tahap lanjutan ditangani sebelum command biasa.
- `Daftar` membuat akun `USER` aktif hanya setelah nama lengkap, username,
  nomor WhatsApp milik pengirim, dan jenis kelamin `L`/`P` seluruhnya valid.
  Nomor pengirim yang telah memiliki record pengguna (aktif atau tidak aktif)
  ditolak. `Edit profile` hanya dapat mengubah satu dari nama lengkap,
  username, nomor WhatsApp, atau jenis kelamin milik pengguna aktif; role dan
  status tidak dapat diubah melalui percakapan tersebut.
- Adapter WhatsApp mengunduh file Excel dan bukti foto, tetapi aturan tagihan, pembayaran, dan import tetap berada di modul domain.
- Pengiriman reminder memakai `sock.sendMessage`. Reminder otomatis dan manual
  dicatat sebagai delivery yang dapat diaudit; otomatis dideduplikasi per
  bill dan aturan, sedangkan command manual dicatat per batch.

## Konfigurasi terkait

```text
BAILEYS_AUTH_DIR=./storage/baileys-auth
SUPER_ADMIN_WHATSAPP=628xxxxxxxxxx
APP_TIMEZONE=Asia/Jakarta
```

`SUPER_ADMIN_WHATSAPP` dipakai sebagai otorisasi root berbasis konfigurasi untuk command operasional tertentu. Mekanismenya berbeda dari role `SUPER_ADMIN` pada database; lihat dokumentasi command untuk rinciannya.

## Batasan

Baileys berinteraksi dengan WhatsApp Web, bukan WhatsApp Business Cloud API. Perubahan perilaku WhatsApp Web atau Baileys perlu dipantau dalam operasi production. Pengiriman massal dan spam bukan bagian dari MIFABOT.

## Rujukan

- [Repository resmi Baileys](https://github.com/WhiskeySockets/Baileys)
- [Panduan quickstart Baileys](https://github.com/WhiskeySockets/docs/blob/main/quickstart.mdx)
