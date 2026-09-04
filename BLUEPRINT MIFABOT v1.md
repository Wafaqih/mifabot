# BLUEPRINT MIFABOT

**Status:** Model tagihan dinamis diimplementasikan  
**Terakhir diperbarui:** 1 September 2026

MIFABOT adalah bot WhatsApp untuk administrasi santri: profil, tagihan, pengajuan pembayaran, impor data, dan administrasi operator.

Model target adalah **tagihan dinamis**. SPP, daftar ulang, pendidikan, kesejahteraan, atau iuran lain adalah nama data yang dibuat operator—bukan jenis tagihan yang ditanam permanen di kode. Detail desainnya ada di [ADR-003](docs/architecture/003-tagihan-dinamis.md).

## Status ringkas

| Area | Arah produk | Status yang perlu diperhatikan |
| --- | --- | --- |
| Definisi tagihan | Operator membuat nama, nominal, interval, dan PJ sendiri. | Service, command WhatsApp, dan migration 005–007 tersedia; lihat [referensi command](docs/commands.md). |
| Nominal | Nominal global untuk semua santri aktif, dengan override untuk santri tertentu. | Perubahan berlaku periode berikutnya dan tidak mengubah bill terbit. |
| PJ | Satu tagihan dapat memiliki banyak PJ. | `Add PJ` dapat mempromosikan target menjadi `ADMIN`; `Del PJ` tidak mendemosi role. |
| Scheduler | Mingguan, bulanan, dan tahunan digerakkan per definisi. | Berjalan sekitar pukul 05.00 pada hari/periode yang sesuai. |
| `CUSTOM` | Operator menentukan periode serta jatuh tempo ketika menerbitkan bill. | Command `Terbitkan tagihan` tersedia; tidak dibuat scheduler otomatis. |
| Pembayaran | Pengguna membayar berdasarkan nama tagihan, bukan jenis tetap. | Pengajuan bill berjalan/tunggakan, keputusan PJ, dan pencatatan langsung oleh PJ tersedia. |
| Reminder | Aturan otomatis per tagihan memakai offset dari jatuh tempo; PJ dapat mengirim manual. | `Set reminder` untuk Super Admin dan `Reminder` untuk PJ aktif/Super Admin tersedia. |

## Pengguna dan otorisasi

| Identitas | Penggunaan |
| --- | --- |
| `USER` | Santri aktif yang dapat melihat profil/tagihan dan mengajukan pembayaran dirinya sendiri. |
| `ADMIN` | Admin operasional, termasuk user yang dipromosikan oleh `Add PJ`. |
| `SUPER_ADMIN` | Pengelola tingkat sistem. Command pengelolaan tagihan dan PJ merupakan hak Super Admin. |
| Root konfigurasi | Nomor `SUPER_ADMIN_WHATSAPP`. Pada adapter WhatsApp lama, root ini independen dari record `users` dan dipakai untuk import/penugasan. |

Permission pada tabel `roles`, `permissions`, dan `role_permissions` belum merupakan enforcement per-command di runtime lama. Selama transisi, dokumentasi command menyebut otorisasi yang benar-benar diperiksa adapter.

Semua pengguna WhatsApp yang di-resolve bot harus `AKTIF`. Nomor WhatsApp disimpan sebagai digit internasional tanpa `+`, misalnya `628123456789`.

## Model tagihan dinamis

Setiap definisi tagihan menyimpan:

```text
nama tagihan
→ nominal global
→ interval: mingguan | bulanan | tahunan | custom
→ satu atau lebih PJ
→ status aktif/nonaktif
```

Definisi baru menunggu PJ pertama sebelum aktif. Setelah aktif, ia berlaku bagi seluruh santri `AKTIF` ber-role `USER`. Jika nominal sejumlah santri perlu berbeda, gunakan override dengan command:

```text
Set nominal <nama tagihan> <nominal baru>
<username/nomor_whatsapp per baris | Semua>
```

`Semua` dipakai sendiri pada satu baris untuk nominal global. Target individual dibuat atomik: kesalahan satu target membatalkan seluruh perubahan. Nominal baru dipakai saat periode bill berikutnya diterbitkan; bill yang sudah ada tetap memakai snapshot nominal lama.

PJ dikelola dengan:

```text
Add PJ <nama tagihan> <username/nomor_whatsapp>
Del PJ <nama tagihan> <username/nomor_whatsapp>
```

Satu PJ dapat mengelola banyak tagihan dan satu tagihan dapat memiliki banyak PJ. `Del PJ` menonaktifkan relasi untuk menjaga histori, bukan menghapus data historis ataupun otomatis menurunkan role target.

## Siklus bill yang berjalan

| Interval | Perilaku |
| --- | --- |
| Mingguan | Satu bill per Senin–Minggu, diterbitkan setiap Senin sekitar pukul 05.00. |
| Bulanan | Satu bill tanggal 1–akhir bulan, diterbitkan tanggal 1 sekitar pukul 05.00 dan jatuh tempo tanggal 5. |
| Tahunan | Satu bill 1 Januari–31 Desember, diterbitkan 1 Januari sekitar pukul 05.00 dan jatuh tempo 5 Januari. |
| Custom | Operator menentukan `periode_mulai`, `periode_selesai`, dan `jatuh_tempo`, lalu menerbitkan bill dengan `Terbitkan tagihan`. |

Bill menyimpan referensi definisi beserta snapshot nama dan nominal. Tunggakan tetap bukan tabel tersendiri: suatu bill menjadi tunggakan bila periodenya berakhir dan masih memiliki sisa.

## Alur pembayaran target

Pengguna mengajukan pembayaran berdasarkan tagihan yang dinyatakan secara eksplisit:

```text
Bayar <nama tagihan> <nominal>
```

Bot mencari bill berjalan dari definisi tersebut, meminta channel pembayaran, dan meminta bukti untuk metode non-cash. Pengajuan user tetap berstatus `PENDING` sampai diputuskan PJ penerima channel. Nominal lebih kecil dari sisa bill dapat menjadi cicilan; kelebihan pembayaran ditolak.

Untuk tunggakan, pengguna mengirim `Bayar tunggakan <nama tagihan>`, lalu memilih satu atau beberapa periode yang akan dibayar penuh dan channel pembayarannya. PJ penerima channel memeriksa pengajuan dengan `List pengajuan`, lalu menggunakan `Setujui <nomor>` atau `Tolak <nomor> <alasan>`. Persetujuan membuat alokasi pembayaran dan keputusan dikirimkan kepada santri.

Pemilihan channel dan verifikasi harus dirutekan melalui PJ aktif tagihan, bukan pemetaan unit legacy. Detail alur yang benar-benar dapat dipakai selalu mengikuti [referensi command](docs/commands.md).

## Reminder tagihan

Reminder tidak lagi terbatas pada tagihan bulanan. Super Admin mengatur
offset terhadap jatuh tempo per definisi:

```text
Set reminder <nama tagihan> H-7 H-3 H-0
Set reminder <nama tagihan> off
```

Scheduler harian hanya mengirim untuk bill yang masih bersisa dan
mendeduplikasi delivery otomatis per aturan–bill. PJ aktif atau Super Admin
dapat mengirim segera melalui `Reminder <nama tagihan>`; pengulangan manual
disimpan sebagai batch audit baru. Ini juga berlaku untuk bill `CUSTOM` setelah
operator menentukan jatuh temponya.

## Bridge legacy

Enum jenis tagihan tetap, `tariffs`, dan penugasan unit `BENDAHARA`/`PENDIDIKAN`/`KESEJAHTERAAN` tetap disimpan sebagai bridge data. Elemen tersebut bukan model produk baru dan tidak dipakai routing tagihan baru.

Deployment tetap harus menjalankan migration 005–007. Rujukan operasional:

- [Referensi Command](docs/commands.md)
- [Sistem Tagihan dan Tunggakan](SISTEM%20TAGIHAN%20DAN%20TUNGGAKAN.md)
- [ADR-002 — Kebijakan Legacy dan Transisi](docs/architecture/002-kebijakan-tagihan-pembayaran.md)

## Batasan yang belum tersedia lewat WhatsApp

- laporan, ekspor, audit log, dan reversal masing-masing membutuhkan implementasi tersendiri;
- import Excel hanya mengelola identitas santri; nominal diatur melalui command tagihan dinamis.

Lihat [ERD](ERD%20MIFABOT%20v1.md) dan [skema database](SKEMA%20DATABASE%20MIFABOT%20v1.md) untuk struktur data dan jembatan kompatibilitasnya.
