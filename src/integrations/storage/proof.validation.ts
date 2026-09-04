const allowedImageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const maxProofSizeBytes = 5 * 1024 * 1024;

export function validateProofImage(data: Buffer, contentType: string): string {
  const extension = allowedImageTypes.get(contentType.toLowerCase());
  if (!extension) {
    throw new Error("Bukti pembayaran harus berupa foto JPG, PNG, atau WebP.");
  }
  if (data.length === 0 || data.length > maxProofSizeBytes) {
    throw new Error(
      "Ukuran foto bukti pembayaran harus lebih dari 0 dan maksimal 5 MB.",
    );
  }
  return extension;
}
