import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Image, Pressable, Text, TextInput, View } from "react-native";
import { deleteEntry, listCollectionEntries, updateEntryText } from "../src/api/client";
import { useCaptureStore } from "../src/store/capture-store";
import { Card, PrimaryButton, Screen, SectionTitle } from "../src/ui/primitives";

function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function CollectionDetailScreen() {
  const router = useRouter();
  const collectionId = useCaptureStore((s) => s.activeCollectionId);
  const collectionName = useCaptureStore((s) => s.activeCollectionName) ?? "Collection";
  const textDraft = useCaptureStore((s) => s.textDraft);
  const setEntryId = useCaptureStore((s) => s.setEntryId);
  const setActiveCollectionName = useCaptureStore((s) => s.setActiveCollectionName);
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [viewTab, setViewTab] = useState<"current" | "organized">("current");

  const editMutation = useMutation({
    mutationFn: async (params: { id: string; text: string }) => updateEntryText(params.id, params.text),
    onSuccess: (result, variables) => {
      if (collectionId) {
        queryClient.setQueryData(
          ["collection-entries", collectionId],
          (prev:
            | {
                collection: { id: string; name: string; last_activity_at: string };
                entries: Array<{
                  id: string;
                  type: "text" | "image";
                  status: "draft" | "placed";
                  created_at: string;
                  updated_at?: string;
                  preview: string;
                  image_uri?: string;
                  content_text?: string;
                }>;
              }
            | undefined) => {
            if (!prev) return prev;
            return {
              ...prev,
              entries: prev.entries.map((item) =>
                item.id === variables.id
                  ? {
                      ...item,
                      ...result.entry
                    }
                  : item
              )
            };
          }
        );
      }
      if (collectionId) {
        queryClient.invalidateQueries({ queryKey: ["collection-entries", collectionId] });
      }
      setEditingId(null);
      setEditingText("");
    },
    onError: (error) => {
      Alert.alert("Edit failed", error instanceof Error ? error.message : "Unknown error");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => deleteEntry(id),
    onSuccess: () => {
      if (collectionId) {
        queryClient.invalidateQueries({ queryKey: ["collection-entries", collectionId] });
      }
    },
    onError: (error) => {
      Alert.alert("Delete failed", error instanceof Error ? error.message : "Unknown error");
    }
  });

  const entriesQuery = useQuery({
    queryKey: ["collection-entries", collectionId],
    queryFn: async () => listCollectionEntries(collectionId!),
    enabled: Boolean(collectionId)
  });

  return (
    <Screen>
      <SectionTitle title={collectionName} subtitle="Collection detail" />
      <View className="mb-3 flex-row rounded-xl border border-zinc-300 bg-zinc-100 p-1">
        <Pressable
          onPress={() => setViewTab("current")}
          className={`flex-1 rounded-lg px-3 py-2 ${viewTab === "current" ? "bg-zinc-900" : "bg-transparent"}`}
        >
          <Text className={`text-center text-sm font-semibold ${viewTab === "current" ? "text-zinc-50" : "text-zinc-700"}`}>
            Raw Notes
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setViewTab("organized")}
          className={`flex-1 rounded-lg px-3 py-2 ${viewTab === "organized" ? "bg-zinc-900" : "bg-transparent"}`}
        >
          <Text className={`text-center text-sm font-semibold ${viewTab === "organized" ? "text-zinc-50" : "text-zinc-700"}`}>
            Organized Notes
          </Text>
        </Pressable>
      </View>

      {viewTab === "current" ? (
        <>
          {entriesQuery.isLoading ? <Text className="mb-3 text-sm text-zinc-500">Loading notes...</Text> : null}
          {(entriesQuery.data?.entries ?? []).map((entry) => (
            <Card key={entry.id} className="mb-3">
              <View className="mb-3 flex-row items-start justify-between">
                <View className="mr-2 flex-1">
                  <Text className="mb-1 text-xs font-medium text-zinc-600">
                    {entry.type === "image" ? "Image note" : entry.image_uri ? "Text note (image saved)" : "Text note"}
                  </Text>
                  <Text className="text-xs text-zinc-500">
                    {formatNoteDate(entry.created_at)}
                    {entry.updated_at && entry.updated_at !== entry.created_at
                      ? ` · Edited ${formatNoteDate(entry.updated_at)}`
                      : ""}
                  </Text>
                </View>
                <Pressable
                  onPress={() =>
                    Alert.alert("Delete note", "This action cannot be undone.", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(entry.id) }
                    ])
                  }
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Delete note"
                  className="min-h-11 min-w-11 items-center justify-center px-1 active:opacity-50"
                >
                  <Text className="-mt-0.5 text-3xl font-light leading-none text-zinc-400">×</Text>
                </Pressable>
              </View>
              {entry.image_uri ? (
                <Image source={{ uri: entry.image_uri }} className="mb-3 h-44 w-full rounded-xl bg-zinc-200" resizeMode="cover" />
              ) : null}
              {editingId === entry.id ? (
                <View>
                  <TextInput
                    multiline
                    value={editingText}
                    onChangeText={setEditingText}
                    className="min-h-[120px] rounded-xl border border-zinc-300 bg-zinc-50 p-3 text-base text-zinc-900"
                    placeholder="Edit note text..."
                    placeholderTextColor="#a1a1aa"
                  />
                  <View className="mt-3 flex-row gap-2">
                    <Pressable
                      onPress={() => editMutation.mutate({ id: entry.id, text: editingText.trim() })}
                      disabled={editingText.trim().length === 0 || editMutation.isPending}
                      className={`rounded-lg px-3 py-2 ${editingText.trim().length === 0 || editMutation.isPending ? "bg-zinc-300" : "bg-zinc-900"}`}
                    >
                      <Text className="text-sm font-semibold text-zinc-50">{editMutation.isPending ? "Saving..." : "Save"}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setEditingId(null);
                        setEditingText("");
                      }}
                      className="rounded-lg border border-zinc-300 px-3 py-2"
                    >
                      <Text className="text-sm font-semibold text-zinc-700">Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Text className="text-base font-semibold text-zinc-900">
                  {entry.content_text || entry.preview || textDraft.slice(0, 84) || "Entry"}
                </Text>
              )}
              <View className="mt-3 flex-row flex-wrap gap-2">
                <Pressable
                  onPress={() => {
                    setEditingId(entry.id);
                    setEditingText(entry.content_text ?? entry.preview ?? "");
                  }}
                  className="rounded-lg border border-zinc-300 px-3 py-2"
                >
                  <Text className="text-sm font-semibold text-zinc-700">Edit</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setEntryId(entry.id);
                    router.push("/move");
                  }}
                  className="rounded-lg border border-zinc-300 px-3 py-2"
                >
                  <Text className="text-sm font-semibold text-zinc-700">Move</Text>
                </Pressable>
              </View>
            </Card>
          ))}
          {!entriesQuery.isLoading && (entriesQuery.data?.entries.length ?? 0) === 0 ? (
            <Text className="mb-3 text-sm text-zinc-500">No notes in this collection yet.</Text>
          ) : null}
        </>
      ) : (
        <Card className="mb-3">
          <Text className="text-base font-semibold text-zinc-900">Organized Notes</Text>
          <Text className="mt-2 text-sm text-zinc-500">
            COMING SOON
          </Text>
        </Card>
      )}

      <PrimaryButton className="mt-auto" onPress={() => router.replace("/(tabs)/gallery")} label="Back to Home" />
    </Screen>
  );
}
