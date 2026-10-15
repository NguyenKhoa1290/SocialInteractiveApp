import { useEffect, useState, type FormEvent } from "react";
import { meetingApi, type MeetingServerId, type MeetingServerOption } from "../../api/mediaApi";
import { Modal } from "../../components/Modal";
import { extractApiError } from "../../lib/apiError";

const MAX_MEETING_NAME_LENGTH = 120;

export function CreateMeetingDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, server: MeetingServerId) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [servers, setServers] = useState<MeetingServerOption[] | null>(null);
  const [server, setServer] = useState<MeetingServerId>("home");
  const [loadingServers, setLoadingServers] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingServers(true);
    setServerError(null);
    void meetingApi.servers().then(({ data }) => {
      if (!cancelled) setServers(data);
    }).catch((err: unknown) => {
      if (!cancelled) setServerError(extractApiError(err, "Không kiểm tra được server cuộc họp"));
    }).finally(() => {
      if (!cancelled) setLoadingServers(false);
    });
    return () => { cancelled = true; };
  }, [retry]);

  const home = servers?.find((option) => option.id === "home");
  const canCreate = !loadingServers && !serverError && home?.available === true && server === "home";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate || creating) return;
    setCreating(true);
    setError(null);
    try {
      await onCreate(name.trim(), server);
    } catch (err) {
      setError(extractApiError(err, "Không mở được cuộc họp"));
      setCreating(false);
    }
  }

  const close = () => {
    if (!creating) onClose();
  };

  return (
    <Modal title="Khởi tạo cuộc họp" onClose={close} width={590} closeOnEscape={!creating}>
      <form className="meeting-create-form" onSubmit={submit}>
        <label htmlFor="meeting-create-name">Tên cuộc họp</label>
        <input
          id="meeting-create-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_MEETING_NAME_LENGTH}
          placeholder="Ví dụ: Họp kế hoạch tháng 9"
          autoFocus
          disabled={creating}
        />
        <p className="md-note">Có thể để trống; hệ thống sẽ đặt tên theo số cuộc họp.</p>
        <fieldset className="meeting-server-options" disabled={creating}>
          <legend>Server cuộc họp</legend>
          <label className="meeting-server-option" aria-disabled="true">
            <input type="radio" name="meeting-server" value="public" disabled checked={false} />
            <span><strong>Server công khai</strong><small>Đã khóa — VPS đã hết hạn</small></span>
          </label>
          <label className="meeting-server-option" aria-disabled={!canCreate}>
            <input
              type="radio" name="meeting-server" value="home"
              checked={server === "home"} disabled={!canCreate}
              onChange={() => setServer("home")}
              aria-describedby="meeting-home-status"
            />
            <span><strong>Server nhà</strong><small id="meeting-home-status">
              {loadingServers ? "Đang kiểm tra…" : serverError ? "Chưa kiểm tra được trạng thái" : home?.available ? "Sẵn sàng" : home?.reason ?? "Server nhà chưa sẵn sàng"}
            </small></span>
          </label>
        </fieldset>
        {serverError && <p className="meeting-create-error" role="alert">{serverError}</p>}
        {!loadingServers && (serverError || !home?.available) && (
          <button type="button" className="md-btn md-btn-ghost" disabled={creating} onClick={() => setRetry((value) => value + 1)}>
            Kiểm tra lại server
          </button>
        )}
        {error && <p className="meeting-create-error" role="alert">{error}</p>}
        <div className="meeting-create-actions">
          <button type="button" className="md-btn md-btn-ghost" onClick={close} disabled={creating}>
            Huỷ
          </button>
          <button type="submit" className="md-btn" disabled={creating || !canCreate}>
            {creating ? "Đang mở…" : "Khởi tạo"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
