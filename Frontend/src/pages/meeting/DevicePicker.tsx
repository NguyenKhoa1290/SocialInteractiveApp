import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent } from "livekit-client";

type Kind = "videoinput" | "audioinput" | "audiooutput";

const LABEL: Record<Kind, string> = {
  videoinput: "Camera",
  audioinput: "Micro",
  audiooutput: "Loa",
};

const STORAGE_KEY = "chat-app-devices";

// Chon loa dua vao HTMLMediaElement.setSinkId - Chromium co, Firefox va
// Safari khong. Kiem tra that thay vi doan theo user agent, va AN HAN muc do
// di neu khong ho tro: de mot o chon bam vao khong co tac dung con te hon la
// khong co.
const supportsSpeakerPick =
  typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

const KINDS: Kind[] = supportsSpeakerPick
  ? ["videoinput", "audioinput", "audiooutput"]
  : ["videoinput", "audioinput"];

function loadSaved(): Partial<Record<Kind, string>> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function save(kind: Kind, deviceId: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadSaved(), [kind]: deviceId }));
  } catch {
    // localStorage day hoac bi chan - khong dang de hong tinh nang chinh
  }
}

// Doi camera/micro/loa NGAY TRONG cuoc hop, khong co man hinh kiem tra
// truoc khi vao. Doi lai duoc mot thu quan trong: da o trong phong nghia la
// quyen camera/mic DA duoc cap, nen enumerateDevices tra ve ten thiet bi
// that ("HD Webcam C920") thay vi chuoi rong nhu khi chua co quyen.
export function DevicePicker({ room }: { room: Room }) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<Partial<Record<Kind, MediaDeviceInfo[]>>>({});
  const [active, setActive] = useState<Partial<Record<Kind, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    const nextDevices: Partial<Record<Kind, MediaDeviceInfo[]>> = {};
    for (const k of KINDS) {
      try {
        nextDevices[k] = await Room.getLocalDevices(k, false);
      } catch {
        nextDevices[k] = [];
      }
    }
    setDevices(nextDevices);

    const nextActive: Partial<Record<Kind, string>> = {};
    for (const k of KINDS) nextActive[k] = room.getActiveDevice(k);
    setActive(nextActive);
  }, [room]);

  // MediaDevicesChanged la ban boc san cua LiveKit quanh
  // navigator.mediaDevices.ondevicechange -> cam tai nghe/webcam vao giua
  // buoi hop la danh sach tu cap nhat, khong phai F5.
  // ActiveDeviceChanged bat ca truong hop KHONG do minh bam: rut thiet bi
  // dang dung thi trinh duyet tu nhay ve mac dinh, o chon phai doi theo chu
  // khong duoc hien ten thiet bi da rut.
  useEffect(() => {
    refresh();
    room.on(RoomEvent.MediaDevicesChanged, refresh);
    room.on(RoomEvent.ActiveDeviceChanged, refresh);
    return () => {
      room.off(RoomEvent.MediaDevicesChanged, refresh);
      room.off(RoomEvent.ActiveDeviceChanged, refresh);
    };
  }, [room, refresh]);

  // Khoi phuc lua chon lan truoc. Chi ap khi thiet bi do CON CAM - nguoi
  // dung mang laptop di lam ma van co gan lai webcam o nha thi vo nghia.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    (async () => {
      const saved = loadSaved();
      for (const k of KINDS) {
        const id = saved[k];
        if (!id) continue;
        try {
          const list = await Room.getLocalDevices(k, false);
          if (list.some((d) => d.deviceId === id)) await room.switchActiveDevice(k, id);
        } catch {
          // thiet bi bi ung dung khac giu hoac da rut - bo qua, dung mac dinh
        }
      }
      refresh();
    })();
  }, [room, refresh]);

  // Bam ra ngoai thi dong bang chon.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function pick(kind: Kind, deviceId: string) {
    setError(null);
    try {
      await room.switchActiveDevice(kind, deviceId);
      setActive((a) => ({ ...a, [kind]: deviceId }));
      save(kind, deviceId);
    } catch (err) {
      // Doi thiet bi CO THE that bai that: camera dang bi ung dung khac giu
      // (NotReadableError) hoac quyen bi thu hoi (NotAllowedError). Khong bat
      // thi loi thanh unhandled rejection - nguoi dung chon xong khong thay
      // gi xay ra va khong hieu vi sao.
      const name = (err as Error)?.name;
      setError(
        name === "NotReadableError"
          ? `Không dùng được ${LABEL[kind].toLowerCase()} này — có thể ứng dụng khác đang giữ nó.`
          : name === "NotAllowedError"
            ? "Trình duyệt đã chặn quyền truy cập thiết bị."
            : `Không đổi được ${LABEL[kind].toLowerCase()}.`,
      );
      refresh(); // ve dung thiet bi dang thuc su chay
    }
  }

  return (
    <div className="meet-devices" ref={popRef}>
      <button onClick={() => setOpen((v) => !v)} title="Chọn camera, micro, loa">
        ⚙ Thiết bị
      </button>

      {open && (
        <div className="meet-devices-pop">
          {KINDS.map((kind) => {
            const list = devices[kind] ?? [];
            return (
              <label key={kind} className="meet-device-row">
                <span>{LABEL[kind]}</span>
                {list.length === 0 ? (
                  <em className="meet-note">Không tìm thấy thiết bị nào</em>
                ) : (
                  <select
                    value={active[kind] ?? list[0]?.deviceId ?? ""}
                    onChange={(e) => pick(kind, e.target.value)}
                  >
                    {list.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `${LABEL[kind]} ${i + 1}`}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            );
          })}

          {!supportsSpeakerPick && (
            <p className="meet-note">Trình duyệt này không cho chọn loa — đổi ở cài đặt hệ điều hành.</p>
          )}
          {error && <p className="meet-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
