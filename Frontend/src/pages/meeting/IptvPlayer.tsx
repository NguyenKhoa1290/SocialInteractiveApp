import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";

// Trinh phat cho Mini App IPTV (UC-37 buoc 3-5).
//
// Vi sao khong dung the <video> khong: the <video> thuan CHI phat duoc .m3u8
// tren Safari. Tren Chrome/Firefox no khong phat gi ca. hls.js dich manifest
// HLS thanh Media Source Extensions nen chay duoc o moi trinh duyet.
//
// Nhung co hls.js roi van con BA viec ma trinh phat mac dinh khong lam, va
// do la ly do file nay dai hon mot the video:
//
//  1. TU CHUA KHI LUONG DUT. Nguon IPTV mien phi rot goi, doi CDN, hoac dung
//     phat vai giay la chuyen thuong. hls.js co retry rieng nhung HET LUOT
//     thi no ngung han - man hinh dung yen mai, khong bao gi. O day co them
//     watchdog: moi giay kiem tra currentTime co nhich khong; treo qua
//     STALL_SECONDS thi nhay ve mep song va nap lai. Ke ca khi khong he co
//     su kien loi nao (truong hop "video dung, khong tu chay tiep").
//  2. NHO TIENG DA CHON. Moi lan nap lai - hoac khi nguon doi danh sach
//     track giua chung - CHI SO track co the khac, nen phai nho theo TEN.
//     Nho theo so thi sau mot lan dut mang la tieng nhay ve mac dinh.
//  3. BAM MEP SONG. Luong truc tiep bi tut lai sau moi lan nghen mang; khong
//     keo len thi cang xem cang tre so voi phat song that.
//
// Uu tien hls.js hon ban HLS native cua Safari (nguoc voi truoc day): ban
// native khong cho doc/doi audio track qua hls.audioTracks va khong moc duoc
// lop tu chua o tren, nen hai trinh duyet se hanh xu khac han nhau. Native
// chi con la duong lui khi trinh duyet khong co MSE (Safari tren iOS).
//
// UC-37 buoc 5 ("chon kenh am thanh rieng neu co, tu chinh am luong video
// cua minh"): danh sach audio track doc THANG TU LUONG chu khong phai tu cot
// audio_track trong DB - cot do chi la goi y "track uu tien mac dinh" do
// nguoi tao kenh nhap, khong chac khop voi luong that. Ca 2 thu deu la lua
// chon RIENG cua tung nguoi xem, dung tinh than "moi nguoi trong phong tu
// fetch stream rieng" cua UC-37 buoc 4.

// So lan tu chua lien tiep truoc khi bo cuoc va hoi nguoi dung. Dem nay ve 0
// ngay khi video chay lai duoc, nen mot kenh chap chon ca ngay van khong bao
// gio cham tran - chi kenh CHET han moi cham.
const MAX_RECOVERY = 8;
// Bao nhieu giay lien khong nhich noi mot khung hinh thi coi la treo.
const STALL_SECONDS = 8;

type PlayerStatus = "loading" | "playing" | "recovering" | "failed";

// Lua chon phat cua NGUOI TRINH BAY, dat o buoc "Tuy chinh kenh" (Figma
// 140:396). Deu la lua chon cuc bo cua may nay: moi nguoi trong phong tu tai
// luong rieng nen ai muon xem o do phan giai nao la viec cua nguoi do.
export type TuyChonPhat = {
  // Chi so muc chat luong trong hls.levels. -1 = de hls.js tu chon.
  mucChatLuong: number;
  // Chi so trong hls.audioTracks. -1 = theo mac dinh cua luong.
  luongAmThanh: number;
  // Dang "kid:key", ca hai la chuoi hex 32 ky tu.
  khoaClearKey: string;
  // Am luong the <video>, 0..1. Nam o day chu khong phai state trong
  // IptvPlayer vi thanh keo da chuyen sang popup Mini App - khung trinh chieu
  // gio CHI con video.
  amLuong: number;
};

export const TUY_CHON_MAC_DINH: TuyChonPhat = {
  mucChatLuong: -1,
  luongAmThanh: -1,
  khoaClearKey: "",
  amLuong: 1,
};

// Doi mot cap kid:key hex thanh mot "giay phep" ClearKey (JWK Set) nhung
// duoi dang data: URL, de hls.js coi no nhu mot may chu cap phep.
//
// CHUA KIEM DUOC TREN LUONG THAT: khong co nguon ClearKey nao de thu. Neu no
// hong thi cho hong nam o buoc hls.js goi XHR toi data: URL - luc do doi
// licenseUrl sang mot duong dan cung nguon tra 200 la chay, vi
// licenseResponseCallback ben duoi da thay noi dung tra ve roi.
function giayPhepClearKey(khoa: string): string | null {
  const m = khoa.trim().match(/^([0-9a-fA-F]{32}):([0-9a-fA-F]{32})$/);
  if (!m) return null;
  const b64url = (hex: string) => {
    const b = Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
    return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return JSON.stringify({ keys: [{ kty: "oct", kid: b64url(m[1]), k: b64url(m[2]) }], type: "temporary" });
}

type AudioOption = { index: number; name: string; lang: string };

// Doi mot ten track sang o trong danh sach that. Tim theo nhieu muc do khop
// vi ten trong DB do nguoi dung go tay ("VN", "Tieng Viet", "vie") con ten
// trong luong do nha dai dat.
function pickTrack(tracks: AudioOption[], want: string | null | undefined): AudioOption | null {
  const w = want?.trim().toLowerCase();
  if (!w) return null;
  return (
    tracks.find((t) => t.name.toLowerCase() === w) ??
    tracks.find((t) => t.lang.toLowerCase() === w) ??
    tracks.find((t) => t.name.toLowerCase().includes(w)) ??
    tracks.find((t) => t.lang.toLowerCase().includes(w)) ??
    null
  );
}

export function IptvPlayer({
  src,
  preferredAudioTrack,
  tuyChon,
}: {
  src: string;
  preferredAudioTrack?: string | null;
  tuyChon?: TuyChonPhat;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);
  // Tang len de dung han trinh phat cu va dung lai tu dau.
  const [generation, setGeneration] = useState(0);

  // Tieng nguoi xem DA TU CHON, nho theo TEN. Nam trong ref chu khong phai
  // state vi no phai song sot qua ca nhung lan dung lai tu dau.
  const chosenAudioRef = useRef<string | null>(null);
  // Con so nguoi xem chon o popup, de biet khi nao no VUA doi - luc do moi
  // ghi lai ten track tuong ung. Xem applyTracks ben duoi.
  const soDaChonRef = useRef(-1);
  const preferredRef = useRef<string | null | undefined>(preferredAudioTrack);
  preferredRef.current = preferredAudioTrack;

  // Doi KENH la quen lua chon tieng cu: chi so trong tuyChon la chi so cua
  // danh sach track thuoc kenh TRUOC. Nap lai cung mot kenh thi van nho.
  useEffect(() => {
    soDaChonRef.current = -1;
    chosenAudioRef.current = null;
  }, [src]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setStatus("loading");
    setMessage(null);

    let dead = false;
    let healthy = false;
    let recoveries = 0;
    let swappedCodec = false;
    const timers: number[] = [];

    const later = (fn: () => void, ms: number) => {
      timers.push(
        window.setTimeout(() => {
          if (!dead) fn();
        }, ms),
      );
    };

    // Video chay duoc = xoa sach dau vet cua con dut truoc do, de lan sau con
    // nguyen ngan sach lan tu chua.
    const markHealthy = () => {
      recoveries = 0;
      swappedCodec = false;
      if (healthy) return;
      healthy = true;
      setStatus("playing");
      setMessage(null);
    };

    // Luong truc tiep khong co "tua lai" - dung o dau thi noi tu MEP SONG,
    // khong phai tu cho da dung.
    const seekToLiveEdge = () => {
      const live = hlsRef.current?.liveSyncPosition;
      try {
        if (live != null && Number.isFinite(live) && live > video.currentTime) {
          video.currentTime = live;
        } else if (video.buffered.length > 0) {
          const end = video.buffered.end(video.buffered.length - 1);
          if (end > video.currentTime + 1) video.currentTime = end - 0.5;
        }
      } catch {
        // currentTime nem khi luong chua san sang - bo qua, vong watchdog sau
        // se thu lai.
      }
    };

    const recover = (kind?: string) => {
      if (dead) return;
      healthy = false;
      recoveries += 1;

      if (recoveries > MAX_RECOVERY) {
        setStatus("failed");
        setMessage("Luồng phát liên tục bị gián đoạn — nguồn có thể đã tắt.");
        return;
      }

      setStatus("recovering");
      setMessage("Mất tín hiệu, đang kết nối lại… (lần " + recoveries + ")");

      const hls = hlsRef.current;

      if (hls && kind === Hls.ErrorTypes.MEDIA_ERROR) {
        // Loi giai ma. Lan dau va lai buffer; van hong thi doi codec am thanh
        // - mot so nguon doi codec giua chung, hls.js co san buoc nay.
        if (swappedCodec) hls.swapAudioCodec();
        swappedCodec = true;
        hls.recoverMediaError();
        return;
      }

      // Loi mang, hoac treo khong ro nguyen nhan: nap lai, gian dan de khong
      // quat nguon dang chap chon.
      later(() => {
        seekToLiveEdge();
        if (hlsRef.current) hlsRef.current.startLoad();
        else video.load();
        void video.play().catch(() => {});
      }, Math.min(1000 * recoveries, 8000));
    };

    if (Hls.isSupported()) {
      const giayPhep = tuyChon?.khoaClearKey ? giayPhepClearKey(tuyChon.khoaClearKey) : null;
      const hls = new Hls({
        // Luong IPTV la TRUC TIEP: bam sat mep song, va tu tang toc phat nhe
        // de duoi kip sau moi lan nghen mang.
        liveSyncDurationCount: 3,
        maxLiveSyncPlaybackRate: 1.5,
        liveDurationInfinity: true,
        // Kenh IPTV chay lien hang gio - giu lai phan da phat chi ton RAM.
        backBufferLength: 60,
        // Chi bat EME khi that su co khoa: bat san se lam hls.js hoi
        // requestMediaKeySystemAccess cho MOI luong, ke ca luong khong ma hoa.
        ...(giayPhep
          ? {
              emeEnabled: true,
              drmSystems: {
                'org.w3.clearkey': { licenseUrl: 'data:application/json;base64,' + btoa(giayPhep) },
              },
              // Thay han noi dung tra ve: giay phep ClearKey khong den tu may
              // chu nao ca, no duoc dung tu cap kid:key nguoi dung go vao.
              licenseResponseCallback: () => new TextEncoder().encode(giayPhep).buffer as ArrayBuffer,
            }
          : {}),
      });
      hlsRef.current = hls;

      // Muc chat luong va luong tieng do nguoi trinh bay chon o buoc "Tuy
      // chinh kenh". -1 la de hls.js tu lo, dung mac dinh cua no.
      if (tuyChon && tuyChon.mucChatLuong >= 0) hls.currentLevel = tuyChon.mucChatLuong;

      const applyTracks = () => {
        const tracks: AudioOption[] = hls.audioTracks.map((t, i) => ({
          index: i,
          name: t.name || t.lang || "Tiếng " + (i + 1),
          lang: t.lang ?? "",
        }));
        if (tracks.length === 0) return;

        // Nguoi trinh bay da chon THANG mot luong o buoc "Tuy chinh kenh" thi
        // theo dung so do - luc do da nhin danh sach that roi, khong phai doan
        // theo ten nua.
        const soDaChon = tuyChon?.luongAmThanh ?? -1;
        if (soDaChon >= 0) {
          // Con so chi dung DUNG LUC nguoi xem chon. Tu do ve sau nho theo
          // TEN: qua mot lan nap lai, hoac khi nguon doi danh sach giua chung,
          // chi so cu co the tro sang mot track khac han.
          if (soDaChonRef.current !== soDaChon) {
            soDaChonRef.current = soDaChon;
            chosenAudioRef.current = tracks[soDaChon]?.name ?? null;
          }
          const dich = pickTrack(tracks, chosenAudioRef.current);
          const so = dich ? dich.index : soDaChon < tracks.length ? soDaChon : -1;
          if (so >= 0 && hls.audioTrack !== so) hls.audioTrack = so;
          return;
        }

        // Chua chon gi thi theo goi y trong DB do nguoi tao kenh nhap.
        const want = pickTrack(tracks, preferredRef.current);
        if (want && hls.audioTrack !== want.index) hls.audioTrack = want.index;
      };

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => {
          // Trinh duyet chan tu dong phat khi chua co tuong tac - khong phai
          // loi, nguoi dung bam nut play la duoc.
        });
      });

      // Danh sach track co the doi GIUA CHUNG khi nguon chuyen chuong trinh
      // (vd tran bong co them binh luan tieng Viet o hiep hai), nen phai gan
      // lai moi lan chu khong chi doc mot lan luc bat dau.
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, applyTracks);

      hls.on(Hls.Events.ERROR, (_e, data) => {
        // hls.js tu retry duoc rat nhieu loi tam thoi - chi vao cuoc khi no
        // da bo cuoc (fatal).
        if (!data.fatal || dead) return;
        recover(data.type);
      });

      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari tren iOS: khong co MSE nen hls.js khong chay. Phat native, van
      // giu watchdog ben duoi nhung khong doi duoc audio track.
      video.src = src;
      void video.play().catch(() => {});
    } else {
      setStatus("failed");
      setMessage("Trình duyệt này không phát được luồng HLS.");
      return;
    }

    // --- Watchdog ---------------------------------------------------------
    // Day la thu bat duoc truong hop nguoi dung gap: video dung han nhung
    // KHONG co su kien loi nao (buffer can vi nguon ngat giua chung, hoac
    // hls.js da het luot retry va im lang).
    let lastTime = -1;
    let stalled = 0;
    const watchdog = window.setInterval(() => {
      if (dead) return;
      if (video.paused || video.ended || video.seeking || video.readyState === 0) {
        lastTime = video.currentTime;
        stalled = 0;
        return;
      }
      if (video.currentTime > lastTime + 0.05) {
        lastTime = video.currentTime;
        stalled = 0;
        markHealthy();
        return;
      }
      stalled += 1;
      if (stalled < STALL_SECONDS) return;
      stalled = 0;
      recover();
    }, 1000);

    const onVideoError = () => recover();
    // Nguon truc tiep bao "het" nghia la no vua ngat - thu noi lai thay vi de
    // man hinh dung o khung cuoi cung.
    const onEnded = () => later(reload, 2000);
    video.addEventListener("error", onVideoError);
    video.addEventListener("ended", onEnded);

    return () => {
      dead = true;
      window.clearInterval(watchdog);
      timers.forEach((t) => window.clearTimeout(t));
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("ended", onEnded);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      // Duong native: khong go src thi trinh duyet tai tiep du da thao.
      if (video.src) {
        video.removeAttribute("src");
        video.load();
      }
    };
    // khoaClearKey nam trong deps vi no chi gan duoc luc DUNG Hls len - doi
    // khoa la phai dung lai tu dau. Con muc chat luong va luong tieng thi doi
    // duoc giua chung, xem effect ngay duoi.
  }, [src, generation, reload, tuyChon?.khoaClearKey]);

  // Doi muc chat luong / luong tieng GIUA CHUNG: chi gan lai hai con so, KHONG
  // dung Hls lai. Dung lai la mat vai giay dem va video giat ve dau.
  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls) return;
    const muc = tuyChon?.mucChatLuong ?? -1;
    if (hls.currentLevel !== muc) hls.currentLevel = muc;
    const tieng = tuyChon?.luongAmThanh ?? -1;
    if (tieng >= 0 && hls.audioTrack !== tieng) hls.audioTrack = tieng;
  }, [tuyChon?.mucChatLuong, tuyChon?.luongAmThanh]);

  // Am luong den tu popup Mini App (IptvChannelPicker), khong con thanh keo
  // nao trong khung trinh chieu.
  //
  // CHI chay khi con so trong popup doi - co y khong gan lai theo src hay
  // generation. The <video> song suot ca phien (xem IptvPlayerHost) nen no tu
  // giu am luong qua moi lan doi kenh/nap lai; gan lai o day chi to bat nguoc
  // lai nguoi vua keo thanh am luong SAN CO cua trinh duyet.
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = tuyChon?.amLuong ?? 1;
  }, [tuyChon?.amLuong]);

  return (
    <div className="iptv-player">
      <div className="iptv-player-frame">
        <video ref={videoRef} controls playsInline className="meet-iptv-video" />
        {(status === "recovering" || status === "failed") && (
          <div className="iptv-player-overlay">
            <span>{message}</span>
            {status === "failed" && <button onClick={reload}>Thử lại</button>}
          </div>
        )}
      </div>
    </div>
  );
}
