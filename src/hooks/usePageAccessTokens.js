import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';
import { functions, db } from '../firebase';
import useAuthStore from '../stores/authStore';
import { getPageAccessToken } from '../utils/FB/getPageAccessToken';

export default function usePageAccessTokens() {
  const user = useAuthStore(s => s.user);
  const tokens = useAuthStore(s => s.pageAccessTokens);
  const setTokens = useAuthStore(s => s.setPageAccessTokens);

  const [pages, setPages] = useState([]);
  const [collections, setCollections] = useState([]);
  const [pagesById, setPagesById] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const getPages = httpsCallable(functions, 'getPagesFromUser');
      const res = await getPages();
      setPages(res.data);
      setPagesById(Object.fromEntries(res.data.map(p => [p.id, p])));

      if (!Object.keys(tokens).length) {
        setTokens(await getPageAccessToken(localStorage.getItem('user_access_token')));
      }
      const snap = await getDocs(collection(db, 'users', user.uid, 'collections'));
      setCollections(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !loading && Object.keys(tokens).length > 0;

  return { pages, collections, pagesById, pageAccessTokens: tokens, ready };
}
