import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { extractApiError } from "../../lib/apiError";
import { AdminShell } from "./AdminShell";
import { cpuToMillicores, formatCpu, formatMemory, memoryToMib } from "./format";
import type { SystemResources } from "../../types/admin";

// Ten DEPLOYMENT trong K8s (khong phai ten hien thi) - endpoint scale patch
// thang vao deployments/scale o namespace "default".
const SCALABLE = [
  { deployment: "identity-service", label: "Identity" },
  { deployment: "workspace-service", label: "WorkSpace" },
  { deployment: "chat-service", label: "Chat" },
  { deployment: "media-service", label: "Media" },
  { deployment: "admin-service", label: "Admin" },
  { deployment: "spamtracking-service", label: "SpamTracking" },
];

export function AdminSystemPage() {
  const [res, setRes] = useState<SystemResources | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState(SCALABLE[0].deployment);
  const [replicas, setReplicas] = useState(2);
  const [scaleMsg, setScaleMsg] = useState<string | null>(null);
  const [scaleErr, setScaleErr] = useState<string | null>(null);
  const [scaling, setScaling] = useState(false);

  const load = useCallback(() => {
    setError(null);
    adminApi
      .getResources()
      .then((r) => setRes(r.data))
      .catch((err) =>
        setError(extractApiError(err, "Không đọc được tài nguyên (Metrics Server chưa sẵn sàng?)")),
      );
  }, []);

  useEffect(load, [load]);

  // Tu lam moi 15s. Don dep khi roi trang de khong de timer chay tiep.
  useEffect(() => {
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  async function handleScale(e: React.FormEvent) {
    e.preventDefault();
    setScaling(true);
    setScaleMsg(null);
    setScaleErr(null);
    try {
      await adminApi.scaleService(target, replicas);
      // 202 Accepted: K8s da nhan lenh, pod moi con phai keo image va khoi
      // dong. Khong noi "da scale xong".
      setScaleMsg(`Đã gửi lệnh đặt ${target} về ${replicas} bản. Pod mới cần vài giây để sẵn sàng.`);
    } catch (err) {
      setScaleErr(extractApiError(err, "Scale thất bại"));
    } finally {
      setScaling(false);
    }
  }

  // Metrics Server chi tra LUONG DANG DUNG, khong tra gioi han, nen khong
  // tinh duoc phan tram that. Ve thanh do theo ty le voi pod ngon nhat -
  // trung thuc hon la bia ra mot muc tran.
  const maxCpu = Math.max(1, ...(res?.pods.map((p) => cpuToMillicores(p.cpuUsage)) ?? []));
  const maxMem = Math.max(1, ...(res?.pods.map((p) => memoryToMib(p.memoryUsage)) ?? []));

  const sortedPods = res ? [...res.pods].sort((a, b) => cpuToMillicores(b.cpuUsage) - cpuToMillicores(a.cpuUsage)) : [];

  return (
    <AdminShell title="Tài nguyên hệ thống">
      <div className="adm-toolbar">
        <button className="adm-btn adm-btn-ghost" onClick={load}>
          Làm mới
        </button>
        <span className="adm-muted">Tự làm mới mỗi 15 giây</span>
      </div>

      {error && <p className="adm-error">{error}</p>}
      {res === null && !error && <p className="adm-muted">Đang tải...</p>}

      {res && (
        <>
          <h2 className="adm-subtitle">Node ({res.nodes.length})</h2>
          <div className="adm-cards">
            {res.nodes.map((n) => (
              <div key={n.name} className="adm-card">
                <div className="adm-card-name">{n.name}</div>
                <div className="adm-card-metrics">
                  <span>CPU {formatCpu(n.cpuUsage)}</span>
                  <span>RAM {formatMemory(n.memoryUsage)}</span>
                </div>
              </div>
            ))}
          </div>

          <h2 className="adm-subtitle">Pod ({res.pods.length}) - xếp theo CPU</h2>
          <p className="adm-hint">
            Metrics Server chỉ trả lượng đang dùng, không trả giới hạn - thanh đo là tương quan giữa các
            pod, không phải phần trăm hạn mức.
          </p>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Pod</th>
                  <th>CPU</th>
                  <th>RAM</th>
                </tr>
              </thead>
              <tbody>
                {sortedPods.map((p) => (
                  <tr key={p.name}>
                    <td className="adm-mono">{p.name}</td>
                    <td>
                      <div className="adm-meter">
                        <div
                          className="adm-meter-fill"
                          style={{ width: `${(cpuToMillicores(p.cpuUsage) / maxCpu) * 100}%` }}
                        />
                      </div>
                      <span className="adm-meter-label">{formatCpu(p.cpuUsage)}</span>
                    </td>
                    <td>
                      <div className="adm-meter">
                        <div
                          className="adm-meter-fill mem"
                          style={{ width: `${(memoryToMib(p.memoryUsage) / maxMem) * 100}%` }}
                        />
                      </div>
                      <span className="adm-meter-label">{formatMemory(p.memoryUsage)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="adm-subtitle">Mở rộng service</h2>
      <p className="adm-hint">
        Chỉ có tác dụng khi service chạy trong K8s. Ở môi trường dev hiện tại các service chạy bằng
        Docker Compose nên lệnh này sẽ báo lỗi không tìm thấy deployment - đó là kết quả đúng.
      </p>
      <form onSubmit={handleScale} className="adm-scale-form">
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="adm-input">
          {SCALABLE.map((s) => (
            <option key={s.deployment} value={s.deployment}>
              {s.label} ({s.deployment})
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={10}
          value={replicas}
          onChange={(e) => setReplicas(Number(e.target.value))}
          className="adm-input adm-input-narrow"
        />
        <button type="submit" className="adm-btn adm-btn-primary" disabled={scaling}>
          {scaling ? "Đang gửi..." : "Đặt số bản"}
        </button>
      </form>
      {scaleMsg && <p className="adm-notice">{scaleMsg}</p>}
      {scaleErr && <p className="adm-error">{scaleErr}</p>}
    </AdminShell>
  );
}
