import { useState, type FormEvent } from "react";
import { Modal } from "../../components/Modal";
import { extractApiError } from "../../lib/apiError";

const MAX_MEETING_NAME_LENGTH = 120;

export function CreateMeetingDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await onCreate(name.trim());
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
        {error && <p className="meeting-create-error" role="alert">{error}</p>}
        <div className="meeting-create-actions">
          <button type="button" className="md-btn md-btn-ghost" onClick={close} disabled={creating}>
            Huỷ
          </button>
          <button type="submit" className="md-btn" disabled={creating}>
            {creating ? "Đang mở…" : "Khởi tạo"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
