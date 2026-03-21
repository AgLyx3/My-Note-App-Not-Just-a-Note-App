import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { moveEntry } from "../src/api/client";
import { useCaptureStore } from "../src/store/capture-store";
import type { ConfirmSelection } from "../src/types/api";
import { PrimaryButton, Screen, SectionTitle } from "../src/ui/primitives";

interface MoveOption {
  id: string;
  selection: ConfirmSelection;
  title: string;
  subtitle: string;
}

const MOVE_OPTIONS: MoveOption[] = [
  {
    id: "admin",
    selection: { kind: "create_new", new_collection_name: "Personal Admin" },
    title: "Personal Admin",
    subtitle: "Likely better fit"
  },
  {
    id: "travel",
    selection: { kind: "create_new", new_collection_name: "Travel Plans" },
    title: "Travel Plans",
    subtitle: "Current collection"
  },
  {
    id: "new",
    selection: { kind: "create_new", new_collection_name: "Visa Prep" },
    title: "Create new: Visa Prep",
    subtitle: "Always available"
  }
];

export default function MoveScreen() {
  const router = useRouter();
  const entryId = useCaptureStore((s) => s.entryId);
  const setActiveCollectionName = useCaptureStore((s) => s.setActiveCollectionName);
  const setLastPlacementId = useCaptureStore((s) => s.setLastPlacementId);
  const [selectedId, setSelectedId] = useState<string>("admin");

  const selectedOption = MOVE_OPTIONS.find((o) => o.id === selectedId) ?? MOVE_OPTIONS[0];

  const moveMutation = useMutation({
    mutationFn: async () => {
      if (!entryId) throw new Error("No entry to move");
      return moveEntry(entryId, selectedOption.selection);
    },
    onSuccess: (result) => {
      setLastPlacementId(result.placement.id);
      const pickedName = selectedOption.title.replace(/^Create new:\s*/, "");
      setActiveCollectionName(pickedName);
      router.replace("/collection-detail");
    },
    onError: (error) => {
      Alert.alert("Move failed", error instanceof Error ? error.message : "Unknown error");
    }
  });

  return (
    <Screen>
      <SectionTitle title="Move to collection" subtitle="Change destination while preserving history." />

      {MOVE_OPTIONS.map((option) => (
        <Pressable
          key={option.id}
          onPress={() => setSelectedId(option.id)}
          className={`mb-2 rounded-2xl border p-4 ${selectedOption.id === option.id ? "border-zinc-900 bg-zinc-200" : "border-zinc-300 bg-zinc-50"}`}
        >
          <Text className="text-base font-semibold text-zinc-900">{option.title}</Text>
          <Text className="mt-1 text-sm text-zinc-500">{option.subtitle}</Text>
        </Pressable>
      ))}

      <PrimaryButton
        className="mt-auto"
        onPress={() => moveMutation.mutate()}
        disabled={!entryId || moveMutation.isPending}
        label={moveMutation.isPending ? "Moving..." : "Confirm Move"}
      />
    </Screen>
  );
}
