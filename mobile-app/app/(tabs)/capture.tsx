import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View
} from "react-native";
import Toast from "react-native-toast-message";
import { createCapture, extractTextFromImage } from "../../src/api/client";
import { MAX_CAPTURE_TEXT_CHARS } from "../../src/constants/capture-limits";
import { useCaptureStore } from "../../src/store/capture-store";
import { Card, PrimaryButton, Screen, SectionTitle, SegmentedControl } from "../../src/ui/primitives";

const MAX_IMAGE_CONTEXT_CHARS = 120;

function showTextTooLongToast(context: "text" | "extracted") {
  console.warn(`[capture] text exceeds max length (${MAX_CAPTURE_TEXT_CHARS} chars)`, { context });
  Toast.show({
    type: "error",
    text1: "Too much text",
    text2: `Notes can be at most ${MAX_CAPTURE_TEXT_CHARS.toLocaleString()} characters. Trim your text and try again.`
  });
}

function isTextOverLimit(trimmed: string): boolean {
  return trimmed.length > MAX_CAPTURE_TEXT_CHARS;
}

function guessMimeType(uri: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

async function extractTextFromLocalImage(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  return extractTextFromImage(base64, guessMimeType(uri));
}

export default function CaptureTabScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [mode, setMode] = useState<"text" | "image">("text");
  const [extractedText, setExtractedText] = useState("");
  const [saveImageAlongside, setSaveImageAlongside] = useState(false);
  const [imageContext, setImageContext] = useState("");
  const textDraft = useCaptureStore((s) => s.textDraft);
  const imagePath = useCaptureStore((s) => s.imagePath);
  const setTextDraft = useCaptureStore((s) => s.setTextDraft);
  const setImagePath = useCaptureStore((s) => s.setImagePath);
  const setEntryId = useCaptureStore((s) => s.setEntryId);
  const clearSuggestions = useCaptureStore((s) => s.clearSuggestions);

  async function onPickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8
    });
    if (!result.canceled) {
      setImagePath(result.assets[0]?.uri);
      setExtractedText("");
      setSaveImageAlongside(false);
      setImageContext("");
    }
  }

  async function onExtract() {
    if (!imagePath) return;
    try {
      setExtracting(true);
      const text = await extractTextFromLocalImage(imagePath);
      setExtractedText(text);
    } catch (error) {
      Alert.alert("Extract failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setExtracting(false);
    }
  }

  async function onContinue() {
    const textForSubmit = mode === "text" ? textDraft.trim() : extractedText.trim();
    if (isTextOverLimit(textForSubmit)) {
      showTextTooLongToast(mode === "text" ? "text" : "extracted");
      return;
    }
    try {
      setLoading(true);
      const payload =
        mode === "text"
          ? { type: "text" as const, content: { text: textForSubmit } }
          : {
              type: "text" as const,
              content: {
                text: textForSubmit,
                ...(imageContext.trim().length > 0
                  ? { image_context: imageContext.trim().slice(0, MAX_IMAGE_CONTEXT_CHARS) }
                  : {}),
                ...(saveImageAlongside && imagePath ? { image_storage_path: imagePath } : {})
              }
            };
      const result = await createCapture(payload);
      setEntryId(result.entry.id);
      clearSuggestions();
      router.push("/review");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (/10000|too long|at most|max/i.test(msg)) {
        showTextTooLongToast(mode === "text" ? "text" : "extracted");
      } else {
        Alert.alert("Capture failed", msg || "Unknown error");
      }
    } finally {
      setLoading(false);
    }
  }

  const canContinue =
    mode === "text"
      ? textDraft.trim().length > 0
      : Boolean(imagePath) && extractedText.trim().length > 0;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <Screen>
        <SectionTitle title="Capture" subtitle="Add text or image. Links in text are enriched automatically." />
        <SegmentedControl
          value={mode}
          onChange={(value) => setMode(value as "text" | "image")}
          options={[
            { label: "Text", value: "text" },
            { label: "Image", value: "image" }
          ]}
        />

      {mode === "text" ? (
        <Card>
          <Text className="mb-2 text-sm text-zinc-500">Paste notes, ideas, or URLs.</Text>
          <TextInput
            multiline
            value={textDraft}
            onChangeText={setTextDraft}
            className="h-[220px] rounded-xl border border-zinc-300 bg-zinc-50 p-3 text-base text-zinc-900"
            placeholder="Capture your thought..."
            placeholderTextColor="#a1a1aa"
            textAlignVertical="top"
            scrollEnabled
          />
        </Card>
      ) : (
        <Card>
          <Text className="mb-2 text-sm text-zinc-500">
            Choose a photo, extract text, then continue. Optionally keep the image with the note.
          </Text>
          <Pressable onPress={onPickImage} className="rounded-xl border border-zinc-300 bg-zinc-50 p-3">
            <Text className="text-zinc-900">{imagePath ? "Replace image" : "Select image"}</Text>
            {imagePath ? (
              <Text className="mt-1 text-xs text-zinc-500" numberOfLines={2}>
                {imagePath}
              </Text>
            ) : null}
          </Pressable>

          <Pressable
            onPress={onExtract}
            disabled={!imagePath || extracting}
            className={`mt-3 flex-row items-center justify-center rounded-xl border p-3 ${
              !imagePath || extracting ? "border-zinc-200 bg-zinc-100" : "border-zinc-900 bg-zinc-900"
            }`}
          >
            {extracting ? (
              <ActivityIndicator color="#fafafa" />
            ) : (
              <Text
                className={`text-sm font-semibold ${!imagePath ? "text-zinc-400" : "text-zinc-50"}`}
              >
                Extract text
              </Text>
            )}
          </Pressable>

          {extractedText.length > 0 ? (
            <View className="mt-4">
              <Text className="mb-2 text-xs font-medium uppercase text-zinc-500">Extracted text</Text>
              <TextInput
                multiline
                value={extractedText}
                onChangeText={setExtractedText}
                className="h-[160px] rounded-xl border border-zinc-300 bg-zinc-50 p-3 text-base text-zinc-900"
                placeholder="Extracted text appears here..."
                placeholderTextColor="#a1a1aa"
                textAlignVertical="top"
                scrollEnabled
              />
            </View>
          ) : null}

          {extractedText.trim().length > 0 ? (
            <View className="mt-4">
              <Text className="mb-2 text-xs font-medium uppercase text-zinc-500">Context (optional)</Text>
              <TextInput
                value={imageContext}
                onChangeText={(value) => setImageContext(value.slice(0, MAX_IMAGE_CONTEXT_CHARS))}
                className="rounded-xl border border-zinc-300 bg-zinc-50 p-3 text-base text-zinc-900"
                placeholder="Why save this? (e.g., friend X likes this, event to attend)"
                placeholderTextColor="#a1a1aa"
                maxLength={MAX_IMAGE_CONTEXT_CHARS}
              />
            </View>
          ) : null}
        </Card>
      )}

      {mode === "image" && extractedText.trim().length > 0 ? (
        <Pressable
          onPress={() => setSaveImageAlongside((v) => !v)}
          className="mb-2 flex-row items-center rounded-lg py-2"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: saveImageAlongside }}
        >
          <View
            className={`mr-2 h-5 w-5 items-center justify-center rounded border ${
              saveImageAlongside ? "border-zinc-900 bg-zinc-900" : "border-zinc-400 bg-zinc-50"
            }`}
          >
            {saveImageAlongside ? <Text className="text-xs font-bold text-zinc-50">✓</Text> : null}
          </View>
          <Text className="flex-1 text-sm text-zinc-700">Save image alongside with text</Text>
        </Pressable>
      ) : null}

        <PrimaryButton
          className="mt-auto"
          onPress={onContinue}
          disabled={!canContinue || loading}
          label={loading ? "Loading..." : "Continue"}
        />
      </Screen>
    </TouchableWithoutFeedback>
  );
}
