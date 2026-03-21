import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Toast from "react-native-toast-message";
import "../global.css";

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: "#f8fafc" },
            headerTintColor: "#1e293b",
            headerShadowVisible: false,
            headerTitleStyle: { fontWeight: "600" },
            contentStyle: { backgroundColor: "#f8fafc" }
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="review" options={{ title: "Review Sheet" }} />
          <Stack.Screen
            name="collection-detail"
            options={{
              title: "Collection Detail",
              headerBackTitle: "",
              headerBackButtonDisplayMode: "minimal"
            }}
          />
          <Stack.Screen name="move" options={{ title: "Move Entry" }} />
        </Stack>
        <Toast />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
