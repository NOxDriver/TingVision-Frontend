import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, query, getDocs, updateDoc, doc, orderBy } from 'firebase/firestore';
import { getStorage, ref, deleteObject } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Firebase configuration for ting-vision project
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || "ting-vision.firebaseapp.com",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || "ting-vision",
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "ting-vision.appspot.com",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "YOUR_SENDER_ID",
  appId: process.env.REACT_APP_FIREBASE_APP_ID || "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

// Auth functions
export const loginUser = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { user: userCredential.user, error: null };
  } catch (error) {
    return { user: null, error: error.message };
  }
};

export const logoutUser = async () => {
  try {
    await signOut(auth);
    return { error: null };
  } catch (error) {
    return { error: error.message };
  }
};

// Firestore functions
export const getSightings = async () => {
  try {
    const sightingsRef = collection(db, 'sightings');
    const q = query(sightingsRef, orderBy('timestamp', 'desc'));
    const querySnapshot = await getDocs(q);
    
    const sightings = [];
    querySnapshot.forEach((doc) => {
      sightings.push({ id: doc.id, ...doc.data() });
    });
    
    return { sightings, error: null };
  } catch (error) {
    const isAbortError =
      error?.name === 'AbortError' ||
      error?.code === 'aborted' ||
      error?.code === 'cancelled' ||
      (typeof error?.message === 'string' && error.message.toLowerCase().includes('aborted'));

    if (isAbortError) {
      return { sightings: [], error: null };
    }

    console.error('Error getting sightings:', error);
    return { sightings: [], error: error.message };
  }
};

export const updateSightingSpecies = async (sightingId, newSpecies, oldSpecies, mediaUrl) => {
  try {
    // Update Firestore document
    const sightingRef = doc(db, 'sightings', sightingId);
    await updateDoc(sightingRef, {
      species: newSpecies,
      corrected: true,
      correctedAt: new Date().toISOString()
    });

    // Call Cloud Function to move/rename assets in GCS
    const moveAsset = httpsCallable(functions, 'moveAssetOnSpeciesCorrection');
    await moveAsset({
      sightingId,
      oldSpecies,
      newSpecies,
      mediaUrl
    });

    return { error: null };
  } catch (error) {
    console.error('Error updating species:', error);
    return { error: error.message };
  }
};

// Facebook integration
export const connectFacebookAccount = async () => {
  // This will be implemented with Facebook OAuth
  // For now, return a placeholder
  return { connected: false, error: 'Facebook integration pending' };
};

export const postToFacebookPage = async (sighting) => {
  try {
    const postToFB = httpsCallable(functions, 'postSightingToFacebook');
    const result = await postToFB(sighting);
    return { result: result.data, error: null };
  } catch (error) {
    console.error('Error posting to Facebook:', error);
    return { result: null, error: error.message };
  }
};

export default app;
