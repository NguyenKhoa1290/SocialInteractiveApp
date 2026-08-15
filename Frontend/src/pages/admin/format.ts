// Dinh dang dung chung cho cac man hinh Admin.

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Con bao lau nua thi het han (khieu nai song 10 tieng trong Redis).
export function formatRemaining(expiresAtIso: string): string {
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "—";
  if (ms <= 0) return "đã hết hạn";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `còn ${hours} giờ ${minutes} phút` : `còn ${minutes} phút`;
}

// Metrics Server tra CPU theo don vi nanocore ("6455n", "12861503n") va bo
// nho theo "Ki"/"Mi"/"Gi". Doi sang millicore va MiB de doc duoc.
export function formatCpu(raw: string): string {
  const m = /^(\d+(?:\.\d+)?)(n|u|m)?$/.exec(raw.trim());
  if (!m) return raw;
  const value = Number(m[1]);
  const millicores =
    m[2] === "n" ? value / 1_000_000 : m[2] === "u" ? value / 1_000 : m[2] === "m" ? value : value * 1000;
  return millicores >= 10 ? `${Math.round(millicores)}m` : `${millicores.toFixed(1)}m`;
}

export function formatMemory(raw: string): string {
  const m = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti)?$/.exec(raw.trim());
  if (!m) return raw;
  const value = Number(m[1]);
  const mib =
    m[2] === "Ki" ? value / 1024 : m[2] === "Mi" ? value : m[2] === "Gi" ? value * 1024 : m[2] === "Ti" ? value * 1024 * 1024 : value / (1024 * 1024);
  return mib >= 1024 ? `${(mib / 1024).toFixed(2)} GiB` : `${Math.round(mib)} MiB`;
}

// Dung de ve thanh do tuong doi giua cac pod - Metrics Server chi tra
// LUONG DANG DUNG, khong tra gioi han, nen khong tinh duoc phan tram that.
// So sanh voi pod ngon nhat trong danh sach la cach trung thuc nhat.
export function cpuToMillicores(raw: string): number {
  const m = /^(\d+(?:\.\d+)?)(n|u|m)?$/.exec(raw.trim());
  if (!m) return 0;
  const value = Number(m[1]);
  return m[2] === "n" ? value / 1_000_000 : m[2] === "u" ? value / 1_000 : m[2] === "m" ? value : value * 1000;
}

export function memoryToMib(raw: string): number {
  const m = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti)?$/.exec(raw.trim());
  if (!m) return 0;
  const value = Number(m[1]);
  return m[2] === "Ki" ? value / 1024 : m[2] === "Mi" ? value : m[2] === "Gi" ? value * 1024 : m[2] === "Ti" ? value * 1024 * 1024 : value / (1024 * 1024);
}
