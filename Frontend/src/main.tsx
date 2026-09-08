import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// DeviceGate nam canh Routes (xem App.tsx) de bao khi khung hien thi qua nho
// hoac qua dai. Cac man, ke ca phong hop, duoc mount binh thuong tren dien
// thoai va tu chuyen sang bo cuc responsive.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
