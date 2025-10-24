import create from "zustand";

import {
    createUserWithEmailAndPassword,
    signOut, signInWithPopup, FacebookAuthProvider,
    updateProfile
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
    createUser: async ({
        firstName = '',
        lastName = '',
        companyName = '',
        phoneNumber = '',
        email,
        password,
    }) => {
        try {
            const result = await createUserWithEmailAndPassword(auth, email, password);
            const { user } = result;

            const trimmedFirstName = firstName.trim();
            const trimmedLastName = lastName.trim();
            const fullName = [trimmedFirstName, trimmedLastName].filter(Boolean).join(' ');

            const profileDataRaw = {
                firstName: trimmedFirstName,
                lastName: trimmedLastName,
                fullName,
                companyName: companyName.trim(),
                phoneNumber: phoneNumber.trim(),
                email,
                role: 'client',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            };

            const profileData = Object.entries(profileDataRaw).reduce((acc, [key, value]) => {
                if (value !== '' && value !== null && value !== undefined) {
                    acc[key] = value;
                }
                return acc;
            }, {});

            if (fullName) {
                await updateProfile(user, { displayName: fullName });
            }

            const userRef = doc(db, 'users', user.uid);
            await setDoc(userRef, profileData, { merge: true });

            set({ user });

            return { success: true, user };
        } catch (err) {
            console.error(err.message);
            return { success: false, error: err.message };
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
