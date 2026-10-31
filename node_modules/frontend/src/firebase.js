import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBbz7f_sRlzw226_fUeQiA02DMYYFWc_mU",
  authDomain: "spacebooth-nhom10.firebaseapp.com",
  projectId: "spacebooth-nhom10",
  storageBucket: "spacebooth-nhom10.firebasestorage.app",
  messagingSenderId: "311282193601",
  appId: "1:311282193601:web:8d247920c29a5e7d213040",
  measurementId: "G-92EWN77FY8"
};

const app = initializeApp(firebaseConfig);

// Export db và storage để dùng ở các file khác
export const db = getFirestore(app);
export const storage = getStorage(app);