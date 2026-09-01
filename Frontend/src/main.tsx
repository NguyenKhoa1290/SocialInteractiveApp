import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DeviceGate } from './components/DeviceGate.tsx'

// DeviceGate boc NGOAI <App> chu khong nam trong no: tren dien thoai thi App
// khong duoc mount chut nao. Neu boc ben trong thi useEffect dau App van
// chay - lap lich lam moi token, doi lai khoa E2EE, goi
// recoverAbandonedUploads - cho mot phien ma nguoi dung khong the dung.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeviceGate>
      <App />
    </DeviceGate>
  </StrictMode>,
)
