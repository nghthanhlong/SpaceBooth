import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  getDocs,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app); 

const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

// Hàm 1: Upload 5 ảnh lên Cloudinary và lưu vào Firestore
export const createPhotoSession = async (filesArray) => {
  try {
    const sessionId = Date.now().toString();
    const uploadedUrls = [];

    for (let i = 0; i < filesArray.length; i++) {
      const formData = new FormData();
      formData.append("file", filesArray[i]);
      formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, 
        { method: "POST", body: formData }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Cloudinary Error:", errorData); 
        throw new Error(errorData.error?.message || "Lỗi upload ảnh lên Cloudinary");
      }

      const data = await response.json();
      uploadedUrls.push(data.secure_url); 
    }

    const docRef = await addDoc(collection(db, "sessions"), {
      sessionId: sessionId,
      allPhotos: uploadedUrls,
      selectedPhotos: [],
      finalPrintUrl: "",
      createdAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    return { success: true, sessionId: docRef.id, urls: uploadedUrls };
  } catch (error) {
    console.error("Lỗi tạo session:", error);
    return { success: false, error: error.message };
  }
};

// Hàm 2: Cập nhật 2-3 ảnh đã chọn 
export const updateSelectedPhotos = async (sessionDocId, selectedUrls) => {
  try {
    const docRef = doc(db, "sessions", sessionDocId); 
    await updateDoc(docRef, {
      selectedPhotos: selectedUrls
    });
    return { success: true };
  } catch (error) {
    console.error("Lỗi cập nhật ảnh đã chọn:", error);
    return { success: false, error: error.message };
  }
};

export const getPhotoSessions = async () => {
  const sessionsQuery = query(
    collection(db, "sessions"),
    orderBy("createdAt", "desc"),
    limit(20),
  );
  const snapshot = await getDocs(sessionsQuery);

  return snapshot.docs.map((sessionDoc) => ({
    id: sessionDoc.id,
    ...sessionDoc.data(),
  }));
};
