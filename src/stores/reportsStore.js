import create from 'zustand';

const initialProgress = { processed: 0, total: 0, retries: 0, text: '' };

const useReportsStore = create((set, get) => ({
  videos: [],
  loading: false,
  progress: initialProgress,
  abortController: null,
  resultsRef: [],
  progressRef: { ...initialProgress },
  setVideos: videos => set({ videos }),
  setLoading: loading => set({ loading }),
  setProgress: progress => set({ progress }),
  setAbortController: controller => set({ abortController: controller }),
  setResultsRef: results => set({ resultsRef: results }),
  setProgressRef: p => set({ progressRef: p }),
  reset: () => set({ videos: [], loading: false, progress: initialProgress, abortController: null, resultsRef: [], progressRef: { ...initialProgress } })
}));

export default useReportsStore;
