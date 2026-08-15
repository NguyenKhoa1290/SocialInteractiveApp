import { adminHttp } from "./httpClient";
import type {
  AdminUserDetail,
  ComplaintMessage,
  ComplaintSummary,
  PaginatedUsers,
  PaginatedViolations,
  SystemResources,
  TopupRequestInfo,
} from "../types/admin";

// Toan bo endpoint duoi day yeu cau JWT co claim role=admin (policy
// "AdminOnly" trong AdminService). Thieu claim thi tra 403 chu khong phai
// 401 - AdminRoute chan truoc o phia UI de nguoi thuong khong thay man hinh.
export const adminApi = {
  listUsers: (page: number, pageSize: number, search?: string) =>
    adminHttp.get<PaginatedUsers>("/admin/users", {
      params: { page, pageSize, ...(search ? { search } : {}) },
    }),

  getUser: (userId: number) => adminHttp.get<AdminUserDetail>(`/admin/users/${userId}`),

  unlockUser: (userId: number) => adminHttp.post(`/admin/users/${userId}/unlock`),

  // Tra 202: yeu cau xoa duoc day qua RabbitMQ, Identity Service xoa that
  // sau do - KHONG dong nghia tai khoan da bien mat ngay luc goi xong.
  // Tra 409 neu user con khieu nai chua xu ly (phai dong khieu nai truoc).
  deleteUser: (userId: number) => adminHttp.delete(`/admin/users/${userId}`),

  listViolations: (page: number, pageSize: number) =>
    adminHttp.get<PaginatedViolations>("/admin/spam-violations", { params: { page, pageSize } }),

  listComplaints: () => adminHttp.get<ComplaintSummary[]>("/admin/complaints"),

  // 404 = khieu nai da qua TTL 10 tieng trong Redis, khong phai loi he thong.
  getComplaintMessages: (userId: number) =>
    adminHttp.get<ComplaintMessage[]>(`/admin/complaints/${userId}`),

  replyComplaint: (userId: number, message: string) =>
    adminHttp.post<ComplaintMessage>(`/admin/complaints/${userId}/reply`, { message }),

  listTopupRequests: () => adminHttp.get<TopupRequestInfo[]>("/admin/storage-requests"),

  approveTopup: (requestId: number) => adminHttp.post(`/admin/storage-requests/${requestId}/approve`),

  rejectTopup: (requestId: number) => adminHttp.post(`/admin/storage-requests/${requestId}/reject`),

  // 503 neu Metrics Server chua duoc cai trong cluster.
  getResources: () => adminHttp.get<SystemResources>("/admin/system/resources"),

  // 403 neu Service Account cua Admin Service chua co quyen ghi
  // (patch deployments/scale) - xem Tainguyen/infra/adminservice-rbac.yaml.
  scaleService: (serviceName: string, replicas: number) =>
    adminHttp.post(`/admin/system/services/${serviceName}/scale`, { replicas }),
};
