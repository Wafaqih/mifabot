# Referensi Command WhatsApp MIFABOT

**Status:** Sesuai handler WhatsApp saat ini  
**Terakhir diverifikasi:** 2 September 2026

Command tidak peka kapitalisasi. Awalan `!`, `/`, `\\`, `MIFABOT`, atau `Bot`
boleh digunakan, misalnya `!Cek tagihan` atau `MIFABOT: Bayar SPP 30000`.
Command bisnis memerlukan chat pribadi, kecuali `Ping` dan `Idgrup`.

## Informasi dan pembayaran

| Command | Akses | Perilaku |
| --- | --- | --- |
| `Ping` | Siapa pun | Memeriksa bot aktif. |
| `Idgrup` | Siapa pun, grup | Menampilkan ID grup WhatsApp. |
| `Help` | Siapa pun, pribadi | Menampilkan bantuan sesuai role. |
| `Daftar` | Nomor yang belum memiliki akun, pribadi | Memulai pendaftaran mandiri bertahap. |
| `Edit profile` | Pengguna aktif, pribadi | Memulai perubahan satu data profil milik sendiri. |
| `Cek profil` | User aktif, pribadi | Menampilkan profil dan nominal efektif semua tagihan aktif. |
| `Cek tagihan` | User aktif, pribadi | Menampilkan bill berjalan dan tunggakan dari semua definisi. |
| `Bayar <nama tagihan> <nominal>` | User aktif, pribadi | Memulai pengajuan pembayaran bill berjalan dan memilih channel PJ. |
| `Bayar tunggakan <nama tagihan>` | User aktif, pribadi | Memilih satu atau beberapa periode tunggakan untuk dibayar penuh, lalu memilih channel PJ. |
| `Catat bayar <nama tagihan> <santri> <nominal>` | PJ aktif, pribadi | Mencatat dan langsung menyetujui pembayaran bill berjalan milik santri. |
| `Catat tunggakan <nama tagihan> <santri>` | PJ aktif, pribadi | Memilih tunggakan santri yang akan dicatat dan langsung disetujui. |
| `Laporan pembayaran <nama tagihan> [YYYY-MM]` | PJ aktif atau Super Admin, pribadi | Menampilkan ringkasan transaksi menurut status. |
| `Laporan tunggakan <nama tagihan>` | PJ aktif atau Super Admin, pribadi | Menampilkan jumlah bill dan total tunggakan saat ini. |
| `Export pembayaran <nama tagihan> [YYYY-MM]` | PJ aktif atau Super Admin, pribadi | Mengirim Excel transaksi pembayaran. |
| `Export tunggakan <nama tagihan>` | PJ aktif atau Super Admin, pribadi | Mengirim Excel tunggakan saat ini. |
| `Audit pembayaran <nama tagihan>` | PJ aktif atau Super Admin, pribadi | Menampilkan maksimal 50 jejak aktivitas pembayaran terakhir. |
| `Riwayat pembayaran <nama tagihan>` | PJ aktif, pribadi | Menampilkan pembayaran `APPROVED` untuk dipilih pada proses reversal. |
| `Reversal <nomor> <alasan>` | PJ aktif, pribadi | Meminta konfirmasi untuk membatalkan pembayaran pada riwayat yang masih berlaku. |
| `List santri` / `Daftar santri` / `Lihat santri` | Admin atau Super Admin, pribadi | Menampilkan santri aktif ber-role `USER`. |

Contoh pembayaran:

```text
Bayar SPP 100000
Bayar "Iuran Makan" 25000
```

Nama tagihan harus tepat dan bill berjalan harus masih memiliki sisa. Channel
cash dapat langsung diajukan; channel non-cash meminta foto bukti JPG, PNG,
atau WebP maksimal 5 MB.

### Membayar tunggakan

Gunakan command berikut untuk membayar tunggakan dari satu nama tagihan:

```text
Bayar tunggakan <nama tagihan>
```

Contoh:

```text
Bayar tunggakan SPP
Bayar tunggakan "Iuran Makan"
```

Bot menampilkan periode yang masih memiliki sisa. Balas satu atau beberapa
nomor, dipisahkan koma—misalnya `1, 3`—lalu pilih channel. Setiap periode yang
dipilih dibayar penuh; cicilan tunggakan belum tersedia dalam alur ini.

### Mencatat pembayaran oleh PJ

PJ aktif untuk suatu tagihan dapat mencatat pembayaran yang diterima dari
santri. Pembayaran ini tidak memakai channel atau unggah bukti dan langsung
berstatus `APPROVED`; alokasi bill dibuat dalam transaksi yang sama.

Untuk bill berjalan:

```text
Catat bayar <nama tagihan> <username/nomor WhatsApp santri> <nominal>
```

Contoh:

```text
Catat bayar SPP ahmad 100000
Catat bayar "Iuran Makan" 628123456789 25000
```

Nominal dapat berupa cicilan, tetapi tidak boleh melebihi sisa bill berjalan.

Untuk tunggakan:

```text
Catat tunggakan <nama tagihan> <username/nomor WhatsApp santri>
```

Bot menampilkan tunggakan santri tersebut. Balas nomor periode—atau beberapa
nomor dengan koma—untuk mencatat pembayaran penuh. Bot memberi tahu santri
setelah pembayaran berhasil dicatat.

## Keputusan pengajuan pembayaran

PJ aktif yang menjadi penerima channel pembayaran dapat melihat pengajuan yang
dirutekan kepadanya dan mengambil keputusan melalui chat pribadi.

```text
List pengajuan
Setujui <nomor>
Tolak <nomor> <alasan>
```

Contoh:

```text
Setujui 1
Tolak 2 bukti transfer tidak sesuai
```

Nomor pengajuan diperoleh dari `List pengajuan` dan berlaku selama 10 menit;
setelah satu keputusan, jalankan `List pengajuan` lagi sebelum memutuskan
pengajuan berikutnya. Hanya PJ penerima channel dapat melihat daftar tersebut. Saat disetujui,
alokasi pembayaran dibuat untuk bill berjalan atau seluruh tunggakan yang
dipilih. Keputusan—termasuk alasan penolakan—dikirimkan kembali kepada santri.

## Laporan, export, dan audit pembayaran

PJ aktif untuk tagihan—atau Super Admin—dapat melihat ringkasan dan mengirim
file Excel melalui chat pribadi.

```text
Laporan pembayaran <nama tagihan> [YYYY-MM]
Laporan tunggakan <nama tagihan>
Export pembayaran <nama tagihan> [YYYY-MM]
Export tunggakan <nama tagihan>
Audit pembayaran <nama tagihan>
```

Contoh:

```text
Laporan pembayaran SPP 2026-09
Export tunggakan "Iuran Makan"
Audit pembayaran SPP
```

Laporan pembayaran menunjukkan transaksi berstatus `PENDING`, `APPROVED`,
`REJECTED`, dan `CANCELLED`. Audit menyimpan pengajuan, pencatatan oleh PJ,
keputusan admin, dan reversal di database dalam transaksi yang sama dengan
perubahan datanya.

## Reversal pembayaran yang aman

Reversal tidak menghapus pembayaran. PJ aktif memulai dari riwayat pembayaran
yang sudah disetujui, memasukkan alasan, lalu harus membalas `Ya` untuk
konfirmasi akhir.

```text
Riwayat pembayaran <nama tagihan>
Reversal <nomor> <alasan>
```

Contoh:

```text
Riwayat pembayaran SPP
Reversal 2 pembayaran tercatat dua kali
Ya
```

Nomor hanya berlaku selama 10 menit. Saat reversal dikonfirmasi, sistem secara
atomik menyimpan snapshot alokasi, menghapus alokasi aktif, menghitung ulang
status bill, mengubah status pembayaran menjadi `CANCELLED`, dan menulis audit
log. Pembayaran hanya dapat direversal satu kali; jika status atau alokasinya
sudah berubah, seluruh transaksi dibatalkan tanpa perubahan parsial.

## Metode pembayaran per tagihan

Hanya Super Admin dapat mengatur metode pembayaran, dan setiap metode terikat
ke satu tagihan serta satu PJ aktif tagihan itu. Ini mencegah metode suatu
tagihan muncul pada tagihan lain.

```text
Tambah metode <nama tagihan> <username/nomor_whatsapp PJ>
Lihat metode <nama tagihan>
Ubah metode <nama tagihan> <nomor>
Nonaktifkan metode <nama tagihan> <nomor>
```

Contoh:

```text
Tambah metode SPP faqih
Lihat metode SPP
Ubah metode SPP 1
Nonaktifkan metode SPP 3
```

`Tambah metode` memulai percakapan: pilih **Rekening Bank**, **E-Wallet**, atau
**Cash**; lalu isi nama tampilan dan data yang relevan. Rekening Bank serta
E-Wallet memerlukan nomor dan nama pemilik. Cash memerlukan instruksi atau
lokasi pembayaran. Balas `Ya` untuk menyimpan.

Urutan tampilan ditetapkan permanen: **1. Rekening Bank, 2. E-Wallet, 3. Cash**
(nama diurutkan alfabetis di dalam kategori yang sama). Nomor pada command
`Ubah metode` dan `Nonaktifkan metode` mengacu pada daftar dari `Lihat metode`.
Nonaktifkan tidak menghapus histori pembayaran dan hanya menyembunyikan metode
dari pembayaran baru.

## Pendaftaran dan profil mandiri

### Mendaftar sebagai pengguna baru

Kirim command berikut melalui chat pribadi dengan bot:

```text
Daftar
```

Bot meminta data satu per satu dengan urutan berikut:

| Tahap | Data yang dikirim | Ketentuan |
| --- | --- | --- |
| 1 | Nama lengkap | Wajib diisi. |
| 2 | Username | Disarankan memakai nama panggilan satu kata; panjang 3–60 karakter dan hanya boleh berisi huruf, angka, titik (`.`), strip (`-`), atau underscore (`_`). |
| 3 | Nomor WhatsApp | Boleh ditulis sebagai `08...`, `8...`, atau `62...`, tetapi harus merupakan nomor WhatsApp yang sedang mengirim chat ke bot. |
| 4 | Jenis kelamin | Kirim `L` atau `P`. |

Pendaftaran hanya tersedia untuk nomor pengirim yang belum memiliki record
pengguna, termasuk record tidak aktif. Username juga tidak boleh dipakai akun
lain (tanpa membedakan huruf besar/kecil). Setelah tahap terakhir valid, bot
membuat akun ber-role `USER` dengan status aktif.

Ketik `Batal` pada tahap mana pun untuk membatalkan pendaftaran. Sesi yang
tidak diteruskan selama 10 menit akan kedaluwarsa dan tidak menyimpan data
sementara ataupun membuat akun.

Pendaftaran tidak memuat nominal ataupun jenis tagihan. Nominal tagihan tetap
diatur terpisah oleh Super Admin melalui `Buat tagihan` dan `Set nominal`.

### Mengubah profil sendiri

Pengguna aktif mengirim command berikut melalui chat pribadi:

```text
Edit profile
```

Bot menampilkan pilihan berikut. Balas dengan nomor pilihannya, lalu kirim satu
nilai baru ketika diminta.

```text
1. Nama lengkap
2. Username
3. Nomor WhatsApp
4. Jenis kelamin
```

Satu sesi `Edit profile` hanya mengubah satu field dan langsung selesai setelah
perubahan berhasil. Aturan username, nomor WhatsApp, dan jenis kelamin sama
dengan pendaftaran. Nomor WhatsApp baru tidak perlu sama dengan nomor yang
sedang mengirim chat, tetapi harus valid dan belum digunakan akun lain;
perubahan ini diotorisasi oleh nomor lama yang sedang menjalankan sesi edit.
Username juga tidak boleh sudah digunakan akun lain. Perintah ini tidak dapat
mengubah role atau status akun.

Ketik `Batal` untuk keluar tanpa perubahan. Sesi edit juga berakhir otomatis
setelah 10 menit tanpa respons.

## Pengelolaan tagihan

Command berikut hanya untuk nomor `SUPER_ADMIN_WHATSAPP` yang dikonfigurasi,
dan harus dipakai di chat pribadi.

### Membuat dan mengaktifkan tagihan

```text
Buat tagihan <nama> <nominal> <mingguan|bulanan|tahunan|custom>
Add PJ <nama tagihan> <username/nomor_whatsapp>
```

Contoh:

```text
Buat tagihan SPP 100000 bulanan
Buat tagihan "Iuran Makan" 25000 mingguan
Add PJ SPP faqih
```

Definisi baru memiliki nominal global awal tetapi belum aktif. PJ pertama
mengaktifkannya. Jika target PJ masih ber-role `USER`, ia dipromosikan menjadi
`ADMIN`; `SUPER_ADMIN` tidak pernah diturunkan role-nya.

### Mengelola PJ

```text
Add PJ <nama tagihan> <username/nomor_whatsapp>
Del PJ <nama tagihan> <username/nomor_whatsapp>
```

Satu tagihan dapat memiliki banyak PJ. `Del PJ` tidak menghapus histori dan
tidak mendemosi role target. PJ aktif terakhir pada tagihan aktif tidak dapat
dihapus.

### Mengubah nominal

Untuk semua santri aktif:

```text
Set nominal SPP 100000
Semua
```

Untuk nominal khusus sebagian santri, tulis satu username atau nomor WhatsApp
per baris:

```text
Set nominal SPP 75000
ahmad
siti
628123456789
```

`Semua` harus menjadi satu-satunya target. Perubahan disimpan atomik dan
berlaku mulai periode berikutnya; bill yang telah diterbitkan tidak berubah.

### Menerbitkan tagihan custom

```text
Terbitkan tagihan <nama custom> <YYYY-MM-DD> <YYYY-MM-DD> <YYYY-MM-DD>
```

Urutan tiga tanggal adalah `periode_mulai`, `periode_selesai`, lalu
`jatuh_tempo`.

```text
Terbitkan tagihan "Daftar Ulang" 2026-09-01 2026-09-07 2026-09-05
```

Hanya definisi berinterval `custom` yang dapat diterbitkan dengan command ini.

## Reminder tagihan

Reminder dikonfigurasi per definisi tagihan dan dihitung dari `jatuh_tempo`
setiap bill. Karena itu, aturan yang sama dapat dipakai oleh tagihan mingguan,
bulanan, tahunan, maupun `custom` setelah bill memiliki jatuh tempo.

### Mengatur reminder otomatis

Hanya Super Admin yang dapat mengatur reminder otomatis melalui chat pribadi.

```text
Set reminder <nama tagihan> H-7 H-3 H-0
Set reminder <nama tagihan> off
```

Contoh:

```text
Set reminder SPP H-7 H-3 H-0
Set reminder "Iuran Makan" H-2 H-0 H+3
Set reminder SPP off
```

`H-7` berarti tujuh hari sebelum jatuh tempo, `H-0` tepat pada jatuh tempo,
dan `H+3` tiga hari setelahnya. Command pengaturan mengganti seluruh aturan
aktif untuk tagihan tersebut; `off` menonaktifkan seluruh reminder otomatisnya.
Tidak ada aturan default untuk definisi baru. Definisi bridge legacy `Bulanan`
mendapat aturan awal `H-4`, `H-2`, dan `H-0` untuk mempertahankan jadwal lama
pada tanggal 1, 3, dan 5.

Scheduler mengevaluasi aturan setiap hari pada zona waktu `APP_TIMEZONE`.
Reminder otomatis hanya dikirim bila bill masih memiliki sisa; satu kombinasi
bill dan aturan otomatis hanya dikirim sekali. Kegagalan pengiriman dicatat dan
coba-kirim memakai delivery yang sama, bukan membuat reminder duplikat.

### Mengirim reminder manual

```text
Reminder <nama tagihan>
```

Contoh:

```text
Reminder SPP
Reminder "Daftar Ulang"
```

Command ini hanya untuk PJ aktif tagihan tersebut atau Super Admin, melalui
chat pribadi. Bot segera mengirim reminder kepada setiap santri yang memiliki
bill tagihan itu dengan sisa positif, termasuk bill yang sudah menjadi
tunggakan. Pengiriman manual dapat diulangi dengan sengaja; setiap command
membuat batch audit baru, sementara satu bill hanya dapat dipilih sekali dalam
batch yang sama.

## Import santri

Super Admin mengirim `Data santri`, lalu mengirim Excel `.xlsx` maksimal 5 MB
dalam 10 menit.
Sheet pertama wajib memiliki header:

```text
Nama Lengkap
Username
Nomor Whatsapp
Jenis Kelamin
```

Import hanya membuat/memperbarui identitas santri. Nominal tagihan diatur
terpisah dengan `Buat tagihan` dan `Set nominal`.

`Data santri` tetap merupakan jalur import massal Super Admin; `Daftar` adalah
jalur mandiri untuk satu nomor WhatsApp dan tidak menggantikan format Excel.

## Belum tersedia melalui WhatsApp

- laporan, ekspor, reversal, dan audit log UI.

Lihat [ADR tagihan dinamis](architecture/003-tagihan-dinamis.md) untuk aturan
periode, nominal, PJ, dan routing pembayaran.
