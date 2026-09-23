import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Khi deploy ban moi, tab dang mo co the van chay bundle cu va yeu cau mot
// dynamic chunk da bi image moi thay the. Vite phat su kien nay truoc khi
// nem loi import; nap lai trang se lay index.html moi va dung bo hash moi.
// Gioi han mot lan trong 30 giay de khong tao vong lap neu loi that su do
// mang, extension chan request, hoac server dang gian doan.
const preloadReloadKey = 'calli:vite-preload-reload-at'
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const lastReloadAt = Number(sessionStorage.getItem(preloadReloadKey) ?? 0)
  if (Date.now() - lastReloadAt < 30_000) return
  sessionStorage.setItem(preloadReloadKey, String(Date.now()))
  window.location.reload()
})

// DeviceGate nam canh Routes (xem App.tsx) de bao khi khung hien thi qua nho
// hoac qua dai. Cac man, ke ca phong hop, duoc mount binh thuong tren dien
// thoai va tu chuyen sang bo cuc responsive.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
