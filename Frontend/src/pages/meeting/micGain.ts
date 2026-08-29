import { Track, type LocalAudioTrack, type Room } from "livekit-client";

// "Am luong micro cua ban" 0-500% trong popup Cai dat (Figma 136:515).
//
// Khong the chinh bang mot thuoc tinh nao co san: LiveKit co setVolume nhung
// do la am luong NGHE nguoi khac, khong phai am luong minh PHAT. Muon khuech
// dai tieng cua chinh minh thi phai xen mot GainNode vao giua luong am thanh
// truoc khi no duoc gui di - do la viec cua mot "track processor".
//
// Dinh lieu quan trong: chi GAN bo xu ly khi nguoi dung that su keo thanh
// truot khoi 100%. Gan bo xu ly la thay track dang phat - co mot khoang lang
// rat ngan - nen phan lon phien hop (khong ai dong toi thanh nay) khong phai
// chiu cai gia do. Gan roi thi doi muc chi la gan mot con so, khong thay
// track nua.

// Kieu cua LiveKit nam sau mot duong dan sau trong goi (dist/src/room/track/
// processor/types) - import thang vao do la buoc chan vao ruot thu vien. Khai
// lai dung phan minh dung, va ep kieu o dung mot cho khi giao cho setProcessor.
type TuyChonAmThanh = { kind: Track.Kind.Audio; track: MediaStreamTrack; audioContext: AudioContext };

class BoKhuechDai {
  name = "mic-gain";
  processedTrack?: MediaStreamTrack;

  private muc = 1;
  private gain: GainNode | null = null;
  private nguon: MediaStreamAudioSourceNode | null = null;
  private dich: MediaStreamAudioDestinationNode | null = null;

  async init(opts: TuyChonAmThanh) {
    const ctx = opts.audioContext;
    const nguon = ctx.createMediaStreamSource(new MediaStream([opts.track]));
    const gain = ctx.createGain();
    gain.gain.value = this.muc;
    const dich = ctx.createMediaStreamDestination();
    nguon.connect(gain);
    gain.connect(dich);

    this.nguon = nguon;
    this.gain = gain;
    this.dich = dich;
    this.processedTrack = dich.stream.getAudioTracks()[0];
  }

  async restart(opts: TuyChonAmThanh) {
    await this.destroy();
    await this.init(opts);
  }

  async destroy() {
    this.nguon?.disconnect();
    this.gain?.disconnect();
    this.dich?.disconnect();
    this.nguon = null;
    this.gain = null;
    this.dich = null;
  }

  dat(muc: number) {
    this.muc = muc;
    // setTargetAtTime chu khong gan thang: nhay muc am luong mot phat nghe ra
    // tieng "bup", con day la mot cu chuyen muot trong 20ms.
    this.gain?.gain.setTargetAtTime(muc, this.gain.context.currentTime, 0.02);
  }
}

let bo: BoKhuechDai | null = null;
// Muc nguoi dung da keo TRUOC khi bat mic - khong the gan bo xu ly vao mot
// track chua ton tai, nen phai giu lai roi ap sau.
let mucCho: number | null = null;

function micCuaToi(room: Room): LocalAudioTrack | null {
  const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
  const track = pub?.track;
  return track && track.kind === Track.Kind.Audio ? (track as LocalAudioTrack) : null;
}

// Dat muc khuech dai. `muc` la he so: 1 = 100%, 5 = 500%.
export async function datAmLuongMic(room: Room, muc: number) {
  if (bo) {
    bo.dat(muc);
    return;
  }
  // Dung 100% thi khong dong gi ca - day la duong di cua phan lon phien hop.
  if (Math.abs(muc - 1) < 0.001) return;

  const track = micCuaToi(room);
  if (!track) {
    mucCho = muc;
    return;
  }

  const moi = new BoKhuechDai();
  moi.dat(muc);
  // Ep kieu o DUNG MOT CHO: BoKhuechDai co du name/init/restart/destroy/
  // processedTrack ma TrackProcessor doi, chi khac o cho khai kieu.
  await track.setProcessor(moi as unknown as Parameters<LocalAudioTrack["setProcessor"]>[0]);
  bo = moi;
  mucCho = null;
}

// Goi moi khi nguoi dung vua bat mic len - luc do track moi ton tai.
export async function apLaiAmLuongMic(room: Room) {
  if (mucCho === null) return;
  await datAmLuongMic(room, mucCho);
}

// Roi phong thi quen het - lan hop sau la mot Room khac, mot track khac.
export function quenAmLuongMic() {
  bo = null;
  mucCho = null;
}
