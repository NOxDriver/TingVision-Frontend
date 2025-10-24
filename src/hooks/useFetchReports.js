import { useRef, useMemo } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import moment from 'moment';
import * as XLSX from 'sheetjs-style';
import { db } from '../firebase';
import { chunk, sleep } from '../utils/reports/helpers';
import { trackButton } from '../utils/analytics';
import useReportsStore from '../stores/reportsStore';

const GRAPH_VERSION = 'v22.0';
const IDS_PER_CALL = 40;
const PAGE_PARALLEL = 15;
const MAX_RETRIES = 0;
const BASE_RETRY_DELAY = 1500;
const DISPLAY_LIMIT = 5000;

export default function useFetchReports(pageAccessTokens, enabledMetrics) {
  const loading = useReportsStore(s => s.loading);
  const videos = useReportsStore(s => s.videos);
  const progress = useReportsStore(s => s.progress);
  const setLoading = useReportsStore(s => s.setLoading);
  const setVideos = useReportsStore(s => s.setVideos);
  const setProgress = useReportsStore(s => s.setProgress);
  const abortController = useReportsStore(s => s.abortController);
  const setAbortController = useReportsStore(s => s.setAbortController);
  const resultsRef = useRef(useReportsStore.getState().resultsRef);
  const progressRef = useRef(useReportsStore.getState().progressRef);
  const setResultsRef = useReportsStore(s => s.setResultsRef);
  const setProgressRef = useReportsStore(s => s.setProgressRef);
  const missingMetricsRef = useRef({});

  const checkMetricPermissions = async sample => {
    const token = pageAccessTokens[sample.pageId];
    if (!token) return {};
    const baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}`;
    const metrics = Object.keys(enabledMetrics).filter(m => enabledMetrics[m]);
    const missing = {};
    await Promise.all(metrics.map(async metric => {
      let url = '';
      if (metric === 'comments') {
        url = `${baseUrl}/${sample.id}?fields=comments.limit(0).summary(true)&access_token=${token}`;
      } else {
        url = `${baseUrl}/${sample.id}/insights?metric=${metric}&access_token=${token}`;
      }
      try {
        const res = await fetch(url, { signal: abortController?.signal });
        const json = await res.json();
        if (!res.ok || json.error) missing[metric] = true;
      } catch (e) {
        missing[metric] = true;
      }
    }));
    missingMetricsRef.current = missing;
    return missing;
  };

  const fetchChunk = async ({ ids, token, since, until, attempt = 1 }) => {
    const allow = m => enabledMetrics[m] && !missingMetricsRef.current[m];

    const rangeMetrics = [
      'monetization_approximate_earnings',
      ...(allow('post_video_views') ? ['post_video_views'] : []),
      ...(allow('post_video_views_60s_excludes_shorter') ? ['post_video_views_60s_excludes_shorter'] : []),
      ...(allow('post_video_avg_time_watched') ? ['post_video_avg_time_watched'] : []),
      ...(allow('post_video_length') ? ['post_video_length'] : [])
    ];

    const lifetimeMetrics = [
      'monetization_approximate_earnings',
      ...(allow('post_video_views') ? ['post_video_views'] : []),
      ...(allow('post_video_views_60s_excludes_shorter') ? ['post_video_views_60s_excludes_shorter'] : []),
      ...(allow('post_video_avg_time_watched') ? ['post_video_avg_time_watched'] : []),
      ...(allow('post_impressions_unique') ? ['post_impressions_unique'] : []),
      ...(allow('post_reactions_like_total') ? ['post_reactions_like_total'] : [])
    ];

    const baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/`;
    const commonParams = { access_token: token, ids: ids.join(',') };
    const query1 = new URLSearchParams({
      ...commonParams,
      fields: `insights.metric(${rangeMetrics.join(',')}).period(total_over_range).since(${since}).until(${until})`
    }).toString();

    const lifetimeParts = [];
    if (lifetimeMetrics.length) {
      lifetimeParts.push(`insights.metric(${lifetimeMetrics.join(',')}).period(lifetime)`);
    }
    if (allow('comments')) lifetimeParts.push('comments.limit(0).summary(true)');

    const query2 = new URLSearchParams({
      ...commonParams,
      fields: lifetimeParts.join(',')
    }).toString();

    try {
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}?${query1}`, { signal: abortController?.signal }),
        fetch(`${baseUrl}?${query2}`, { signal: abortController?.signal })
      ]);
      const [json1, json2] = await Promise.all([res1.json().catch(() => ({})), res2.json().catch(() => ({}))]);

      if (!res1.ok || json1.error) throw new Error(json1?.error?.message || `HTTP ${res1.status}`);
      if (!res2.ok || json2.error) throw new Error(json2?.error?.message || `HTTP ${res2.status}`);

      const merged = {};
      for (const id of ids) {
        const errMsg = json1?.[id]?.error?.message || json2?.[id]?.error?.message;
        if (errMsg) {
          merged[id] = { error: errMsg };
          continue;
        }
        merged[id] = {
          insights: { data: [...(json1?.[id]?.insights?.data || []), ...(json2?.[id]?.insights?.data || [])] },
          comments: json2?.[id]?.comments || {}
        };
      }
      return merged;
    } catch (err) {
      if (attempt >= MAX_RETRIES || abortController?.signal?.aborted) throw err;
      progressRef.current.retries += 1;
      setProgressRef({ ...progressRef.current });
      setProgress({ ...progressRef.current });
      const delay = BASE_RETRY_DELAY * 2 ** (attempt - 1);
      await sleep(delay);
      return fetchChunk({ ids, token, since, until, attempt: attempt + 1 });
    }
  };

  const safeFetchChunk = async params => {
    try {
      return await fetchChunk(params);
    } catch (err) {
      const mentioned = params.ids.filter(id => err.message?.includes(id));
      if (mentioned.length) {
        const mapped = Object.fromEntries(mentioned.map(id => [id, { error: err.message }]));
        const remaining = params.ids.filter(id => !mentioned.includes(id));
        if (!remaining.length) return mapped;
        const rest = await safeFetchChunk({ ...params, ids: remaining });
        return { ...mapped, ...rest };
      }
      if (params.ids.length === 1) return { [params.ids[0]]: { error: err.message } };
      const mid = Math.ceil(params.ids.length / 2);
      const left = await safeFetchChunk({ ...params, ids: params.ids.slice(0, mid) });
      const right = await safeFetchChunk({ ...params, ids: params.ids.slice(mid) });
      return { ...left, ...right };
    }
  };

  const runWithRows = async (rows, since, until) => {
    const byPage = rows.reduce((acc, r) => { (acc[r.pageId] ??= []).push(r); return acc; }, {});
    const totalChunks = Object.values(byPage).reduce((sum, arr) => sum + Math.ceil(arr.length / IDS_PER_CALL), 0);
    progressRef.current.total = totalChunks;
    progressRef.current.text = 'Processing…';
    setProgressRef({ ...progressRef.current });
    setProgress({ ...progressRef.current });

    const results = [];
    const tasks = [];
    for (const [pageId, items] of Object.entries(byPage)) {
      const token = pageAccessTokens[pageId];
      if (!token) continue;
      const chunks = chunk(items, IDS_PER_CALL).map(ch => ch.map(i => i.id));
      chunks.forEach(ids => tasks.push({ pageId, ids, token }));
    }

    let cursor = 0;
    const workers = Array.from({ length: PAGE_PARALLEL }, async function worker() {
      while (!abortController?.signal?.aborted) {
        const idx = cursor++;
        if (idx >= tasks.length) break;
        const { pageId, ids, token } = tasks[idx];
        const res = await safeFetchChunk({ ids, token, since, until });
        results.push({ pageId, res });
        progressRef.current.processed += 1;
        setProgressRef({ ...progressRef.current });
        setProgress({ ...progressRef.current });
      }
    });
    await Promise.all(workers);

    const out = [];
    results.forEach(({ pageId, res }) => {
      Object.entries(res).forEach(([id, body]) => {
        const meta = rows.find(r => r.id === id) || {};
        if (body?.error) {
          out.push({ ...meta, error: body.error });
        } else {
          let earnings = 0;
          let earningsLifetime = null;
          let threeSecondViews = null;
          let threeSecondViewsLifetime = null;
          let oneMinuteViews = null;
          let oneMinuteViewsLifetime = null;
          let avgViewDuration = null;
          let avgViewDurationLifetime = null;
          let videoDuration = null;
          let reach = null;
          let likes = null;
          let comments = null;

          if (Array.isArray(body?.insights?.data)) {
            for (const metric of body.insights.data) {
              if (metric.name === 'monetization_approximate_earnings') {
                if (metric.period === 'lifetime') earningsLifetime = metric?.values?.[0]?.value ?? null;
                else earnings = metric?.values?.[0]?.value ?? 0;
              } else if (
                metric.name === 'post_video_views' &&
                enabledMetrics['post_video_views'] &&
                !missingMetricsRef.current['post_video_views']
              ) {
                if (metric.period === 'lifetime') threeSecondViewsLifetime = metric?.values?.[0]?.value ?? null;
                else threeSecondViews = metric?.values?.[0]?.value ?? null;
              } else if (
                metric.name === 'post_video_views_60s_excludes_shorter' &&
                enabledMetrics['post_video_views_60s_excludes_shorter'] &&
                !missingMetricsRef.current['post_video_views_60s_excludes_shorter']
              ) {
                if (metric.period === 'lifetime') oneMinuteViewsLifetime = metric?.values?.[0]?.value ?? null;
                else oneMinuteViews = metric?.values?.[0]?.value ?? null;
              } else if (
                metric.name === 'post_video_avg_time_watched' &&
                enabledMetrics['post_video_avg_time_watched'] &&
                !missingMetricsRef.current['post_video_avg_time_watched']
              ) {
                if (metric.period === 'lifetime') avgViewDurationLifetime = metric?.values?.[0]?.value ?? null;
                else avgViewDuration = metric?.values?.[0]?.value ?? null;
              } else if (
                metric.name === 'post_impressions_unique' &&
                enabledMetrics['post_impressions_unique'] &&
                !missingMetricsRef.current['post_impressions_unique']
              ) {
                reach = metric?.values?.[0]?.value ?? null;
              } else if (
                metric.name === 'post_reactions_like_total' &&
                enabledMetrics['post_reactions_like_total'] &&
                !missingMetricsRef.current['post_reactions_like_total']
              ) {
                likes = metric?.values?.[0]?.value ?? null;
              }
            }
          }
          if (enabledMetrics['comments'] && !missingMetricsRef.current['comments']) {
            comments = body?.comments?.summary?.total_count ?? null;
          }
          if (meta.videoLength != null) videoDuration = meta.videoLength * 1000;
          out.push({
            ...meta,
            earnings,
            earningsLifetime: earningsLifetime,
            threeSecondViews: missingMetricsRef.current['post_video_views'] ? 'Permission needed' : threeSecondViews,
            threeSecondViewsLifetime: missingMetricsRef.current['post_video_views'] ? 'Permission needed' : threeSecondViewsLifetime,
            oneMinuteViews: missingMetricsRef.current['post_video_views_60s_excludes_shorter'] ? 'Permission needed' : oneMinuteViews,
            oneMinuteViewsLifetime: missingMetricsRef.current['post_video_views_60s_excludes_shorter'] ? 'Permission needed' : oneMinuteViewsLifetime,
            avgViewDuration: missingMetricsRef.current['post_video_avg_time_watched'] ? 'Permission needed' : avgViewDuration,
            avgViewDurationLifetime: missingMetricsRef.current['post_video_avg_time_watched'] ? 'Permission needed' : avgViewDurationLifetime,
            videoDuration,
            reach: missingMetricsRef.current['post_impressions_unique'] ? 'Permission needed' : reach,
            likes: missingMetricsRef.current['post_reactions_like_total'] ? 'Permission needed' : likes,
            comments: missingMetricsRef.current['comments'] ? 'Permission needed' : comments,
            customLabels: meta.customLabels || []
          });
        }
      });
    });

    resultsRef.current = out;
    setResultsRef(out);
    if (out.length > DISPLAY_LIMIT) {
      setVideos(out.slice(0, DISPLAY_LIMIT));
      progressRef.current.text = `✅ Done! Showing first ${DISPLAY_LIMIT} of ${out.length} results.`;
      window.alert(`Report contains ${out.length} posts. Showing first ${DISPLAY_LIMIT}. Please export to download full report.`);
    } else {
      setVideos(out);
      progressRef.current.text = '✅ Done!';
    }
    setProgressRef({ ...progressRef.current });
    setProgress({ ...progressRef.current });
  };

  const run = async ({ startDate, endDate, selectedPage, user }) => {
    if (!startDate || !endDate) return;
    trackButton('reports_generate');

    abortController?.abort?.();
    const controller = new AbortController();
    setAbortController(controller);
    setLoading(true);
    setVideos([]);
    resultsRef.current = [];
    setResultsRef([]);
    progressRef.current = { processed: 0, total: 0, retries: 0, text: '' };
    setProgressRef({ ...progressRef.current });
    setProgress({ ...progressRef.current });
    try {
      const start = moment.utc(startDate, 'YYYY-MM-DD').set({ hour: 7, minute: 0, second: 0, millisecond: 0 });
      const end = moment.utc(endDate, 'YYYY-MM-DD').add(1, 'day').set({ hour: 7, minute: 0, second: 0, millisecond: 0 });
      const since = start.unix();
      const until = end.unix();

      let contentQuery;
      if (selectedPage === 'all') {
        contentQuery = query(collection(db, 'users', user.uid, 'content'));
      } else if (selectedPage.startsWith('collection:')) {
        const colId = selectedPage.replace('collection:', '');
        const pagesSnap = await getDocs(collection(db, 'users', user.uid, 'collections', colId, 'pages'));
        const ids = pagesSnap.docs.map(d => d.id);
        if (ids.length <= 10) {
          contentQuery = query(collection(db, 'users', user.uid, 'content'), where('pageId', 'in', ids));
        } else {
          const allContent = await getDocs(collection(db, 'users', user.uid, 'content'));
          const rows = allContent.docs.filter(doc => ids.includes(doc.data().pageId)).map(d => ({ id: d.id, ...d.data() }));
          if (!rows.length) {
            window.alert('No posts found for these filters.');
            progressRef.current.text = '❌ No content found for these filters.';
            setProgressRef({ ...progressRef.current });
            setProgress({ ...progressRef.current });
            return;
          }
          await runWithRows(rows, since, until);
          return;
        }
      } else {
        contentQuery = query(collection(db, 'users', user.uid, 'content'), where('pageId', '==', selectedPage));
      }

      const snap = await getDocs(contentQuery);
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!rows.length) {
        window.alert('No posts found for these filters.');
        progressRef.current.text = '❌ No content found for these filters.';
        setProgressRef({ ...progressRef.current });
        setProgress({ ...progressRef.current });
        return;
      }
      await checkMetricPermissions(rows[0]);
      await runWithRows(rows, since, until);
    } catch (err) {
      if (abortController?.signal?.aborted) return;
      progressRef.current.text = `❌ ${err.message}`;
      setProgressRef({ ...progressRef.current });
      setProgress({ ...progressRef.current });
    } finally {
      setLoading(false);
      setAbortController(null);
    }
  };

  const cancel = () => abortController?.abort?.();

  const totals = useMemo(() => {
    const all = resultsRef.current || [];
    const withEarnings = all.filter(v => v.earnings > 0);
    const summary = withEarnings.reduce((acc, v) => {
      const type = (v.contentType || '').toLowerCase();
      if (type.includes('reel')) acc.reels += v.earnings;
      else if (type.includes('photo')) acc.photos += v.earnings;
      else if (type.includes('video')) acc.videos += v.earnings;
      const bonusVal = v.bonusAmount ?? v.bonus ?? 0;
      acc.bonus += bonusVal;
      return acc;
    }, { videos: 0, photos: 0, reels: 0, bonus: 0 });
    return {
      posts: all.length,
      earnings: withEarnings.reduce((s, v) => s + v.earnings, 0),
      withEarnings: withEarnings.length,
      ...summary,
    };
  }, [videos]);

  const exportCSV = ({ pagesById, startDate, endDate, includeExtras, exportType }) => {
    trackButton('reports_export_csv', { exportType });

    const byType = v => {
      const type = (v.contentType || '').toLowerCase();
      if (exportType === 'all') return true;
      if (exportType === 'video') return type.includes('video');
      if (exportType === 'photo') return type.includes('photo');
      if (exportType === 'reel') return type.includes('reel');
      return false;
    };
    const data = resultsRef.current || [];
    const filtered = data.filter(byType);
    if (!filtered.length || filtered.length === 1) {
      const label = exportType === 'all' ? 'content' : exportType.charAt(0).toUpperCase() + exportType.slice(1) + 's';
      window.alert(`No ${label} found to export`);
      return;
    }

    const successes = data.filter(v => typeof v.earnings === 'number' && !isNaN(v.earnings) && v.earnings > 0 && byType(v));
    const failures = data.filter(v => v.error && byType(v));
    const wb = XLSX.utils.book_new();
    if (successes.length) {
      const baseMap = v => ({
        Title: v.postTitle,
        'Post ID': v.id,
        Published: moment(v.publishedAt?.seconds * 1000).format('YYYY-MM-DD'),
        Earnings_$: v.earnings,
        'Earnings Lifetime_$': v.earningsLifetime ?? '',
        Page: pagesById[v.pageId]?.name || v.pageId,
        Type: v.contentType,
        Link: v.postLink,
        ...(includeExtras && {
          'Video Duration (s)': v.videoDuration != null ? (v.videoDuration / 1000).toFixed(2) : '',
          ...(enabledMetrics['post_video_views'] && { '3s Views': v.threeSecondViews ?? '' }),
          ...(enabledMetrics['post_video_views'] && { '3s Views Lifetime': v.threeSecondViewsLifetime ?? '' }),
          ...(enabledMetrics['post_video_views_60s_excludes_shorter'] && { '1m Views': v.oneMinuteViews ?? '' }),
          ...(enabledMetrics['post_video_views_60s_excludes_shorter'] && { '1m Views Lifetime': v.oneMinuteViewsLifetime ?? '' }),
          ...(enabledMetrics['post_video_avg_time_watched'] && { 'Avg View Duration (s)': v.avgViewDuration != null ? (v.avgViewDuration / 1000).toFixed(2) : '' }),
          ...(enabledMetrics['post_video_avg_time_watched'] && { 'Avg View Duration Lifetime (s)': v.avgViewDurationLifetime != null ? (v.avgViewDurationLifetime / 1000).toFixed(2) : '' }),
          ...(enabledMetrics['post_impressions_unique'] && { Reach: v.reach ?? '' }),
          ...(enabledMetrics['post_reactions_like_total'] && { Likes: v.likes ?? '' }),
          ...(enabledMetrics['comments'] && { Comments: v.comments ?? '' }),
          ...(enabledMetrics['post_video_views'] && { RPM: v.earnings > 0 && v.threeSecondViews ? ((v.earnings / v.threeSecondViews) * 1000).toFixed(2) : '' }),
          'Custom Labels': (v.customLabels || []).join(', ')
        })
      });
      const wsSuccess = XLSX.utils.json_to_sheet(successes.map(baseMap).sort((a, b) => b.Earnings_$ - a.Earnings_$));
      XLSX.utils.book_append_sheet(wb, wsSuccess, 'Earnings');
    }
    if (failures.length) {
      const wsErrors = XLSX.utils.json_to_sheet(failures.map(v => ({
        Title: v.postTitle,
        'Post ID': v.id,
        Published: v.publishedAt ? moment(v.publishedAt?.seconds * 1000).format('YYYY-MM-DD') : '',
        Error: v.error,
        Page: pagesById[v.pageId]?.name || v.pageId,
        Type: v.contentType,
        Link: v.postLink,
      })));
      XLSX.utils.book_append_sheet(wb, wsErrors, 'Errors');
    }
    const label = `${startDate}_to_${endDate}`;
    XLSX.writeFile(wb, `Earnings-${label}.xlsx`);
  };

  return { videos, loading, progress, totals, run, cancel, exportCSV };
}
