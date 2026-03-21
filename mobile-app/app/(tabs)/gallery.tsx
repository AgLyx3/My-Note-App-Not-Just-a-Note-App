import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { listCollections, undoPlacement } from "../../src/api/client";
import { useCaptureStore } from "../../src/store/capture-store";
import { Card, Screen, SectionTitle } from "../../src/ui/primitives";

export default function GalleryTabScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const suggestions = useCaptureStore((s) => s.suggestions);
  const homeBanner = useCaptureStore((s) => s.homeBanner);
  const setHomeBanner = useCaptureStore((s) => s.setHomeBanner);
  const setActiveCollectionName = useCaptureStore((s) => s.setActiveCollectionName);
  const setActiveCollectionId = useCaptureStore((s) => s.setActiveCollectionId);
  const setEntryId = useCaptureStore((s) => s.setEntryId);
  const lastPlacementId = useCaptureStore((s) => s.lastPlacementId);
  const setLastPlacementId = useCaptureStore((s) => s.setLastPlacementId);
  const query = useQuery({
    queryKey: ["collections"],
    queryFn: listCollections
  });
  const undoMutation = useMutation({
    mutationFn: async () => {
      if (!lastPlacementId) throw new Error("No recent placement to undo");
      return undoPlacement(lastPlacementId);
    },
    onSuccess: async (result) => {
      setHomeBanner(undefined);
      setLastPlacementId(undefined);
      setActiveCollectionId(undefined);
      setActiveCollectionName(undefined);
      setEntryId(result.entry.id);
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
      router.push("/review");
    }
  });

  function openCollection(id: string, name: string) {
    setActiveCollectionId(id);
    setActiveCollectionName(name);
    router.push("/collection-detail");
  }

  return (
    <Screen>
      <SectionTitle title="Gallery" subtitle="Your collections and captured notes." />
      {homeBanner ? (
        <Card className="mb-3 border-zinc-300 bg-zinc-200">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-sm text-zinc-700">
                Saved to <Text className="font-semibold text-zinc-900">{homeBanner}</Text>
              </Text>
            </View>
            <Pressable
              disabled={!lastPlacementId || undoMutation.isPending}
              onPress={() => undoMutation.mutate()}
              className={`rounded-lg px-3 py-2 ${
                !lastPlacementId || undoMutation.isPending ? "bg-zinc-300" : "bg-zinc-900"
              }`}
            >
              <Text className="text-xs font-semibold text-zinc-50">{undoMutation.isPending ? "Undoing..." : "Undo"}</Text>
            </Pressable>
          </View>
        </Card>
      ) : null}
      {(query.data ?? []).map((collection) => (
        <Pressable key={collection.id} onPress={() => openCollection(collection.id, collection.name)}>
          <Card className="mb-3">
            <Text className="text-lg font-semibold text-zinc-900">{collection.name}</Text>
            <Text className="mt-1 text-sm text-zinc-500">{collection.note_count} note(s)</Text>
          </Card>
        </Pressable>
      ))}
      {query.isLoading ? <Text className="mb-3 text-sm text-zinc-500">Loading collections...</Text> : null}
      {suggestions ? (
        <Card className="mb-4 border-zinc-300 bg-zinc-200">
          <Text className="text-sm font-medium text-zinc-700">Last suggestion source: {suggestions.source}</Text>
          <Text className="mt-1 text-sm text-zinc-600">Confidence: {suggestions.confidence.label}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}
