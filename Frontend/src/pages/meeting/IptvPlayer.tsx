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
  // Cap "KID:KEY" hex 32 ky tu. Khi co gia tri, DASH se dung Shaka Player voi
  // clearKeys thay vi dashjs (Shaka giai ma duoc CENC Widevine bang raw key,
  // dashjs thi khong). Xem tham khao: thamkhao/video-direct/player.html.
  khoaClearKey: string;
  // URL Key API (vd: https://vmttv.dpdns.org/AutoKey/). Khi user cung cap KID
  // (hoac tu trich KID tu MPD), app POST {"kids":[kid_b64url],"type":"temporary"}
  // toi URL nay de lay key tu dong, dien vao khoaClearKey.
  linkLayKey: string;
  // Am luong the <video>, 0..1. Nam o day chu khong phai state trong
  // IptvPlayer vi thanh keo da chuyen sang popup Mini App - khung trinh chieu
  // gio CHI con video.
  amLuong: number;
};

export const TUY_CHON_MAC_DINH: TuyChonPhat = {
  mucChatLuong: -1,
  luongAmThanh: -1,
  khoaClearKey: "",
  linkLayKey: "",
  amLuong: 1,
};

// Ba dinh dang luong, ba thu vien - trinh duyet khong tu phat duoc cai nao
// trong so nay (tru HLS tren Safari):
//
//   .m3u8  HLS   hls.js      dinh kem san trong goi, la duong dung nhieu nhat
//   .mpd   DASH  dashjs      nap khi can
//   .flv   FLV   mpegts.js   nap khi can
//   .ts    TS    mpegts.js   nap khi can - luong MPEG-TS phat THANG qua HTTP
//
// Dung nham lan .ts o day voi cac doan .ts BEN TRONG mot playlist HLS: nhung
// doan do la viec rieng cua hls.js, khong bao gio di qua ham doan loai nay.
// Chi URL cua KENH moi di qua day, nen mot URL kenh tan cung bang .ts la mot
// luong TS lien tuc chu khong phai mot doan.
//
// Hai thu vien sau NAP DONG. Cong lai chung nang gan 700KB roi, ma phan lon
// phong hop chi phat HLS - de tinh vao goi chinh thi ai cung phai tai ve mot
// thu chin phan muoi khong dung toi. Vite tach chung thanh chunk rieng.
//   .mp3/.aac/... AUDIO  <video> native - file/luong am thanh phat THANG,
//                        khong can thu vien nao. Khung chieu hien "Mau file
//                        am thanh dang phat" thay cho o hinh den.
export type LoaiLuong = "hls" | "dash" | "flv" | "ts" | "audio";

// Duoi tep am thanh trinh duyet phat thang duoc bang the <video>/<audio>.
const DUOI_AM_THANH = ["mp3", "aac", "m4a", "ogg", "oga", "opus", "wav", "flac", "weba", "mp2", "mpa"];

export function doanLoaiLuong(url: string): LoaiLuong {
  // Cat query va fragment TRUOC khi nhin duoi tep: rat nhieu link IPTV co
  // dang .../live.flv?token=<chuoi rat dai> - nhin ca chuoi thi duoi khong
  // bao gio nam o cuoi.
  let duong: string;
  try {
    duong = new URL(url, window.location.href).pathname;
  } catch {
    duong = url.split(/[?#]/)[0];
  }
  duong = duong.toLowerCase();

  if (duong.endsWith(".flv")) return "flv";
  if (duong.endsWith(".mpd")) return "dash";
  if (duong.endsWith(".ts") || duong.endsWith(".m2ts") || duong.endsWith(".mts")) return "ts";
  if (duong.endsWith(".m3u8") || duong.endsWith(".m3u")) return "hls";
  {
    const duoi = duong.split(".").pop() ?? "";
    if (DUOI_AM_THANH.includes(duoi)) return "audio";
  }

  // Mot so nha cung cap khong de duoi o duong dan ma nhet vao tham so:
  // ...?type=flv, .../play?fmt=mpd. Chi xet khi duong dan da khong noi len gi.
  //
  // KHONG doan "ts" theo kieu nay: hai chu do qua ngan va gap khap noi trong
  // chuoi truy van (timestamp, token...), doan bua la cuop luong HLS binh
  // thuong dua sang sai bo giai ma.
  const ca = url.toLowerCase();
  if (/[?&=/.]flv(\b|$)/.test(ca)) return "flv";
  if (/[?&=/.]mpd(\b|$)/.test(ca)) return "dash";

  // Khong doan ra thi coi la HLS: dinh dang pho bien nhat, va la hanh vi cu.
  return "hls";
}

// Doi chuoi hex 32 ky tu sang base64url (khong dem). Dung cho Shaka Player
// clearKeys config — xem thamkhao/video-direct/player.html hexToBase64Url().
function hexToBase64Url(hex: string): string {
  const bytes = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Tach cap "KID:KEY" hex thanh hai chuoi base64url. Tra null neu dinh dang sai.
function tachClearKey(khoa: string): { kid: string; key: string } | null {
  const m = khoa.trim().match(/^([0-9a-fA-F]{32}):([0-9a-fA-F]{32})$/);
  if (!m) return null;
  return { kid: hexToBase64Url(m[1]), key: hexToBase64Url(m[2]) };
}

// Nhung gi mot trinh giai ma NAP DONG phai cung cap cho phan chung: watchdog
// goi napLai khi luong treo, effect doi chat luong goi hai ham dat, va luc
// thao thi goi thao. hls.js khong di qua day - no da co duong rieng trong
// effect chinh tu truoc.
type Engine = {
  napLai: () => void;
  thao: () => void;
  datChatLuong?: (chiSo: number) => void;
  datTieng?: (chiSo: number) => void;
};

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
  tenKenh,
  tuyChon,
}: {
  src: string;
  preferredAudioTrack?: string | null;
  // Ten kenh - lam nhan cho khung "Mau file am thanh dang phat".
  tenKenh?: string | null;
  tuyChon?: TuyChonPhat;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  // Trinh giai ma DASH/FLV. Chi mot trong hai ref nay khac null tai mot thoi
  // diem - luong nao thi engine day.
  const engineRef = useRef<Engine | null>(null);

  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);
  // Luong nay la am thanh thuan: khung chieu khong co hinh (videoWidth=0) nen
  // phu "Mau file am thanh dang phat" len tren the <video> den.
  const laAmThanh = doanLoaiLuong(src) === "audio";
  // Nut tron trong khung am thanh la play/pause that - theo dung trang thai
  // paused cua the <video> (co the doi do watchdog nap lai, do nguoi bam...).
  const [dangTamDung, setDangTamDung] = useState(false);
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
  // Lua chon moi nhat, de duong nap dong doc duoc no khi engine dung xong -
  // luc do effect doi chat luong da chay tu lau roi.
  const tuyChonRef = useRef(tuyChon);
  tuyChonRef.current = tuyChon;

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
        setMessage("Luồng phát liên tục bị gián đoạn - nguồn có thể đã tắt.");
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
        else if (engineRef.current) engineRef.current.napLai();
        else video.load();
        void video.play().catch(() => {});
      }, Math.min(1000 * recoveries, 8000));
    };

    const loai = doanLoaiLuong(src);

    // Ap lai lua chon cua nguoi xem sau khi engine nap xong. Phai lam o day
    // chu khong o effect doi chat luong: effect do chay ngay, con engine thi
    // vai tram mili giay sau moi co (nap dong + doc manifest).
    const apDungTuyChon = () => {
      const t = tuyChonRef.current;
      engineRef.current?.datChatLuong?.(t?.mucChatLuong ?? -1);
      engineRef.current?.datTieng?.(t?.luongAmThanh ?? -1);
    };

    if (loai === "dash") {
      // Khi co cap KID:KEY, dung Shaka Player thay dashjs: Shaka giai ma duoc
      // noi dung CENC khai bao Widevine bang raw ClearKey (dashjs thi khong).
      // Xem tham khao: thamkhao/video-direct/player.html.
      const ck = tuyChon?.khoaClearKey ? tachClearKey(tuyChon.khoaClearKey) : null;

      if (ck) {
        // ========== SHAKA PLAYER (co key DRM) ==========
        void (async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const shakaModule = await import("shaka-player") as any;
            const shaka = shakaModule.default ?? shakaModule;
            if (dead) return;
            if (!shaka.Player.isBrowserSupported()) {
              setStatus("failed");
              setMessage("Trình duyệt không hỗ trợ Shaka Player / EME.");
              return;
            }
            const player = new shaka.Player();
            await player.attach(video);
            player.configure({
              drm: { clearKeys: { [ck.kid]: ck.key } },
              streaming: { rebufferingGoal: 2, bufferingGoal: 10 },
            });
            player.addEventListener("error", () => { if (!dead) recover(); });
            await player.load(src);
            markHealthy();
            apDungTuyChon();

            engineRef.current = {
              napLai: async () => { await player.load(src); },
              thao: () => { void player.destroy(); },
              datChatLuong: (chiSo) => {
                if (chiSo < 0) {
                  player.configure({ abr: { enabled: true } });
                } else {
                  player.configure({ abr: { enabled: false } });
                  const tracks = player.getVariantTracks();
                  if (chiSo < tracks.length) player.selectVariantTrack(tracks[chiSo], true);
                }
              },
              datTieng: (chiSo) => {
                if (chiSo < 0) return;
                const langs = player.getAudioLanguages();
                if (chiSo < langs.length) player.selectAudioLanguage(langs[chiSo]);
              },
            };
          } catch (err) {
            if (dead) return;
            setStatus("failed");
            setMessage("Không phát được DASH+DRM: " + (err instanceof Error ? err.message : String(err)));
          }
        })();
      } else {
        // ========== DASHJS (khong co key, luong khong ma hoa) ==========
        void (async () => {
          try {
            const { MediaPlayer } = await import("dashjs");
            if (dead) return;
            const player = MediaPlayer().create();
            player.updateSettings({
              streaming: {
                delay: { liveDelay: 6 },
                liveCatchup: { enabled: true },
              },
            });

            player.initialize(video, src, true);
            player.on("playbackPlaying", markHealthy);
            player.on("streamInitialized", apDungTuyChon);
            player.on("error", () => { if (!dead) recover(); });

            engineRef.current = {
              napLai: () => player.attachSource(src),
              thao: () => player.destroy(),
              datChatLuong: (chiSo) => {
                player.updateSettings({
                  streaming: { abr: { autoSwitchBitrate: { video: chiSo < 0 } } },
                });
                if (chiSo >= 0) player.setRepresentationForTypeByIndex("video", chiSo);
              },
              datTieng: (chiSo) => {
                if (chiSo < 0) return;
                const ds = player.getTracksFor("audio");
                if (chiSo < ds.length) player.setCurrentTrack(ds[chiSo]);
              },
            };
          } catch {
            if (dead) return;
            setStatus("failed");
            setMessage("Không tải được bộ giải mã DASH.");
          }
        })();
      }
    } else if (loai === "flv" || loai === "ts") {
      // Cung mot thu vien cho ca hai: mpegts.js doc duoc ca vo boc FLV lan
      // luong MPEG-TS tran. Chi khac mot chu trong `type`.
      const ten = loai === "ts" ? "MPEG-TS" : "FLV";
      void (async () => {
        try {
          const mpegts = (await import("mpegts.js")).default;
          if (dead) return;
          if (!mpegts.isSupported()) {
            setStatus("failed");
            setMessage(`Trình duyệt này không phát được luồng ${ten}.`);
            return;
          }
          const player = mpegts.createPlayer(
            { type: loai === "ts" ? "mpegts" : "flv", url: src, isLive: true, cors: true },
            {
              // Luong truc tiep: bo bo dem trung gian de bam sat mep song.
              enableStashBuffer: false,
              enableWorker: true,
              // KHONG bat liveBufferLatencyChasing. Do duoc tren he thong
              // that: voi mot tep .flv co do dai huu han, "mep song" chinh la
              // cuoi tep - no nhay thang toi 20,09/20,09 giay ngay khi tai
              // xong roi bao het. Luong FLV that thi khong can no: may chu chi
              // gui tu THOI DIEM NAY tro di nen trinh phat da o mep san, con
              // do tre tich luy sau moi lan nghen thi watchdog ben duoi nap
              // lai la ve dung.
            },
          );
          player.attachMediaElement(video);
          player.load();
          void Promise.resolve(player.play()).catch(() => {});
          player.on(mpegts.Events.ERROR, () => {
            if (!dead) recover();
          });

          engineRef.current = {
            napLai: () => {
              player.unload();
              player.load();
              void Promise.resolve(player.play()).catch(() => {});
            },
            thao: () => player.destroy(),
            // FLV la MOT luong duy nhat: khong co muc chat luong lan nhieu
            // track tieng de doi. Bo trong hai ham la effect doi chat luong
            // tu khong lam gi.
          };
        } catch {
          if (dead) return;
          setStatus("failed");
          setMessage(`Không tải được bộ giải mã ${ten}.`);
        }
      })();
    } else if (loai === "audio") {
      // File/luong am thanh: the <video> phat thang, khong can thu vien nao.
      // videoWidth = 0 nen o hinh den - lop phu "dang phat am thanh" (ben duoi
      // trong JSX) che len. Watchdog van chay: currentTime cua tieng cung nhich.
      video.src = src;
      void video.play().catch(() => {
        // Trinh duyet chan tu phat khi chua tuong tac - bam play la duoc.
      });
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        // Luong IPTV la TRUC TIEP: bam sat mep song, va tu tang toc phat nhe
        // de duoi kip sau moi lan nghen mang.
        liveSyncDurationCount: 3,
        maxLiveSyncPlaybackRate: 1.5,
        liveDurationInfinity: true,
        // Kenh IPTV chay lien hang gio - giu lai phan da phat chi ton RAM.
        backBufferLength: 60,
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
    // Nguon TRUC TIEP bao "het" nghia la no vua ngat - thu noi lai thay vi de
    // man hinh dung o khung cuoi cung.
    //
    // Nhung mot tep co do dai huu han (VOD, hay mot .flv tinh) thi "het" dung
    // la het - nap lai la roi vao vong phat di phat lai khong bao gio dung.
    // Luong truc tiep khong dinh vao day: HLS chay voi liveDurationInfinity
    // nen duration la Infinity, con FLV truc tiep thi khong co duration.
    const onEnded = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) return;
      later(reload, 2000);
    };
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
      engineRef.current?.thao();
      engineRef.current = null;
      // Duong native: khong go src thi trinh duyet tai tiep du da thao.
      if (video.src) {
        video.removeAttribute("src");
        video.load();
      }
    };
    // khoaClearKey nam trong deps vi doi key la phai dung player lai tu dau
    // (Shaka vs dashjs). Cung la trigger cho "Phat lai" (MeetingRoomPage).
  }, [src, generation, reload, tuyChon?.khoaClearKey]);

  // Doi muc chat luong / luong tieng GIUA CHUNG: chi gan lai hai con so, KHONG
  // dung Hls lai. Dung lai la mat vai giay dem va video giat ve dau.
  useEffect(() => {
    const muc = tuyChon?.mucChatLuong ?? -1;
    const tieng = tuyChon?.luongAmThanh ?? -1;

    const hls = hlsRef.current;
    if (hls) {
      if (hls.currentLevel !== muc) hls.currentLevel = muc;
      if (tieng >= 0 && hls.audioTrack !== tieng) hls.audioTrack = tieng;
      return;
    }

    // DASH cung hai con so do, chi khac ten ham. FLV la luong don nen engine
    // cua no bo trong hai ham nay - goi vao khong lam gi ca.
    engineRef.current?.datChatLuong?.(muc);
    engineRef.current?.datTieng?.(tieng);
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

  // Nut play/pause cua khung am thanh phai anh dung trang thai that: video co
  // the bi trinh duyet tam dung, watchdog nap lai... nen theo su kien chu
  // khong tu doan.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !laAmThanh) return;
    const dong = () => setDangTamDung(video.paused);
    dong();
    video.addEventListener("play", dong);
    video.addEventListener("pause", dong);
    return () => {
      video.removeEventListener("play", dong);
      video.removeEventListener("pause", dong);
    };
  }, [laAmThanh, src, generation]);

  const toggleAmThanh = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  };

  return (
    <div className="iptv-player">
      <div className="iptv-player-frame">
        {/* Am thanh thuan khong co hinh: tat thanh dieu khien native (o video
            den) va thay bang khung "Mau file am thanh dang phat" (Figma 154:2). */}
        <video ref={videoRef} controls={!laAmThanh} playsInline className="meet-iptv-video" />

        {laAmThanh && status !== "failed" && status !== "recovering" && (
          <div className="iptv-audio">
            {/* Card 442x92: nut tron teal play/pause + ten file, nen pale bo
                20 vien navy - dung khuon the .ma-app. */}
            <div className="iptv-audio-card">
              <button
                type="button"
                className="iptv-audio-btn"
                onClick={toggleAmThanh}
                title={dangTamDung ? "Phát" : "Tạm dừng"}
                aria-label={dangTamDung ? "Phát" : "Tạm dừng"}
              >
                {dangTamDung ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="7" y="5" width="3.4" height="14" rx="1.1" fill="currentColor" />
                    <rect x="13.6" y="5" width="3.4" height="14" rx="1.1" fill="currentColor" />
                  </svg>
                )}
              </button>
              <span className="iptv-audio-name" title={tenKenh ?? undefined}>
                {tenKenh ?? "File âm thanh"}
              </span>
            </div>
          </div>
        )}

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
