// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDbSyxi-jz_vSj90bm-2LCzDt0uuMFS_Io",
  authDomain: "ting-vision.firebaseapp.com",
  projectId: "ting-vision",
  storageBucket: "ting-vision.firebasestorage.app",
  messagingSenderId: "186628423921",
  appId: "1:186628423921:web:2ae2a0d4c8afd34579e950",
  measurementId: "G-Y4J506RS0Z"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const functions = getFunctions(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app



