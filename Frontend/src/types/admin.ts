// Khop voi AdminService.Api/Endpoints/AdminDtos.cs va cac record trong
// Services/*.cs. Doi ben nao thi phai doi ben kia.

export type AdminUserStatus = "active" | "locked";

export interface AdminUserInfo {
  id: number;
  userType: "guest" | "registered";
  nickname: string;
  displayName: string;
  email: string | null;
  status: AdminUserStatus;
  isAdmin: boolean;
  createdAt: string;
  lastActiveAt: string;
  // Chi Guest co moc nay: GuestCleanupService xoa o luot quet 24h dau tien
  // sau thoi diem nay neu khong phat sinh hoat dong moi.
  guestExpiresAt: string | null;
}

export interface SpamViolation {
  userId: number;
  nickname: string;
  detectedAt: string;
  reason: string;
  accountStatus: string;
}

// Chi tiet 1 user = thong tin co ban + toan bo vi pham cua ho.
// LUU Y: khac AdminUserInfo o cho KHONG co truong isAdmin.
export interface AdminUserDetail {
  id: number;
  userType: "guest" | "registered";
  nickname: string;
  displayName: string;
  email: string | null;
  status: AdminUserStatus;
  createdAt: string;
  lastActiveAt: string;
  guestExpiresAt: string | null;
  violations: SpamViolation[];
}

export interface PaginatedUsers {
  items: AdminUserInfo[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PaginatedViolations {
  items: SpamViolation[];
  total: number;
}

export interface ComplaintSummary {
  userId: number;
  lastMessageAt: string;
  expiresAt: string;
}

export interface ComplaintMessage {
  senderRole: string;
  message: string;
  createdAt: string;
  senderId: number | null;
}

export interface TopupRequestInfo {
  id: number;
  conversationId: number;
  requestedBy: number;
  amount: number;
  status: string;
  createdAt: string;
}

// cpuUsage/memoryUsage la CHUOI theo don vi cua K8s ("6455n", "26484Ki") -
// khong phai so. Xem lib/k8sUnits.ts de doi sang don vi doc duoc.
export interface PodResource {
  name: string;
  cpuUsage: string;
  memoryUsage: string;
}

export interface NodeResource {
  name: string;
  cpuUsage: string;
  memoryUsage: string;
}

export interface SystemResources {
  pods: PodResource[];
  nodes: NodeResource[];
}
