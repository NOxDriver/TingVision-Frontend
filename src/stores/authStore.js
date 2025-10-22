import create from "zustand";

import {
    createUserWithEmailAndPassword,
    signOut, signInWithPopup, FacebookAuthProvider
} from 'firebase/auth';
import { auth } from '../firebase';



const useAuthStore = create((set) => ({
    user: {},
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
        } catch (e) { console.log(e.message); alert(e.message) }
    },
}));

export default useAuthStore;
