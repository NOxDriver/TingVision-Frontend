import create from "zustand";

import {
    createUserWithEmailAndPassword,
    signOut, signInWithPopup, FacebookAuthProvider
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';



const defaultState = {
    user: null,
    profile: null,
    role: 'guest',
    locationIds: [],
    pageAccessTokens: {},
    isAccessLoading: false,
    accessError: '',
};

const normalizeLocationIds = (input) => {
    if (!Array.isArray(input)) {
        return [];
    }
    return input
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0);
};

const useAuthStore = create((set) => ({
    ...defaultState,
    pageAccessTokens: {},
    setPageAccessTokens: (tokens) => set({ pageAccessTokens: tokens }),
    setSinglePageAccessToken: (pageId, token) =>
        set(state => ({
            pageAccessTokens: {
                ...state.pageAccessTokens,
                [pageId]: token,
            }
        })),

    setUser: (user) => set({ user }),
    setUserAccessToken: (token) => set({ userAccessToken: token }),
    setPageAccessToken: (token) => set({ pageAccessToken: token }),
    clearAccess: () => set({
        profile: null,
        role: 'guest',
        locationIds: [],
        isAccessLoading: false,
        accessError: '',
    }),
    fetchUserAccess: async (user) => {
        const uid = typeof user === 'string' ? user : user?.uid;
        if (!uid) {
            set({
                profile: null,
                role: 'guest',
                locationIds: [],
                isAccessLoading: false,
                accessError: '',
            });
            return null;
        }

        set({ isAccessLoading: true, accessError: '' });
        try {
            const userRef = doc(db, 'users', uid);
            const snapshot = await getDoc(userRef);

            let data = {};
            if (!snapshot.exists()) {
                data = { role: 'client', locationIds: [] };
                await setDoc(userRef, {
                    ...data,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            } else {
                data = snapshot.data() || {};
            }

            const role = data.role === 'admin' ? 'admin' : 'client';
            const locationIds = role === 'admin'
                ? normalizeLocationIds(data.locationIds)
                : normalizeLocationIds(data.locationIds);

            const profile = {
                id: uid,
                ...data,
                role,
                locationIds,
            };

            set({
                profile,
                role,
                locationIds,
                isAccessLoading: false,
                accessError: '',
            });

            return profile;
        } catch (error) {
            console.error('Failed to load user access', error);
            set({
                profile: null,
                role: 'client',
                locationIds: [],
                isAccessLoading: false,
                accessError: error?.message || 'Unable to load access permissions',
            });
            return null;
        }
    },
    createUser: async (formData) => {
        const { email, password, firstName, lastName, phoneNumber, associatedLocation } = formData;
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const { user } = userCredential;

            const userData = {
                email,
                firstName,
                lastName,
                phoneNumber,
                fullName: `${firstName} ${lastName}`.trim(),
                role: 'client',
                locationIds: [],
                associatedLocation: 'locationRequested',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            };

            if (associatedLocation?.trim()) {
                userData.requestedLocationName = associatedLocation.trim();
            }

            await setDoc(doc(db, 'users', user.uid), userData, { merge: true });

            return { success: true };
        } catch (err) {
            console.error(err.message);
            return { success: false, error: err?.message || 'Unable to create account' };
        }
    },
    signInEmail: async (email, password) => {
        try {
            const { signInWithEmailAndPassword } = await import('firebase/auth');
            const res = await signInWithEmailAndPassword(auth, email, password);
            set({ user: res.user });
            return res;
        } catch (err) {
            console.error(err.message);
            alert(err.message);
            return null;
        }
    },

    signInWithFacebook: async () => {
        const provider = new FacebookAuthProvider();
        provider.addScope('pages_show_list');
        provider.addScope('pages_read_engagement');
        provider.addScope('pages_manage_engagement');
        provider.addScope('pages_read_user_content');
        provider.addScope('read_insights');
        provider.addScope('business_management');

        try {
            const response = await signInWithPopup(auth, provider);
            const credential = FacebookAuthProvider.credentialFromResult(response);
            const accessToken = credential.accessToken;

            localStorage.setItem('user_access_token', accessToken);
            return { success: true, response, accessToken };
        } catch (err) {
            console.error(err.message);
            alert(err.message);
            return { success: false };
        }
    },
    // signInWithFacebook:
    //     async (e) => {
    //         const provider = new FacebookAuthProvider();
    //         provider.addScope('pages_manage_engagement');
    //         provider.addScope('pages_read_engagement');
    //         provider.addScope('read_insights');
    //         provider.addScope('pages_show_list'); 
    //         provider.addScope('pages_read_user_content');
    //         provider.addScope('business_management');


    //         try {
    //             const responce = await signInWithPopup(auth, provider);
    //             const credential = FacebookAuthProvider.credentialFromResult(responce);
    //             console.log('credential', credential);
    //             const accessToken = credential.accessToken;
    //             localStorage.setItem('user_access_token', accessToken);
    //             return { success: true, responce, accessToken }
    //         }

    //         catch (e) {
    //             console.log(e.message);
    //             alert(e.message);
    //             return { success: false }
    //         }

    //     },
    logout: (e) => {
        try {
            signOut(auth);
            // remove all local storage items
            localStorage.clear();
            set({ ...defaultState, user: null });
        } catch (e) { console.log(e.message); alert(e.message) }
    },
}));

export default useAuthStore;
