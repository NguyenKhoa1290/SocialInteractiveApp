import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// DeviceGate nam canh Routes (xem App.tsx), vi chi phong hop tam thoi chua
// co giao dien dien thoai. Cac man app con lai duoc mount binh thuong tren
// man hep de dung bo cuc responsive.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
