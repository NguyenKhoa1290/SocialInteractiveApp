import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { iptvApi } from "../../api/mediaApi";
import { IptvPlayer } from "./IptvPlayer";
import { extractApiError } from "../../lib/apiError";

// Giu MOT trinh phat IPTV duy nhat cho ca phien hop.
//
// Van de truoc day: <IptvStage> duoc render o HAI cho khac nhau trong cay
// React - mot trong khung trinh bay (focus mode), mot trong o luoi. Doi bo
// cuc la React thao cho nay ra va dung cho kia len, tuc la huy ca Hls
// instance, goi lai API lay stream URL, roi tai manifest tu dau. Nguoi xem
// thay video giat lai tu dau moi lan bam "Xem dang luoi" va nguoc lai.
//
// Cach sua: the <video> khong nam trong cay React cua bat ky bo cuc nao. No
// song trong mot the div roi (holder) do component nay giu suot phien, va
// duoc DI CHUYEN bang appendChild sang o dang hien thi.
//
// Vi sao di chuyen the <video> khong lam mat luong: theo dac ta HTML, khi mot
// media element bi go khoi document trinh duyet cho toi "stable state" roi
// MOI kiem tra - neu luc do no da nam trong document tro lai thi khong tam
// dung gi ca. React lam ca hai viec (go o cu, dung o moi) trong cung MOT lan
// commit dong bo, nen dieu kien do luon dung o day.
//
// Viec goi API lay stream URL cung chuyen len day, vi ly do tuong tu: no phu
// thuoc vao KENH dang chieu chu khong phai vao bo cuc dang xem.

type SlotStatus = "idle" | "loading" | "ready" | "error";

type IptvSlotApi = {
  status: SlotStatus;
  error: string | null;
  // Lo ra de khung trinh bay con dat duoc link "mo luong o tab moi".
  streamUrl: string | null;
  // Gan lam ref cho o muon dat trinh phat vao.
  mount: (el: HTMLDivElement | null) => void;
};

const IptvSlotContext = createContext<IptvSlotApi | null>(null);

export function useIptvSlot() {
  return useContext(IptvSlotContext);
}

export function IptvPlayerHost({
  meetingId,
  channelId,
  children,
}: {
  meetingId: number;
  // Kenh dang chieu cho ca phong (null = chua ai gan link kenh).
  channelId: number | null;
  children: ReactNode;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  if (holderRef.current === null) {
    holderRef.current = document.createElement("div");
    holderRef.current.className = "iptv-player-holder";
  }

  // Nguoi xem CO MUON dang phat hay khong. Can phan biet voi video.paused vi
  // trinh duyet tu tam dung khi the <video> bi go khoi document - chuyen do
  // xay ra khi o IPTV roi sang mot TRANG LUOI khac va khong o nao nhan trinh
  // phat nua. Neu chi nhin video.paused thi luc quay lai se dung hinh.
  const wantPlayRef = useRef(false);

  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [audioTrack, setAudioTrack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Doi kenh la doi han luong - phai bo trinh phat cu di, khong tai cho.
    setStreamUrl(null);
    setError(null);
    if (channelId === null) return;

    let cancelled = false;
    iptvApi
      .getStreamUrl(meetingId, channelId)
      .then((res) => {
        if (cancelled) return;
        setStreamUrl(res.data.streamUrl);
        setAudioTrack(res.data.audioTrack);
      })
      .catch((err) => {
        if (!cancelled) setError(extractApiError(err, "Không lấy được luồng phát"));
      });

    return () => {
      cancelled = true;
    };
  }, [meetingId, channelId]);

  // Bam y dinh cua nguoi xem: mot lan tam dung khi the <video> DANG o trong
  // document la do nguoi dung bam nut; tam dung khi no da bi go ra la do
  // trinh duyet. Nghe o pha capture vi play/pause khong noi bot len.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const onPlay = () => {
      wantPlayRef.current = true;
    };
    const onPause = (e: Event) => {
      if (document.contains(e.target as Node)) wantPlayRef.current = false;
    };
    holder.addEventListener("play", onPlay, true);
    holder.addEventListener("pause", onPause, true);
    return () => {
      holder.removeEventListener("play", onPlay, true);
      holder.removeEventListener("pause", onPause, true);
    };
  }, []);

  const mount = useCallback((el: HTMLDivElement | null) => {
    const holder = holderRef.current;
    // el === null la luc React thao o cu ra. Khong lam gi: holder se duoc o
    // MOI nhan ngay trong cung lan commit nay.
    if (!holder || !el || holder.parentElement === el) return;

    el.appendChild(holder);

    // Doi bo cuc binh thuong thi video khong he dung, cau nay khong lam gi.
    // No chi co tac dung khi trinh phat vua tro ve tu trang thai bi go ra
    // (doi trang luoi), luc do phai tu chay tiep.
    const video = holder.querySelector("video");
    if (video && video.paused && !video.ended && wantPlayRef.current) {
      void video.play().catch(() => {});
    }
  }, []);

  const status: SlotStatus = channelId === null ? "idle" : error ? "error" : streamUrl ? "ready" : "loading";

  const api = useMemo<IptvSlotApi>(() => ({ status, error, streamUrl, mount }), [status, error, streamUrl, mount]);

  return (
    <IptvSlotContext.Provider value={api}>
      {children}
      {streamUrl && createPortal(<IptvPlayer src={streamUrl} preferredAudioTrack={audioTrack} />, holderRef.current)}
    </IptvSlotContext.Provider>
  );
}
