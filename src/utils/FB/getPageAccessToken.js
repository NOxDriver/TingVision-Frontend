import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import useAuthStore from '../../stores/authStore';
import fetchWithRetry from './fetchWithRetry';



export const getPageAccessToken = async (userAccessToken, forceRefresh = false) => {
    if (!forceRefresh) {
        try {
            const cached = localStorage.getItem('page_access_tokens');
            if (cached) return JSON.parse(cached);
        } catch (_) { /* ignore */ }
    }

    let url = `https://graph.facebook.com/v22.0/me/accounts?fields=access_token,name,picture,id&access_token=${userAccessToken}`;
    const pageAccessTokens = {};
    let isFirst = true;

    while (url) {
        const data = await fetchWithRetry(url, { method: "GET" });

        for (let i = 0; i < (data.data || []).length; i++) {
            const page = data.data[i];
            const pageID = page.id;
            const accessToken = page.access_token;
            const { setSinglePageAccessToken } = useAuthStore.getState();
            setSinglePageAccessToken(page.id, accessToken);
            pageAccessTokens[pageID] = accessToken;

            if (isFirst) {
                localStorage.setItem('page_access_token', accessToken);
                isFirst = false;
            }
        }

        url = data.paging?.next || null;
    }

    localStorage.setItem('page_access_tokens', JSON.stringify(pageAccessTokens));
    return pageAccessTokens;
}


export const getPageAccessTokenFirestore = async (userId) => {

    let pageAccessToken = '';
    // For Review. Get page token from Firestore
    const snapShot = await getDoc(doc(db, "users", userId, "tokens", 'page_access_token'));
    pageAccessToken = snapShot.data();
    console.log('pageAccessToken', pageAccessToken.token);
    localStorage.setItem('page_access_token', pageAccessToken.token);
    return { pageAccessToken: pageAccessToken.token }
}