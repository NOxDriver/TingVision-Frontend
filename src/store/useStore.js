import { create } from 'zustand';
import { getSightings, updateSightingSpecies, postToFacebookPage } from '../services/firebase';

const useStore = create((set, get) => ({
  // Auth state
  user: null,
  isAuthenticated: false,
  facebookConnected: false,
  authChecked: false,

  setUser: (user) => set({ user, isAuthenticated: !!user, authChecked: true }),

  setFacebookConnected: (connected) => set({ facebookConnected: connected }),

  logout: () => set({ user: null, isAuthenticated: false, facebookConnected: false, authChecked: true }),

  // Sightings state
  sightings: [],
  loading: false,
  error: null,
  
  fetchSightings: async () => {
    set({ loading: true, error: null });

    try {
      const { sightings, error } = await getSightings();
      set({ sightings, loading: false, error });
    } catch (error) {
      if (error?.name === 'AbortError') {
        set({ loading: false });
        return;
      }

      set({ sightings: [], loading: false, error: error?.message || 'Failed to fetch sightings' });
    }
  },
  
  // Group sightings by species
  getSightingsBySpecies: () => {
    const { sightings } = get();
    const grouped = {};
    
    sightings.forEach(sighting => {
      const species = sighting.species || 'Unknown';
      if (!grouped[species]) {
        grouped[species] = [];
      }
      grouped[species].push(sighting);
    });
    
    return grouped;
  },
  
  // Update species correction
  correctSpecies: async (sightingId, newSpecies) => {
    set({ loading: true, error: null });
    
    const { sightings } = get();
    const sighting = sightings.find(s => s.id === sightingId);
    
    if (!sighting) {
      set({ loading: false, error: 'Sighting not found' });
      return { success: false };
    }
    
    const { error } = await updateSightingSpecies(
      sightingId,
      newSpecies,
      sighting.species,
      sighting.mediaUrl
    );
    
    if (error) {
      set({ loading: false, error });
      return { success: false, error };
    }
    
    // Update local state
    const updatedSightings = sightings.map(s =>
      s.id === sightingId
        ? { ...s, species: newSpecies, corrected: true }
        : s
    );
    
    set({ sightings: updatedSightings, loading: false });
    return { success: true };
  },
  
  // Post to Facebook
  postSightingToFacebook: async (sightingId) => {
    const { sightings } = get();
    const sighting = sightings.find(s => s.id === sightingId);
    
    if (!sighting) {
      return { success: false, error: 'Sighting not found' };
    }
    
    const { result, error } = await postToFacebookPage(sighting);
    
    if (error) {
      return { success: false, error };
    }
    
    return { success: true, result };
  },
  
  // Live stream state
  streamUrl: null,
  setStreamUrl: (url) => set({ streamUrl: url }),
}));

export default useStore;
