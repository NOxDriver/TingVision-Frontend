import create from "zustand";

import {
    createUserWithEmailAndPassword,
    signOut, signInWithPopup, FacebookAuthProvider
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';



const defaultProfileState = {
    role: 'client',
    allowedLocations: [],
    profileStatus: 'idle',
    profileError: '',
};

const useAuthStore = create((set, get) => ({
    user: null,
    pageAccessTokens: {},
    setPageAccessTokens: (tokens) => set({ pageAccessTokens: tokens }),
    setSinglePageAccessToken: (pageId, token) =>
        set(state => ({
            pageAccessTokens: {
                ...state.pageAccessTokens,
                [pageId]: token,
            }
        })),

    role: defaultProfileState.role,
    allowedLocations: defaultProfileState.allowedLocations,
    profileStatus: defaultProfileState.profileStatus,
    profileError: defaultProfileState.profileError,

    setUser: (user) => set({ user }),
    setUserAccessToken: (token) => set({ userAccessToken: token }),
    setPageAccessToken: (token) => set({ pageAccessToken: token }),
    resetProfile: () => set({ ...defaultProfileState }),
    loadUserProfile: async (uid) => {
        if (!uid) {
            set({ ...defaultProfileState, profileStatus: 'idle' });
            return null;
        }

        const currentStatus = get().profileStatus;
        if (currentStatus === 'loading') {
            return null;
        }

        set({ profileStatus: 'loading', profileError: '' });

        try {
            const userRef = doc(db, 'users', uid);
            const snap = await getDoc(userRef);

            if (!snap.exists()) {
                set({
                    role: defaultProfileState.role,
                    allowedLocations: defaultProfileState.allowedLocations,
                    profileStatus: 'ready',
                    profileError: '',
                });
                return null;
            }

            const data = snap.data() || {};
            const role = typeof data.role === 'string' ? data.role : defaultProfileState.role;
            const locationPool = new Set();

            if (Array.isArray(data.locations)) {
                data.locations.forEach((loc) => {
                    if (typeof loc === 'string' && loc.trim()) {
                        locationPool.add(loc.trim());
                    }
                });
            }

            if (Array.isArray(data.locationIds)) {
                data.locationIds.forEach((loc) => {
                    if (typeof loc === 'string' && loc.trim()) {
                        locationPool.add(loc.trim());
                    }
                });
            }

            if (typeof data.locationId === 'string' && data.locationId.trim()) {
                locationPool.add(data.locationId.trim());
            }

            const allowedLocations = role === 'admin'
                ? []
                : Array.from(locationPool);

            set({
                role,
                allowedLocations,
                profileStatus: 'ready',
                profileError: '',
            });
            return { role, allowedLocations };
        } catch (error) {
            console.error('Failed to load user profile', error);
            set({
                ...defaultProfileState,
                profileStatus: 'error',
                profileError: error?.message || 'Failed to load profile',
            });
            return null;
        }
    },
    createUser: async (e, email, password) => {
        e.preventDefault();
        try {
            await createUserWithEmailAndPassword(auth, email, password);
            return true;
        } catch (err) {
            console.error(err.message);
            alert(err.message);
            return false;
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
            set({
                user: null,
                ...defaultProfileState,
                pageAccessTokens: {},
                userAccessToken: undefined,
                pageAccessToken: undefined,
            });
        } catch (e) { console.log(e.message); alert(e.message) }
    },
}));

export default useAuthStore;
