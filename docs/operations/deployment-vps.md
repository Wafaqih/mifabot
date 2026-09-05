# Deployment MIFABOT ke VPS

Dokumen ini adalah referensi operasional untuk memperbarui MIFABOT di VPS produksi. Deployment dijalankan oleh workflow [deploy-vps.yml](../../.github/workflows/deploy-vps.yml) setiap ada push ke branch `main`, atau melalui **Run workflow** di GitHub Actions.

## Ringkasan lingkungan produksi

| Komponen | Nilai / ketentuan |
| --- | --- |
| Repository di VPS | `/home/ubuntu/mifabot` |
| Process manager | PM2, proses bernama `mifabot` |
| Runtime | Node.js 20 atau lebih baru |
| Build | `npm ci --include=dev` lalu `npm run build` |
| Restart | `pm2 restart mifabot --update-env` |
| Branch produksi | `main` |

Workflow membatalkan deployment bila terdapat perubahan lokal yang belum dicatat di repository VPS. Jangan mengubah source code langsung di `/home/ubuntu/mifabot`; buat dan push perubahan melalui repository Git.

## Secret GitHub yang diperlukan

Buat semua secret di **Settings → Environments → production**, bukan repository-level secret.

| Nama | Isi |
| --- | --- |
| `VPS_HOST` | Host atau alamat IP VPS. |
| `VPS_PORT` | Port SSH VPS. |
| `VPS_USER` | User Linux pemilik aplikasi, saat ini `ubuntu`. |
| `VPS_SSH_PRIVATE_KEY` | Private key SSH lengkap untuk user tersebut, termasuk baris `BEGIN`/`END`. |
| `VPS_SSH_KNOWN_HOSTS` | Output host key VPS yang tepercaya dari `ssh-keyscan`; untuk port selain 22 gunakan format host dengan port. |

Private key secret harus berpasangan dengan public key yang ada di `/home/ubuntu/.ssh/authorized_keys` untuk `VPS_USER`. Jika log menampilkan `Permission denied (publickey,password)`, periksa pasangan kunci ini terlebih dahulu.

Jangan menyalin nilai secret, private key, atau isi `.env` ke issue, commit, log, atau dokumentasi.

## Menyiapkan atau mengganti kunci deployment

Di komputer administrator, buat kunci khusus deployment bila belum ada:

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE/.ssh/mifabot_github_actions" -C "github-actions-mifabot-deploy"
```

Tambahkan **public key** ke VPS dengan akses administrator:

```bash
install -d -m 700 /home/ubuntu/.ssh
cat >> /home/ubuntu/.ssh/authorized_keys
# Tempel satu baris isi mifabot_github_actions.pub, kemudian tekan Ctrl+D.
chmod 600 /home/ubuntu/.ssh/authorized_keys
```

Simpan isi file private key `mifabot_github_actions` sebagai `VPS_SSH_PRIVATE_KEY`. Setelah itu uji dari komputer administrator:

```powershell
ssh -i "$env:USERPROFILE/.ssh/mifabot_github_actions" -p <port> ubuntu@<host> "pm2 status mifabot"
```

Gunakan kunci deployment khusus, bukan kunci pribadi administrator, agar akses deployment dapat dicabut tanpa mengganggu akses administrasi.

## Proses deployment normal

1. Jalankan pemeriksaan relevan di lokal, minimal `npm run build` dan tes yang berkaitan dengan perubahan.
2. Commit perubahan lalu push ke `main`.
3. Buka tab **Actions** di GitHub dan pantau workflow **Deploy MIFABOT to VPS**.
4. Pastikan langkah **Pull, build, and restart MIFABOT** berhasil.
5. Verifikasi `mifabot` berstatus `online` pada output `pm2 status mifabot` di log workflow.
6. Uji satu perintah WhatsApp yang terkait dengan perubahan.

Untuk menjalankan ulang deployment tanpa commit baru, pilih workflow tersebut di GitHub Actions, pilih **Run workflow**, lalu pilih branch `main`.

## Node.js dan NVM pada sesi SSH

Workflow berjalan melalui SSH non-interaktif. Sesi ini tidak selalu memuat konfigurasi shell yang membuat `node` dan `npm` tersedia. Workflow secara eksplisit memuat `$HOME/.nvm/nvm.sh` bila file itu ada.

Jika workflow gagal dengan `npm: command not found`:

1. Masuk ke VPS sebagai `VPS_USER` dan pastikan Node.js tersedia: `node --version` dan `npm --version`.
2. Bila Node diinstal memakai NVM, pastikan file `$HOME/.nvm/nvm.sh` ada dan dapat dibaca user deployment.
3. Jika Node diinstal di lokasi lain, sesuaikan bagian pemuatan runtime di workflow sebelum menjalankan deploy ulang.

## Diagnostik kegagalan umum

| Gejala di GitHub Actions | Penyebab yang mungkin | Tindakan |
| --- | --- | --- |
| `error in libcrypto` ketika memuat key | Secret private key tidak utuh atau formatnya rusak. | Simpan ulang private key lengkap sebagai `VPS_SSH_PRIVATE_KEY`. |
| `Permission denied (publickey,password)` | Public key pasangan tidak ada di `authorized_keys`, atau user/port salah. | Verifikasi `VPS_USER`, `VPS_PORT`, dan public key di VPS. |
| `Host key verification failed` | `VPS_SSH_KNOWN_HOSTS` tidak cocok dengan host key VPS. | Ambil ulang host key melalui kanal tepercaya dan perbarui secret. |
| `npm: command not found` | Node/NVM tidak termuat pada sesi non-interaktif. | Periksa bagian Node.js dan NVM di atas. |
| `Deployment dibatalkan: ada perubahan lokal...` | Ada source, file baru, atau file terubah langsung di VPS. | Audit dengan `git status --short`; commit perubahan yang sah atau pulihkan file secara hati-hati sebelum deploy ulang. |
| PM2 tidak `online` setelah restart | Aplikasi gagal saat startup. | Periksa `pm2 logs mifabot --lines 100`, perbaiki konfigurasi atau kode, lalu deploy ulang. |

## Pemeriksaan darurat di VPS

Gunakan hanya saat akses SSH administratif tersedia:

```bash
cd /home/ubuntu/mifabot
git status --short
git rev-parse --short HEAD
node --version
npm --version
pm2 status mifabot
pm2 logs mifabot --lines 100
```

Jangan menjalankan `git reset --hard`, menghapus directory aplikasi, atau mengubah `.env` sebagai respons pertama terhadap kegagalan deployment. Kumpulkan status dan log lebih dahulu agar data sesi WhatsApp serta konfigurasi produksi tetap aman.
