import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { deleteEntry, listCollectionEntries, updateEntryText } from "../src/api/client";
import { useCaptureStore } from "../src/store/capture-store";
import { SectionTitle, SegmentedControl } from "../src/ui/primitives";

function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

export default function CollectionDetailScreen() {
  const router = useRouter();
  const collectionId = useCaptureStore((s) => s.activeCollectionId);
  const collectionName = useCaptureStore((s) => s.activeCollectionName) ?? "Collection";
  const textDraft = useCaptureStore((s) => s.textDraft);
  const setEntryId = useCaptureStore((s) => s.setEntryId);
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

  const entries = entriesQuery.data?.entries ?? [];

  return (
    <View className="flex-1 bg-zinc-100">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SectionTitle
          title={collectionName}
          subtitle={
            entriesQuery.isLoading
              ? "Loading\u2026"
              : `${entries.length} note${entries.length !== 1 ? "s" : ""}`
          }
        />

        <SegmentedControl
          value={viewTab}
          options={[
            { label: "Raw Notes", value: "current" },
            { label: "Organized", value: "organized" }
          ]}
          onChange={(v) => setViewTab(v as "current" | "organized")}
        />

        {viewTab === "current" ? (
          <>
            {entries.length > 0 && (
              <View className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
                {entries.map((entry, index) => (
                  <View key={entry.id}>
                    {index > 0 && <View className="mx-4 h-px bg-zinc-100" />}

                    {editingId === entry.id ? (
                      <View className="px-4 py-4">
                        <TextInput
                          multiline
                          value={editingText}
                          onChangeText={setEditingText}
                          className="min-h-[120px] rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-base leading-relaxed text-zinc-900"
                          placeholder="Edit note text\u2026"
                          placeholderTextColor="#a1a1aa"
                          autoFocus
                        />
                        <View className="mt-3 flex-row items-center gap-2">
                          <Pressable
                            onPress={() =>
                              editMutation.mutate({ id: entry.id, text: editingText.trim() })
                            }
                            disabled={
                              editingText.trim().length === 0 || editMutation.isPending
                            }
                            className={`rounded-lg px-4 py-2.5 ${
                              editingText.trim().length === 0 || editMutation.isPending
                                ? "bg-zinc-200"
                                : "bg-zinc-900"
                            }`}
                            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                          >
                            <Text
                              className={`text-sm font-medium ${
                                editingText.trim().length === 0 || editMutation.isPending
                                  ? "text-zinc-400"
                                  : "text-zinc-50"
                              }`}
                            >
                              {editMutation.isPending ? "Saving\u2026" : "Save"}
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => {
                              setEditingId(null);
                              setEditingText("");
                            }}
                            className="rounded-lg px-4 py-2.5"
                            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                          >
                            <Text className="text-sm font-medium text-zinc-500">Cancel</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <View className="px-4 py-4">
                        {entry.image_uri ? (
                          <Image
                            source={{ uri: entry.image_uri }}
                            className="mb-3 h-44 w-full rounded-xl bg-zinc-100"
                            resizeMode="cover"
                          />
                        ) : null}

                        <Text className="text-base leading-relaxed text-zinc-900">
                          {entry.content_text ||
                            entry.preview ||
                            textDraft.slice(0, 84) ||
                            "Entry"}
                        </Text>

                        <View className="mt-3 flex-row items-center justify-between">
                          <Text className="text-xs text-zinc-500">
                            {formatNoteDate(entry.created_at)}
                            {entry.updated_at && entry.updated_at !== entry.created_at
                              ? " · edited"
                              : ""}
                          </Text>

                          <View className="flex-row items-center">
                            <Pressable
                              onPress={() => {
                                setEditingId(entry.id);
                                setEditingText(entry.content_text ?? entry.preview ?? "");
                              }}
                              hitSlop={8}
                              className="min-h-11 min-w-11 items-center justify-center px-2"
                              style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
                            >
                              <Text className="text-xs font-medium text-zinc-500">Edit</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => {
                                setEntryId(entry.id);
                                router.push("/move");
                              }}
                              hitSlop={8}
                              className="min-h-11 min-w-11 items-center justify-center px-2"
                              style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
                            >
                              <Text className="text-xs font-medium text-zinc-500">Move</Text>
                            </Pressable>
                            <Pressable
                              onPress={() =>
                                Alert.alert(
                                  "Delete note",
                                  "This action cannot be undone.",
                                  [
                                    { text: "Cancel", style: "cancel" },
                                    {
                                      text: "Delete",
                                      style: "destructive",
                                      onPress: () => deleteMutation.mutate(entry.id)
                                    }
                                  ]
                                )
                              }
                              hitSlop={8}
                              accessibilityRole="button"
                              accessibilityLabel="Delete note"
                              className="min-h-11 min-w-11 items-center justify-center px-2"
                              style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
                            >
                              <Text className="text-xs font-medium text-red-400">Delete</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}

            {!entriesQuery.isLoading && entries.length === 0 && (
              <View className="items-center py-20">
                <Text className="text-base font-medium text-zinc-300">No notes yet</Text>
                <Text className="mt-1.5 text-center text-sm text-zinc-400">
                  Captured notes will appear here
                </Text>
              </View>
            )}
          </>
        ) : (
          <View className="items-center rounded-2xl bg-white py-20">
            <Text className="text-base font-medium text-zinc-300">Coming Soon</Text>
            <Text className="mt-1.5 text-center text-sm text-zinc-400">
              Organized view is in development
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
