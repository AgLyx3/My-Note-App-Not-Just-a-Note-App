import { create } from "zustand";
import type { SuggestionOption, SuggestionsResponse } from "../types/api";

interface CaptureState {
  textDraft: string;
  imagePath?: string;
  entryId?: string;
  activeCollectionName?: string;
  activeCollectionId?: string;
  lastPlacementId?: string;
  homeBanner?: string;
  suggestions?: SuggestionsResponse;
  selected?: SuggestionOption;
  setTextDraft: (text: string) => void;
  setImagePath: (path?: string) => void;
  setEntryId: (entryId?: string) => void;
  setActiveCollectionName: (name?: string) => void;
  setActiveCollectionId: (id?: string) => void;
  setLastPlacementId: (placementId?: string) => void;
  setHomeBanner: (message?: string) => void;
  setSuggestions: (s: SuggestionsResponse) => void;
  setSelected: (option: SuggestionOption) => void;
  clearSuggestions: () => void;
  prepareNewCapture: () => void;
  resetFlow: () => void;
}

export const useCaptureStore = create<CaptureState>((set) => ({
  textDraft: "",
  imagePath: undefined,
  entryId: undefined,
  activeCollectionName: undefined,
  activeCollectionId: undefined,
  lastPlacementId: undefined,
  homeBanner: undefined,
  suggestions: undefined,
  selected: undefined,
  setTextDraft: (textDraft) => set({ textDraft }),
  setImagePath: (imagePath) => set({ imagePath }),
  setEntryId: (entryId) => set({ entryId }),
  setActiveCollectionName: (activeCollectionName) => set({ activeCollectionName }),
  setActiveCollectionId: (activeCollectionId) => set({ activeCollectionId }),
  setLastPlacementId: (lastPlacementId) => set({ lastPlacementId }),
  setHomeBanner: (homeBanner) => set({ homeBanner }),
  setSuggestions: (suggestions) => set({ suggestions, selected: suggestions.top_option }),
  setSelected: (selected) => set({ selected }),
  clearSuggestions: () => set({ suggestions: undefined, selected: undefined }),
  prepareNewCapture: () =>
    set({
      textDraft: "",
      imagePath: undefined,
      entryId: undefined,
      suggestions: undefined,
      selected: undefined
    }),
  resetFlow: () =>
    set({
      textDraft: "",
      imagePath: undefined,
      entryId: undefined,
      activeCollectionName: undefined,
      activeCollectionId: undefined,
      lastPlacementId: undefined,
      homeBanner: undefined,
      suggestions: undefined,
      selected: undefined
    })
}));
