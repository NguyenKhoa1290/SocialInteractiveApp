import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent } from "livekit-client";
import { MeetingPopup, HangTac } from "./MeetingPopup";
import { datAmLuongMic } from "./micGain";

type Kind = "audioinput" | "videoinput" | "audiooutput";

const NHAN: Record<Kind, string> = {
  audioinput: "Nguồn micro",
  videoinput: "Nguồn Camera",
  audiooutput: "Nguồn loa",
};

const KHOA_THIET_BI = "chat-app-devices";
const KHOA_AM_LUONG = "chat-app-mic-gain";

// Chon loa dua vao HTMLMediaElement.setSinkId - Chromium co, Firefox va
// Safari khong. Kiem tra that thay vi doan theo user agent.
const chonDuocLoa =
  typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

// Ban thiet ke chi ve micro va camera. Giu them o chon LOA vi bo han di la
// mat mot thu dang dung duoc tren may co nhieu duong ra (tai nghe + loa man
// hinh), ma no lai dung y het hai o kia.
const KINDS: Kind[] = chonDuocLoa ? ["audioinput", "videoinput", "audiooutput"] : ["audioinput", "videoinput"];

function docLuu(): Partial<Record<Kind, string>> {
  try {
    return JSON.parse(localStorage.getItem(KHOA_THIET_BI) ?? "{}");
  } catch {
    return {};
  }
}

// Popup "Cai dat" - Figma 136:515.
export function MeetingSettingsDialog({
  room,
  tietKiem,
  doiTietKiem,
  onClose,
}: {
  room: Room | null;
  // "Che do tiet kiem du lieu (Tat nhan camera moi nguoi)" - khong tai video
  // cua ai ve may nay ca.
  tietKiem: boolean;
  doiTietKiem: (v: boolean) => void;
  onClose: () => void;
}) {
  const [thietBi, setThietBi] = useState<Partial<Record<Kind, MediaDeviceInfo[]>>>({});
  const [dangDung, setDangDung] = useState<Partial<Record<Kind, string>>>({});
  const [loi, setLoi] = useState<string | null>(null);
  const [amLuong, setAmLuong] = useState(() => {
    const v = Number(localStorage.getItem(KHOA_AM_LUONG));
    return Number.isFinite(v) && v > 0 ? v : 100;
  });

  const napLai = useCallback(async () => {
    if (!room) return;
    const ds: Partial<Record<Kind, MediaDeviceInfo[]>> = {};
    for (const k of KINDS) {
      try {
        ds[k] = await Room.getLocalDevices(k, false);
      } catch {
        ds[k] = [];
      }
    }
    setThietBi(ds);

    const dang: Partial<Record<Kind, string>> = {};
    for (const k of KINDS) dang[k] = room.getActiveDevice(k);
    setDangDung(dang);
  }, [room]);

  // MediaDevicesChanged la ban boc san cua LiveKit quanh
  // navigator.mediaDevices.ondevicechange: cam tai nghe vao giua buoi hop thi
  // danh sach tu doi. ActiveDeviceChanged bat ca truong hop KHONG do minh
  // bam - rut thiet bi dang dung thi trinh duyet tu nhay ve mac dinh.
  useEffect(() => {
    if (!room) return;
    napLai();
    room.on(RoomEvent.MediaDevicesChanged, napLai);
    room.on(RoomEvent.ActiveDeviceChanged, napLai);
    return () => {
      room.off(RoomEvent.MediaDevicesChanged, napLai);
      room.off(RoomEvent.ActiveDeviceChanged, napLai);
    };
  }, [room, napLai]);

  async function chon(kind: Kind, deviceId: string) {
    if (!room) return;
    setLoi(null);
    try {
      await room.switchActiveDevice(kind, deviceId);
      try {
        localStorage.setItem(KHOA_THIET_BI, JSON.stringify({ ...docLuu(), [kind]: deviceId }));
      } catch {
        // localStorage day hoac bi chan - khong dang de hong tinh nang chinh
      }
      napLai();
    } catch {
      setLoi(`Không đổi được ${NHAN[kind].toLowerCase()} - thiết bị có thể đang bị ứng dụng khác giữ.`);
    }
  }

  // Keo thanh truot thi ap ngay, nhung chi GHI NHO khi tha tay: moi buoc keo
  // deu ghi localStorage la ghi hang tram lan cho mot lan chinh.
  const apRef = useRef<number>(amLuong);
  apRef.current = amLuong;
  function keo(v: number) {
    setAmLuong(v);
    if (room) void datAmLuongMic(room, v / 100);
  }
  function thaTay() {
    try {
      localStorage.setItem(KHOA_AM_LUONG, String(apRef.current));
    } catch {
      // nhu tren
    }
  }

  return (
    <MeetingPopup title="Cài đặt" onClose={onClose} width={825}>
      {KINDS.map((k) => (
        <div key={k} className="mpop-muc">
          <p className="mpop-nhan">{NHAN[k]}</p>
          <div className="mpop-chon">
            <select value={dangDung[k] ?? ""} onChange={(e) => void chon(k, e.target.value)} disabled={!room}>
              {(thietBi[k] ?? []).length === 0 && <option value="">Không tìm thấy thiết bị nào</option>}
              {(thietBi[k] ?? []).map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {/* Ten that ("HD Webcam C920") chi doc duoc sau khi da cap
                      quyen; truoc do trinh duyet tra chuoi rong. */}
                  {`${i + 1}. ${d.label || "Thiết bị " + (i + 1)}`}
                </option>
              ))}
            </select>
            <svg width="26" height="16" viewBox="0 0 24 14" fill="none" aria-hidden="true">
              <path d="m2 2 10 10L22 2" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      ))}

      {loi && <p className="mpop-loi">{loi}</p>}

      <HangTac
        nhan="Chế độ tiết kiệm dữ liệu (Tắt nhận camera mọi người)"
        bat={tietKiem}
        doi={doiTietKiem}
      />

      <div className="mpop-muc">
        <p className="mpop-nhan-nho">Âm lượng micro của bạn</p>
        <div className="mpop-truot">
          <span className="mpop-truot-moc">0%</span>
          <span className="mpop-truot-moc mpop-truot-moc-phai">500%</span>
          <input
            type="range"
            min={0}
            max={500}
            step={5}
            value={amLuong}
            onChange={(e) => keo(Number(e.target.value))}
            onPointerUp={thaTay}
            onKeyUp={thaTay}
            aria-label="Âm lượng micro của bạn"
            style={{ ["--phan" as string]: `${(amLuong / 500) * 100}%` }}
          />
        </div>
        <p className="mpop-ghi-chu">Đang đặt {amLuong}%. Trên 100% là khuếch đại — to quá dễ rè.</p>
      </div>
    </MeetingPopup>
  );
}
