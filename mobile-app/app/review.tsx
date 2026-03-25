import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { confirmPlacement, getSuggestions } from "../src/api/client";
import { useCaptureStore } from "../src/store/capture-store";
import type { SuggestionOption } from "../src/types/api";
import { PrimaryButton, Screen, SectionTitle } from "../src/ui/primitives";

function OptionRow({
  option,
  active,
  onPress
}: {
  option: SuggestionOption;
  active: boolean;
  onPress: () => void;
}) {
  const label = option.kind === "collection" ? option.collection.name : `Create new: ${option.suggested_name}`;
  return (
    <Pressable
      onPress={onPress}
      className={`mb-2 rounded-2xl border p-4 ${active ? "border-zinc-900 bg-zinc-200" : "border-zinc-300 bg-zinc-50"}`}
    >
      <Text className="text-base font-semibold text-zinc-900">{label}</Text>
      <Text className="mt-1 text-sm text-zinc-500">
        {option.kind === "collection" ? "Existing collection" : "Always available"}
      </Text>
    </Pressable>
  );
}

export default function ReviewScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const entryId = useCaptureStore((s) => s.entryId);
  const suggestions = useCaptureStore((s) => s.suggestions);
  const selected = useCaptureStore((s) => s.selected);
  const setActiveCollectionName = useCaptureStore((s) => s.setActiveCollectionName);
  const setActiveCollectionId = useCaptureStore((s) => s.setActiveCollectionId);
  const setLastPlacementId = useCaptureStore((s) => s.setLastPlacementId);
  const setHomeBanner = useCaptureStore((s) => s.setHomeBanner);
  const setSuggestions = useCaptureStore((s) => s.setSuggestions);
  const setSelected = useCaptureStore((s) => s.setSelected);
  const prepareNewCapture = useCaptureStore((s) => s.prepareNewCapture);
  const [newCollectionName, setNewCollectionName] = useState("");

  const query = useQuery({
    queryKey: ["suggestions", entryId],
    queryFn: async () => getSuggestions(entryId!),
    enabled: Boolean(entryId),
    retry: false
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!entryId) throw new Error("No active entry");
      const choice = selected ?? suggestions?.top_option ?? query.data?.top_option;
      if (!choice) throw new Error("No suggestion selected");
      const selection =
        choice.kind === "collection"
          ? { kind: "collection" as const, collection_id: choice.collection.id }
          : {
              kind: "create_new" as const,
              new_collection_name: (newCollectionName.trim() || choice.suggested_name).trim()
            };
      return confirmPlacement(entryId, selection);
    },
    onSuccess: async (result) => {
      setLastPlacementId(result.placement.id);
      setActiveCollectionId(result.collection.id);
      setActiveCollectionName(result.collection.name);
      setHomeBanner(result.collection.name);
      prepareNewCapture();
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
      await queryClient.invalidateQueries({ queryKey: ["collection-entries", result.collection.id] });
      router.replace("/(tabs)/gallery");
    },
    onError: (error) => {
      Alert.alert("Confirm failed", error instanceof Error ? error.message : "Unknown error");
    }
  });

  useEffect(() => {
    if (query.data && !suggestions) setSuggestions(query.data);
  }, [query.data, suggestions, setSuggestions]);

  const data = suggestions ?? query.data;
  const options: SuggestionOption[] = data ? [data.top_option, ...data.alternatives] : [];
  const active = (selected ?? data?.top_option) ?? null;
  const suggestedCreateNew =
    options.find((option) => option.kind === "create_new")?.suggested_name ??
    (data?.top_option.kind === "create_new" ? data.top_option.suggested_name : "");

  useEffect(() => {
    if (!newCollectionName && suggestedCreateNew) {
      setNewCollectionName(suggestedCreateNew);
    }
  }, [suggestedCreateNew, newCollectionName]);

  if (!entryId) {
    return (
      <Screen className="items-center justify-center">
        <Text className="mb-3 text-zinc-700">No capture in progress.</Text>
        <Pressable onPress={() => router.replace("/(tabs)/capture")} className="rounded-xl bg-zinc-900 px-4 py-2">
          <Text className="font-bold text-zinc-50">Go to Capture</Text>
        </Pressable>
      </Screen>
    );
  }

  if (query.isLoading) {
    return (
      <Screen className="items-center justify-center">
        <Text className="text-zinc-700">Loading suggestions...</Text>
      </Screen>
    );
  }

  if (query.isError) {
    return (
      <Screen className="items-center justify-center">
        <Text className="text-center text-zinc-700">Could not load suggestions.</Text>
      </Screen>
    );
  }

  const isCreateNewSelected = active?.kind === "create_new";

  return (
    <Screen>
      <SectionTitle title="Place in collection" subtitle="Pick the best destination for this note." />
      <View className="mb-4 self-start rounded-full border border-zinc-300 bg-zinc-50 px-3 py-1">
        <Text className="text-xs text-zinc-600">
        Confidence: {data.confidence.label} ({data.source})
        </Text>
      </View>
      {options.map((option, index) => (
        <OptionRow
          key={`${option.kind}-${index}`}
          option={option}
          active={active === option}
          onPress={() => setSelected(option)}
        />
      ))}
      {isCreateNewSelected ? (
        <View className="mb-4">
          <Text className="mb-2 text-xs font-medium uppercase text-zinc-500">New collection name</Text>
          <TextInput
            value={newCollectionName}
            onChangeText={setNewCollectionName}
            className="rounded-xl border border-zinc-300 bg-zinc-50 p-3 text-base text-zinc-900"
            placeholder="Type collection name..."
            placeholderTextColor="#a1a1aa"
            maxLength={120}
          />
        </View>
      ) : null}
      <PrimaryButton
        className="mt-auto"
        onPress={() => confirmMutation.mutate()}
        disabled={confirmMutation.isPending || (isCreateNewSelected && newCollectionName.trim().length === 0)}
        label={confirmMutation.isPending ? "Confirming..." : "Confirm"}
      />
    </Screen>
  );
}
