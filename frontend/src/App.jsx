import { useEffect } from "react";
import BoothPage from "./pages/BoothPage";
import { cleanExpiredSessions } from "./firebase"; 

export default function App() {
  useEffect(() => {
    // Tự động dọn dẹp các session hết hạn mỗi khi web được mở
    cleanExpiredSessions();
  }, []);

  return <BoothPage />;
}